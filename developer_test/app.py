import argparse
import hmac
import logging
import math
import os
import secrets
import sqlite3
import threading
import time
from contextlib import asynccontextmanager
from pathlib import Path
from urllib.parse import urlsplit

import uvicorn
import anyio
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, JSONResponse, Response
from starlette.concurrency import run_in_threadpool
from starlette.datastructures import Headers
from starlette.requests import Request

from .engine import MAX_UPLOAD_BYTES, SCALES, FaceEngine, FaceError, check_cancelled, decode_image
from .storage import ProfileConflict, ProfileStore, StorageError
from .enrollment import compare_references
from .provenance import backend_provenance
from .uploads import BoundedUploadRoute
from .rules import (MAX_REQUEST_BYTES,MIN_THRESHOLD,MAX_THRESHOLD,DEFAULT_THRESHOLD,MAX_REFERENCES,
                    MIN_BENCHMARK_ITERATIONS,MAX_BENCHMARK_ITERATIONS,public_rules)


PACKAGE_ROOT = Path(__file__).resolve().parent
SITE_ROOT = PACKAGE_ROOT.parent
LOGGER = logging.getLogger("aegis.server")
HTTP_CONCURRENCY_LIMIT=64
HTTP_KEEPALIVE_SECONDS=2
STATIC_FILES = frozenset({
    "index.html", "index.js", "style.css", "console.css", "Alunos.html", "Alunos.js",
    "Configuracoes.html", "Configuracoes.js", "DadosGerais.html", "DadosGerais.js",
    "Eventos.html", "Eventos.js", "Identificacoes.html", "Identificacoes.js",
    "Movimentacao.html", "Movimentacao.js", "PRB.html", "PRB.js",
    "Privacidade.html", "Privacidade.js", "Relatorio.html", "Relatorio.js",
    "SolicitarAcesso.html", "SolicitarAcesso.js", "Suporte.html", "Suporte.js",
    "DeveloperTest.html", "DeveloperTest.js", "DeveloperTest.Report.js", "DeveloperTest.Temporal.js", "AegisShared.js",
})


class LocalSecurityMiddleware:
    def __init__(self, app, token, capacity):
        self.app = app
        self.token = token
        self.capacity = capacity

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        headers = Headers(scope=scope)
        authority = headers.get("host", "")
        try:
            parsed = urlsplit(f"http://{authority}")
            valid_host = parsed.hostname in {"localhost", "127.0.0.1", "::1"} and not parsed.username and not parsed.password
            if parsed.port is not None and not 1 <= parsed.port <= 65535:
                valid_host = False
            if parsed.path or parsed.query or parsed.fragment or any(character.isspace() for character in authority):
                valid_host = False
        except ValueError:
            valid_host = False
        if not valid_host:
            await JSONResponse({"detail": "O Developer Test aceita somente acesso por localhost."}, status_code=403)(scope, receive, send)
            return
        origin = headers.get("origin")
        expected_origin = f"{scope.get('scheme', 'http')}://{authority}"
        if origin is not None and origin != expected_origin:
            await JSONResponse({"detail": "A origem da solicitação não é permitida."}, status_code=403)(scope, receive, send)
            return
        if headers.get("sec-fetch-site") not in {None, "same-origin", "none"}:
            await JSONResponse({"detail": "Acesse o Developer Test pela própria página local."}, status_code=403)(scope, receive, send)
            return
        if scope["method"] in {"POST", "PUT", "PATCH", "DELETE"}:
            provided = headers.get("x-aegis-token", "")
            if not hmac.compare_digest(provided.encode("utf-8"), self.token.encode("utf-8")):
                await JSONResponse({"detail": "Sessão inválida. Atualize a página e tente novamente."}, status_code=403)(scope, receive, send)
                return
            content_length = headers.get("content-length")
            if content_length is not None:
                try:
                    size = int(content_length)
                except ValueError:
                    size = -1
                if size < 0 or size > MAX_REQUEST_BYTES:
                    await JSONResponse({"detail": "O envio excede o limite de 42 MB."}, status_code=413)(scope, receive, send)
                    return
            total = 0

            async def limited_receive():
                nonlocal total
                message = await receive()
                total += len(message.get("body", b""))
                if total > MAX_REQUEST_BYTES:
                    raise HTTPException(413, "O envio excede o limite de 42 MB.")
                return message

            next_receive = limited_receive
        else:
            next_receive = receive

        async def secure_send(message):
            if message["type"] == "http.response.start":
                response_headers = [(key, value) for key, value in message.get("headers", []) if key.lower() != b"cache-control"]
                path = scope.get("path", "").lstrip("/")
                cache = b"public, max-age=0, must-revalidate" if path in STATIC_FILES and Path(path).suffix in {".js", ".css"} and message["status"] in {200, 304} else b"no-store"
                response_headers.extend([
                    (b"cache-control", cache),
                    (b"x-content-type-options", b"nosniff"),
                    (b"referrer-policy", b"same-origin"),
                    (b"permissions-policy", b"camera=(self), microphone=(), geolocation=()"),
                    (b"x-frame-options", b"DENY"),
                ])
                message = {**message, "headers": response_headers}
            await send(message)

        processing_request = scope["method"] == "POST" and scope.get("path") in {"/api/dev/profiles", "/api/dev/recognize", "/api/dev/benchmark", "/api/dev/enrollment-check"}
        acquired = processing_request and self.capacity.acquire(blocking=False)
        if processing_request and not acquired:
            await JSONResponse({"detail": "O processamento está ocupado. Aguarde um instante e tente novamente."}, status_code=429)(scope, receive, secure_send)
            return
        try:
            await self.app(scope, next_receive, secure_send)
        finally:
            if acquired:
                self.capacity.release()


async def read_upload(upload):
    content = await upload.read(MAX_UPLOAD_BYTES + 1)
    if len(content) > MAX_UPLOAD_BYTES:
        raise FaceError(f"Cada imagem deve ter no máximo {MAX_UPLOAD_BYTES/(1024*1024):g} MB.", 413)
    return content


def validate_threshold(threshold):
    if not math.isfinite(threshold) or not MIN_THRESHOLD <= threshold <= MAX_THRESHOLD:
        limits=[f'{value:.2f}'.replace('.',',') for value in [MIN_THRESHOLD,MAX_THRESHOLD]]
        raise FaceError(f'O limiar deve estar entre {limits[0]} e {limits[1]}.')


async def run_processing(request, operation):
    """Signal disconnects; keep capacity until the native worker exits safely."""
    cancel = threading.Event()
    results, errors = [], []
    async with anyio.create_task_group() as group:
        async def worker():
            try:
                results.append(await run_in_threadpool(operation,cancel))
            except Exception as error:
                errors.append(error)
            finally:
                group.cancel_scope.cancel()

        async def observe_disconnect():
            try:
                while True:
                    message = await request.receive()
                    if message["type"] == "http.disconnect":
                        break
            finally:
                cancel.set()

        group.start_soon(observe_disconnect)
        group.start_soon(worker)
    if errors:
        raise errors[0]
    return results[0]


def create_app(engine=None, data_directory=None, site_root=None, token=None):
    data_directory = Path(data_directory or os.getenv("AEGIS_DATA_DIR", PACKAGE_ROOT / "data"))
    root = Path(site_root or SITE_ROOT).resolve()

    @asynccontextmanager
    async def lifespan(application):
        try:
            application.state.store = await run_in_threadpool(ProfileStore, data_directory / "profiles.sqlite3")
        except (StorageError, OSError, sqlite3.Error) as error:
            LOGGER.error("Não foi possível inicializar o banco local (%s).", type(error).__name__)
            application.state.store = None
        application.state.engine = engine or FaceEngine(PACKAGE_ROOT / "models")
        try:
            yield
        finally:
            if application.state.store is not None:
                await run_in_threadpool(application.state.store.close)

    application = FastAPI(title="AEGIS Developer Test", docs_url=None, redoc_url=None, openapi_url=None, lifespan=lifespan)
    application.router.route_class = BoundedUploadRoute
    application.state.store = None
    application.state.engine = engine
    application.state.token = token or secrets.token_urlsafe(32)
    application.state.provenance=backend_provenance()
    application.state.capacity = threading.BoundedSemaphore(2)
    application.add_middleware(LocalSecurityMiddleware, token=application.state.token, capacity=application.state.capacity)

    def store():
        if application.state.store is None:
            raise StorageError("O banco de perfis está indisponível. Verifique o armazenamento local e reinicie o serviço.")
        return application.state.store

    def annotate_snapshot(result,revision):
        _,current_revision=store().snapshot_with_revision()
        changed=current_revision!=revision
        if changed:
            def invalidate(face):
                if face['status']=='low_quality':
                    return face
                return {**face,'status':'uncertain','profile':None,
                        'reason':'A galeria mudou durante a análise. Repita para usar as referências atuais.'}
            if 'faces' in result:
                result={**result,'faces':[invalidate(face) for face in result['faces']]}
            if 'results' in result:
                result={**result,'results':[{**row,'stable':False,'gallery_changed':True,'faces':[invalidate(face) for face in row['faces']]} for row in result['results']]}
        return {**result,'gallery_revision':revision,'gallery_current_revision':current_revision,
                'gallery_changed':changed,'provenance':application.state.provenance}

    @application.exception_handler(StorageError)
    async def storage_error_handler(request, error):
        return JSONResponse({"detail": str(error)}, status_code=503)

    @application.exception_handler(FaceError)
    async def face_error_handler(request, error):
        return JSONResponse({"detail": str(error)}, status_code=error.status_code)

    @application.exception_handler(ProfileConflict)
    async def conflict_handler(request, error):
        return JSONResponse({"detail": str(error)}, status_code=409)

    @application.exception_handler(RequestValidationError)
    async def validation_handler(request, error):
        return JSONResponse({"detail": "Solicitação inválida. Confira as imagens e os parâmetros enviados."}, status_code=422)

    @application.get("/api/dev/health")
    async def health():
        def current_health():
            status, message = application.state.engine.health()
            try:
                profile_count = len(store().list_profiles())
            except StorageError:
                status = "error"
                profile_count = 0
                message = "O banco de perfis está indisponível. Verifique o armazenamento local e reinicie o serviço."
            return {
                "status": status,
                "model": {"detector": "YuNet", "recognizer": "SFace"},
                "profile_count": profile_count,
                "token": application.state.token,
                "message": message,
                "runtime": application.state.engine.runtime_info() if hasattr(application.state.engine, "runtime_info") else None,
                "rules":public_rules(),
                "provenance":application.state.provenance,
            }
        return await run_in_threadpool(current_health)

    @application.get("/api/dev/profiles")
    async def profiles():
        return {"profiles": await run_in_threadpool(store().list_profiles)}

    @application.post("/api/dev/profiles", status_code=201)
    async def enroll(request: Request, name: str = Form(...), images: list[UploadFile] = File(...)):
        if not 1 <= len(images) <= MAX_REFERENCES:
            for image in images:
                await image.close()
            raise FaceError(f"Envie entre 1 e {MAX_REFERENCES} imagens por cadastro.")
        normalized_name = " ".join(name.split())
        if not normalized_name or len(normalized_name) > 80 or any(ord(character) < 32 for character in normalized_name):
            for image in images:
                await image.close()
            raise FaceError("Informe um nome entre 1 e 80 caracteres.")
        contents = []
        try:
            for image in images:
                contents.append(await read_upload(image))
        finally:
            for image in images:
                await image.close()

        def enroll_images(cancel):
            def decoded_images():
                for content in contents:
                    check_cancelled(cancel)
                    yield decode_image(content)
            embeddings = application.state.engine.enroll(decoded_images(),cancel=cancel)
            check_cancelled(cancel)
            try:
                return store().add_profile(normalized_name, embeddings)
            except ProfileConflict:
                raise
            except ValueError as error:
                raise FaceError(str(error)) from None
        return await run_processing(request,enroll_images)

    @application.delete("/api/dev/profiles/{profile_id}")
    async def delete_profile(profile_id: str):
        if len(profile_id) != 32 or any(character not in "0123456789abcdef" for character in profile_id):
            raise HTTPException(404, "Perfil não encontrado.")
        deleted = await run_in_threadpool(store().delete_profile, profile_id)
        if not deleted:
            raise HTTPException(404, "Perfil não encontrado.")
        return {"deleted": True}

    @application.post('/api/dev/enrollment-check')
    async def enrollment_check(request: Request, images: list[UploadFile] = File(...)):
        contents=[]
        try:
            if not 1 <= len(images) <= MAX_REFERENCES:
                raise FaceError(f'Envie entre 1 e {MAX_REFERENCES} fotos para avaliação.')
            for image in images:
                contents.append(await read_upload(image))
        finally:
            for image in images:
                await image.close()

        def assess(cancel):
            def decoded():
                for content in contents:
                    check_cancelled(cancel)
                    try:
                        yield decode_image(content)
                    except FaceError as error:
                        yield error
            photos,vectors,indices=application.state.engine.assess_enrollment(decoded(),cancel=cancel)
            check_cancelled(cancel)
            snapshot,gallery_revision=store().snapshot_with_revision()
            profiles,known,_=snapshot
            comparisons=compare_references(vectors,known,indices)
            comparisons['gallery']['profile_count']=len(profiles)
            warnings=[]
            if comparisons['consistency']['passed'] is False:
                warnings.append('As referências não parecem pertencer à mesma pessoa. Reveja as fotos indicadas nos pares.')
            if comparisons['gallery']['similar_to_existing']:
                warnings.append('Este rosto é semelhante a um perfil existente. Confira a galeria antes de cadastrar novamente.')
            if comparisons['redundant_pairs']:
                warnings.append('Há fotos muito parecidas entre si. Inclua pequenas variações de posição ou luz para ampliar as referências.')
            return {'photos':photos,**comparisons,'warnings':warnings,'rules':public_rules(),'gallery_revision':gallery_revision,
                    'can_enroll':all(photo['accepted'] for photo in photos) and bool(comparisons['consistency']['passed']) and not comparisons['gallery']['similar_to_existing'],
                    'note':'Avaliação sem gravação. O cadastro repete as validações com a galeria disponível no momento de salvar.'}
        return await run_processing(request,assess)

    @application.post("/api/dev/recognize")
    async def recognize(request: Request, image: UploadFile = File(...), scale: str = Form("auto"), threshold: float = Form(DEFAULT_THRESHOLD)):
        try:
            if scale != "auto":
                try:
                    scale = float(scale)
                except ValueError:
                    raise FaceError("Escolha automática ou uma escala de 1, 0,5, 0,25 ou 0,1.") from None
                if not math.isfinite(scale) or scale not in SCALES:
                    raise FaceError("Escolha automática ou uma escala de 1, 0,5, 0,25 ou 0,1.")
            validate_threshold(threshold)
            content = await read_upload(image)
        finally:
            await image.close()

        def recognize_image(cancel):
            check_cancelled(cancel)
            decode_started = time.perf_counter()
            decoded = decode_image(content)
            check_cancelled(cancel)
            decode_ms = (time.perf_counter() - decode_started) * 1000
            snapshot,gallery_revision = store().snapshot_with_revision()
            result=application.state.engine.recognize(decoded, scale, threshold, snapshot, decode_ms,cancel=cancel)
            return annotate_snapshot(result,gallery_revision)
        return await run_processing(request,recognize_image)

    @application.post("/api/dev/benchmark")
    async def benchmark(request: Request, image: UploadFile = File(...), threshold: float = Form(DEFAULT_THRESHOLD), iterations: int = Form(3)):
        try:
            validate_threshold(threshold)
            if not MIN_BENCHMARK_ITERATIONS <= iterations <= MAX_BENCHMARK_ITERATIONS:
                raise FaceError(f"Use entre {MIN_BENCHMARK_ITERATIONS} e {MAX_BENCHMARK_ITERATIONS} repetições no benchmark.")
            content = await read_upload(image)
        finally:
            await image.close()

        def benchmark_image(cancel):
            check_cancelled(cancel)
            decode_started = time.perf_counter()
            decoded = decode_image(content)
            check_cancelled(cancel)
            decode_ms = (time.perf_counter() - decode_started) * 1000
            snapshot,gallery_revision = store().snapshot_with_revision()
            result=application.state.engine.benchmark(decoded, threshold, iterations, snapshot, decode_ms,cancel=cancel)
            return annotate_snapshot(result,gallery_revision)
        return await run_processing(request,benchmark_image)

    @application.api_route("/", methods=["GET", "HEAD"])
    async def index():
        target = (root / "index.html").resolve()
        if target.parent != root or not target.is_file():
            raise HTTPException(404, "Arquivo não encontrado.")
        return FileResponse(target, media_type="text/html")

    @application.api_route("/{filename}", methods=["GET", "HEAD"])
    async def static_file(filename: str, request: Request):
        if filename not in STATIC_FILES:
            raise HTTPException(404, "Arquivo não encontrado.")
        target = (root / filename).resolve()
        if target.parent != root or not target.is_file():
            raise HTTPException(404, "Arquivo não encontrado.")
        types = {".html": "text/html", ".js": "application/javascript", ".css": "text/css"}
        response = FileResponse(target, media_type=types[target.suffix], stat_result=target.stat())
        if target.suffix in {".js", ".css"}:
            tags = request.headers.get("if-none-match", "").split(",")
            if any(tag.strip().removeprefix("W/") in {response.headers["etag"], "*"} for tag in tags):
                return Response(status_code=304, headers={"etag": response.headers["etag"], "last-modified": response.headers["last-modified"]})
        return response

    return application


app = create_app()


def main():
    parser = argparse.ArgumentParser(description="Servidor local AEGIS Developer Test.")
    parser.add_argument("--port", type=int, default=8765)
    arguments = parser.parse_args()
    if not 1024 <= arguments.port <= 65535:
        parser.error("A porta deve estar entre 1024 e 65535.")
    uvicorn.run(app, host="127.0.0.1", port=arguments.port, access_log=False, server_header=False, limit_concurrency=HTTP_CONCURRENCY_LIMIT, timeout_keep_alive=HTTP_KEEPALIVE_SECONDS)


if __name__ == "__main__":
    main()
