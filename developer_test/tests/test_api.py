import asyncio
import io
import os
import subprocess
import sys
from pathlib import Path

import numpy as np
import pytest
from fastapi.testclient import TestClient
from PIL import Image

from developer_test.app import MAX_REQUEST_BYTES, create_app
from developer_test.engine import FaceError, match_embedding


TOKEN = "test-token"


class Engine:
    def __init__(self):
        self.vector = np.zeros(128, dtype=np.float32)
        self.vector[0] = 1
        self.status = "ready"
        self.enroll_error = None

    def health(self):
        return self.status, "Serviço de teste."

    def enroll(self, images,cancel=None):
        if self.status != "ready":
            raise FaceError("Modelos ausentes.", 503)
        if self.enroll_error:
            raise FaceError(self.enroll_error)
        return [self.vector.copy() for _ in images]

    def recognize(self, image, scale, threshold, snapshot, decode_ms=0,cancel=None):
        self.requested_scale = scale
        scale = 1.0 if scale == 'auto' else scale
        status, profile, similarity, reason = match_embedding(self.vector, snapshot, threshold)
        return {
            "image": {"width": image.shape[1], "height": image.shape[0]},
            "faces": [{"box": {"x": 1, "y": 1, "width": 60, "height": 60}, "status": status, "profile": profile, "similarity": similarity, "reason": reason, "detector_score": 0.95}],
            "timings": {"decode_ms": decode_ms, "detect_ms": 1, "recognize_ms": 2, "total_ms": decode_ms + 3},
            "detection": {"requested_scale": scale, "effective_scale": scale, "width": round(image.shape[1] * scale), "height": round(image.shape[0] * scale)},
            "profile_count": len(snapshot[0]),
        }

    def benchmark(self, image, threshold, iterations, snapshot, decode_ms=0,cancel=None):
        output = self.recognize(image, 1, threshold, snapshot, decode_ms)
        return {"results": [{"scale": scale, "mean_ms": 3, "p95_ms": 3, "faces": output["faces"], "matched": sum(face["status"] == "matched" for face in output["faces"]), "similarities": [face["similarity"] for face in output["faces"]]} for scale in [1, 0.5, 0.25, 0.1]], "image": output["image"]}


@pytest.fixture
def environment(tmp_path):
    root = tmp_path / "site"
    root.mkdir()
    (root / "index.html").write_text("<html>AEGIS</html>", encoding="utf-8")
    (root / "DeveloperTest.html").write_text("<html>Developer Test</html>", encoding="utf-8")
    (root / "AegisShared.js").write_text("window.Aegis = {};", encoding="utf-8")
    engine = Engine()
    app = create_app(engine=engine, data_directory=tmp_path / "data", site_root=root, token=TOKEN)
    with TestClient(app, base_url="http://localhost:8765") as client:
        yield client, app, engine


def picture():
    output = io.BytesIO()
    Image.new("RGB", (120, 100), color=(100, 140, 180)).save(output, format="JPEG")
    return ("selfie.jpg", output.getvalue(), "image/jpeg")


def authorize():
    return {"X-AEGIS-Token": TOKEN, "Origin": "http://localhost:8765"}


def test_enroll_recognize_benchmark_delete_roundtrip(environment):
    client, app, _ = environment
    health = client.get("/api/dev/health")
    assert health.json()["token"] == TOKEN
    assert health.headers["cache-control"] == "no-store"
    profile = client.post("/api/dev/profiles", data={"name": "Enzo"}, files=[("images", picture())], headers=authorize())
    assert profile.status_code == 201
    identity = profile.json()
    assert identity["samples"] == 1
    assert client.get("/api/dev/profiles").json()["profiles"] == [identity]
    recognized = client.post("/api/dev/recognize", files={"image": picture()}, headers=authorize())
    assert recognized.status_code == 200
    assert recognized.json()["faces"][0]["profile"]["id"] == identity["id"]
    benchmark = client.post("/api/dev/benchmark", files={"image": picture()}, headers=authorize())
    assert benchmark.status_code == 200
    assert len(benchmark.json()["results"]) == 4
    assert isinstance(benchmark.json()["results"][0]["faces"], list)
    assert client.delete(f"/api/dev/profiles/{identity['id']}", headers=authorize()).json() == {"deleted": True}
    assert app.state.store.snapshot()[0] == []


def test_untrusted_origin_host_and_token_rejected_before_mutation(environment):
    client, app, _ = environment
    for headers in [{}, {"X-AEGIS-Token": "wrong"}, {"X-AEGIS-Token": TOKEN, "Origin": "https://evil.example"}, {"X-AEGIS-Token": TOKEN, "Origin": "null"}, {"X-AEGIS-Token": TOKEN, "Sec-Fetch-Site": "cross-site"}]:
        response = client.post("/api/dev/profiles", data={"name": "Enzo"}, files=[("images", picture())], headers=headers)
        assert response.status_code == 403
    for host in ["evil.example", "localhost.evil.example", "localhost@evil.example", "localhost:invalid"]:
        assert client.get("/api/dev/health", headers={"Host": host}).status_code == 403
    assert client.get("/api/dev/health", headers={"Origin": "https://evil.example"}).status_code == 403
    assert app.state.store.list_profiles() == []


@pytest.mark.parametrize("data", [{"scale": "0.2"}, {"scale": "nan"}, {"scale": "inf"}, {"scale": "bogus"}, {"threshold": "nan"}, {"threshold": "inf"}, {"threshold": "0.1"}, {"threshold": "0.95"}])
def test_recognition_rejects_invalid_parameters(environment, data):
    client, _, _ = environment
    response = client.post("/api/dev/recognize", data=data, files={"image": picture()}, headers=authorize())
    assert response.status_code == 422
    assert isinstance(response.json()["detail"], str)


@pytest.mark.parametrize("iterations", ["0", "6", "2.5"])
def test_benchmark_rejects_unbounded_iterations(environment, iterations):
    client, _, _ = environment
    assert client.post("/api/dev/benchmark", data={"iterations": iterations}, files={"image": picture()}, headers=authorize()).status_code == 422


def test_api_accepts_auto_and_preserves_explicit_scale(environment):
    client, _, engine = environment
    for scale in ['auto', '1', '0.5', '0.25', '0.1']:
        response = client.post('/api/dev/recognize', data={'scale': scale}, files={'image': picture()}, headers=authorize())
        assert response.status_code == 200
        assert engine.requested_scale == ('auto' if scale == 'auto' else float(scale))


def test_bad_images_and_empty_uploads_return_explanatory_errors(environment):
    client, _, _ = environment
    for content in [b"broken image", b""]:
        result = client.post("/api/dev/recognize", files={"image": ("photo.jpg", content, "image/jpeg")}, headers=authorize())
        assert result.status_code in {400, 415}
    assert client.post("/api/dev/recognize", headers=authorize()).status_code == 422
    result = client.post("/api/dev/recognize", headers={**authorize(), "Content-Length": str(MAX_REQUEST_BYTES + 1)}, content=b"x")
    assert result.status_code == 413


def test_enrollment_errors_do_not_create_profiles(environment):
    client, app, engine = environment
    engine.enroll_error = "Precisa conter exatamente um rosto."
    result = client.post("/api/dev/profiles", data={"name": "Enzo"}, files=[("images", picture())], headers=authorize())
    assert result.status_code == 422
    assert app.state.store.list_profiles() == []
    engine.enroll_error = None
    assert client.post("/api/dev/profiles", data={"name": "Enzo"}, files=[("images", picture())], headers=authorize()).status_code == 201
    assert client.post("/api/dev/profiles", data={"name": "Outro"}, files=[("images", picture())], headers=authorize()).status_code == 409
    assert client.post("/api/dev/profiles", data={"name": "  "}, files=[("images", picture())], headers=authorize()).status_code == 422
    assert client.post("/api/dev/profiles", data={"name": "abc\x00"}, files=[("images", picture())], headers=authorize()).status_code == 422
    assert client.post("/api/dev/profiles", data={"name": "Excesso"}, files=[("images", picture()) for _ in range(6)], headers=authorize()).status_code == 422


def test_missing_models_preserve_health_and_profile_deletion(environment):
    client, _, engine = environment
    profile = client.post("/api/dev/profiles", data={"name": "Enzo"}, files=[("images", picture())], headers=authorize()).json()
    engine.status = "models_missing"
    assert client.get("/api/dev/health").json()["status"] == "models_missing"
    assert len(client.get("/api/dev/profiles").json()["profiles"]) == 1
    assert client.delete(f"/api/dev/profiles/{profile['id']}", headers=authorize()).status_code == 200
    assert client.post("/api/dev/profiles", data={"name": "Enzo"}, files=[("images", picture())], headers=authorize()).status_code == 503


def test_static_allowlist_and_head_do_not_expose_local_files(environment):
    client, _, _ = environment
    assert client.get("/").status_code == 200
    assert client.head("/DeveloperTest.html").status_code == 200
    assert client.head("/DeveloperTest.html").content == b""
    for path in ["/developer_test/app.py", "/developer_test/data/profiles.sqlite3", "/developer_test/models/face_recognition_sface_2021dec.onnx", "/README.md", "/%2e%2e/developer_test/app.py", "/..%2fdeveloper_test%2fapp.py"]:
        assert client.get(path).status_code == 404


def test_busy_service_has_bounded_queue(environment):
    client, app, _ = environment
    app.state.capacity.acquire()
    app.state.capacity.acquire()
    try:
        response = client.post("/api/dev/recognize", files={"image": picture()}, headers=authorize())
        assert response.status_code == 429
    finally:
        app.state.capacity.release()
        app.state.capacity.release()


def test_create_and_import_app_have_no_database_side_effects(tmp_path):
    directory = tmp_path / "not-created"
    application = create_app(engine=Engine(), data_directory=directory)
    assert application.state.store is None
    assert not directory.exists()
    result = subprocess.run(
        [sys.executable, "-c", "import developer_test.app; import os; from pathlib import Path; assert not Path(os.environ['AEGIS_DATA_DIR']).exists()"],
        cwd=Path(__file__).resolve().parents[2], env={**os.environ, "AEGIS_DATA_DIR": str(directory)}, capture_output=True, text=True, check=False,
    )
    assert result.returncode == 0, result.stderr


def test_corrupt_database_keeps_static_and_safe_health_available(tmp_path, caplog):
    data = tmp_path / "data"
    data.mkdir()
    (data / "profiles.sqlite3").write_bytes(b"secret-biometric-content")
    application = create_app(engine=Engine(), data_directory=data, token=TOKEN)
    with TestClient(application, base_url="http://localhost:8765") as client:
        health = client.get("/api/dev/health")
        assert health.status_code == 200
        assert health.json()["status"] == "error"
        assert client.get("/api/dev/profiles").status_code == 503
        assert client.get("/DeveloperTest.html").status_code == 200
    assert "secret-biometric-content" not in caplog.text
    assert str(data) not in caplog.text


def test_shared_javascript_revalidates_etag_while_html_and_api_are_not_stored(environment):
    client, _, _ = environment
    response = client.get("/AegisShared.js")
    assert response.status_code == 200
    assert response.headers["cache-control"] == "public, max-age=0, must-revalidate"
    tag = response.headers["etag"]
    for condition in [tag, f"W/{tag}", "*"]:
        cached = client.get("/AegisShared.js", headers={"If-None-Match": condition})
        assert cached.status_code == 304
        assert cached.content == b""
    assert client.get("/AegisShared.js", headers={"If-None-Match": '"stale"'}).status_code == 200
    assert client.get("/DeveloperTest.html").headers["cache-control"] == "no-store"
    assert client.get("/api/dev/health").headers["cache-control"] == "no-store"


def asgi_request(application, chunks, content_type=b"multipart/form-data; boundary=boundary"):
    sent = []
    received = []
    messages = iter(chunks)
    scope = {"type": "http", "asgi": {"version": "3.0"}, "http_version": "1.1", "scheme": "http", "method": "POST", "path": "/api/dev/recognize", "raw_path": b"/api/dev/recognize", "query_string": b"", "root_path": "", "headers": [(b"host", b"localhost:8765"), (b"content-type", content_type), (b"x-aegis-token", TOKEN.encode())], "client": ("127.0.0.1", 1000), "server": ("127.0.0.1", 8765)}

    async def receive():
        chunk = next(messages)
        received.append(chunk)
        return {"type": "http.request", "body": chunk, "more_body": True}

    async def send(message):
        sent.append(message)

    asyncio.run(application(scope, receive, send))
    return sent, received


def test_streamed_request_limit_rejects_before_consuming_remaining_body(environment, monkeypatch):
    import developer_test.app as module
    _, application, _ = environment
    monkeypatch.setattr(module, "MAX_REQUEST_BYTES", 200)
    prefix = b'--boundary\r\nContent-Disposition: form-data; name="image"; filename="test.jpg"\r\nContent-Type: image/jpeg\r\n\r\n'
    body = prefix + picture()[1] + b"\r\n--boundary--\r\n"
    sent, received = asgi_request(application, [body[:180], body[180:240], body[240:]])
    assert next(message["status"] for message in sent if message["type"] == "http.response.start") == 413
    assert len(received) == 2


def test_busy_request_is_rejected_before_any_upload_read(environment):
    _, application, _ = environment
    application.state.capacity.acquire()
    application.state.capacity.acquire()
    try:
        sent, received = asgi_request(application, [b"unread image"])
        assert next(message["status"] for message in sent if message["type"] == "http.response.start") == 429
        assert received == []
    finally:
        application.state.capacity.release()
        application.state.capacity.release()


def test_partial_multipart_and_oversized_upload_close_in_memory_files(environment, monkeypatch):
    import developer_test.uploads as module
    import starlette.formparsers as parsers
    client, _, _ = environment
    files = []
    original = parsers.SpooledTemporaryFile

    def track(*arguments, **keywords):
        result = original(*arguments, **keywords)
        files.append(result)
        return result

    monkeypatch.setattr(parsers, "SpooledTemporaryFile", track)
    monkeypatch.setattr(module, "MAX_UPLOAD_BYTES", 1024)
    result = client.post("/api/dev/recognize", files={"image": ("large.jpg", b"x" * 1025, "image/jpeg")}, headers=authorize())
    assert result.status_code == 413
    assert files and all(file.closed and not file._rolled for file in files)
    prefix = b'--boundary\r\nContent-Disposition: form-data; name="image"; filename="test.jpg"\r\nContent-Type: image/jpeg\r\n\r\n'
    result = client.post("/api/dev/recognize", content=prefix + picture()[1], headers={**authorize(), "Content-Type": "multipart/form-data; boundary=boundary"})
    assert result.status_code == 400
    assert all(file.closed for file in files)


@pytest.mark.parametrize("path",['/api/dev/recognize','/api/dev/benchmark','/api/dev/profiles','/api/dev/enrollment-check'])
def test_disconnect_cancels_processing_releases_capacity_and_does_not_save_profile(environment,monkeypatch,path):
    import threading
    import anyio
    from developer_test.engine import ProcessingCancelled
    _, application, engine = environment
    started = threading.Event()
    observed = []
    def operation(*args,cancel=None,**kwargs):
        started.set()
        assert cancel.wait(2),"ASGI disconnect must reach the worker."
        observed.append(True)
        if path.endswith('profiles'):
            # Simulate an already running native call returning after the
            # disconnect. The API must still skip the database write.
            return [engine.vector.copy()]
        raise ProcessingCancelled()
    for name in ['enroll','recognize','benchmark','assess_enrollment']:
        monkeypatch.setattr(engine,name,operation,raising=False)
    file_field = b'images' if path.endswith(('profiles','enrollment-check')) else b'image'
    name = b'--boundary\r\nContent-Disposition: form-data; name="name"\r\n\r\nCancelled profile\r\n' if path.endswith('profiles') else b''
    body = name+b'--boundary\r\nContent-Disposition: form-data; name="'+file_field+b'"; filename="test.jpg"\r\nContent-Type: image/jpeg\r\n\r\n'+picture()[1]+b'\r\n--boundary--\r\n'
    sent = []
    scope = {'type':'http','asgi':{'version':'3.0'},'http_version':'1.1','scheme':'http',
             'method':'POST','path':path,'raw_path':path.encode(),'query_string':b'', 'root_path':'',
             'headers':[(b'host',b'localhost:8765'),(b'content-type',b'multipart/form-data; boundary=boundary'),(b'x-aegis-token',TOKEN.encode())],
             'client':('127.0.0.1',1000),'server':('127.0.0.1',8765)}
    async def run():
        consumed = False
        async def receive():
            nonlocal consumed
            if not consumed:
                consumed = True
                return {'type':'http.request','body':body,'more_body':False}
            with anyio.fail_after(3):
                while not started.is_set():
                    await anyio.sleep(.005)
            return {'type':'http.disconnect'}
        async def send(message):
            sent.append(message)
        with anyio.fail_after(4):
            await application(scope,receive,send)
    anyio.run(run)
    assert observed==[True]
    assert next(message['status'] for message in sent if message['type']=='http.response.start')==499
    assert application.state.store.list_profiles()==[]
    assert application.state.capacity.acquire(blocking=False)
    assert application.state.capacity.acquire(blocking=False)
    assert not application.state.capacity.acquire(blocking=False)
    application.state.capacity.release()
    application.state.capacity.release()
