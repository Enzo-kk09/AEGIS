import io
import logging
import math
import os
import threading
import time
import warnings
from contextlib import contextmanager
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageOps, UnidentifiedImageError

from .download_models import MODELS, valid_model
from .storage import normalize_embedding
from .rules import (MAX_UPLOAD_BYTES,MAX_PIXELS,MAX_EDGE,MIN_IMAGE_EDGE,SCALES,
                    AUTO_DETECTION_EDGE,AUTO_RETRY_EDGE,REFINE_BELOW_PIXELS,REFINE_MIN_OVERLAP,
                    UNCERTAINTY_BAND,IDENTITY_MARGIN,MAX_PROCESSED_FACES,
                    ENROLLMENT_MIN_PIXELS,RECOGNITION_MIN_PIXELS,ENROLLMENT_MIN_SHARPNESS,RECOGNITION_MIN_SHARPNESS,
                    BRIGHTNESS_MIN,BRIGHTNESS_MAX,CROP_TOLERANCE,MIN_EYE_RATIO)


BENCHMARK_SCALES = ("auto", *SCALES)
LOGGER = logging.getLogger("aegis.engine")
Image.MAX_IMAGE_PIXELS = MAX_PIXELS


class FaceError(ValueError):
    def __init__(self, message, status_code=422):
        super().__init__(message)
        self.status_code = status_code


class ProcessingCancelled(FaceError):
    def __init__(self):
        super().__init__("O processamento foi cancelado porque a solicitação foi interrompida.",499)


def check_cancelled(cancel):
    if cancel is not None and cancel.is_set():
        raise ProcessingCancelled()


def decode_image(content):
    if not content:
        raise FaceError("A imagem está vazia.", 400)
    if len(content) > MAX_UPLOAD_BYTES:
        raise FaceError(f"Cada imagem deve ter no máximo {MAX_UPLOAD_BYTES/(1024*1024):g} MB.", 413)
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(io.BytesIO(content)) as image:
                if image.format not in {"JPEG", "PNG", "WEBP"}:
                    raise FaceError("Use uma imagem JPEG, PNG ou WebP.", 415)
                width, height = image.size
                if width < MIN_IMAGE_EDGE or height < MIN_IMAGE_EDGE:
                    raise FaceError(f"A imagem precisa ter pelo menos {MIN_IMAGE_EDGE} pixels em cada dimensão.")
                if width * height > MAX_PIXELS or max(width, height) > MAX_EDGE:
                    raise FaceError(f"A imagem excede o limite de {MAX_PIXELS/1e6:g} megapixels ou {MAX_EDGE} pixels por dimensão.", 413)
                if getattr(image, "n_frames", 1) != 1:
                    raise FaceError("Envie uma imagem estática.", 415)
                # PNG getexif() loads the full pixel buffer, including late
                # metadata. Keep that path for metadata-bearing PNGs; verify
                # checksums without decompressing ordinary PNG pixel data.
                ordinary_png = image.format == "PNG" and not any(marker in content for marker in (b"eXIf", b"XML:com.adobe.xmp", b"Raw profile type exif"))
                native_color = image.mode in {"RGB", "L"}
                native_oriented = image.format in {"JPEG", "WEBP"} and image.getexif().get(274, 1) == 1
                complete = image.format != "JPEG" or content.endswith(b"\xff\xd9")
                if native_color and complete and (ordinary_png or native_oriented):
                    if ordinary_png:
                        if not content.endswith(b"\x00\x00\x00\x00IEND\xaeB\x60\x82"):
                            raise FaceError("O PNG está incompleto. Envie uma imagem válida.", 415)
                        image.verify()
                    decoded = cv2.imdecode(np.frombuffer(content, dtype=np.uint8), cv2.IMREAD_COLOR | cv2.IMREAD_IGNORE_ORIENTATION)
                    if decoded is None or decoded.shape[:2] != (height, width):
                        raise FaceError("Não foi possível abrir a imagem. Envie um JPEG, PNG ou WebP válido.", 415)
                    return decoded
                image.load()
                oriented = ImageOps.exif_transpose(image)
                rgb = np.asarray(oriented.convert("RGB"))
                return np.ascontiguousarray(rgb[:, :, ::-1])
    except FaceError:
        raise
    except (Image.DecompressionBombError, Image.DecompressionBombWarning):
        raise FaceError(f"A imagem excede o limite de {MAX_PIXELS/1e6:g} megapixels.", 413) from None
    except (UnidentifiedImageError, OSError, ValueError, SyntaxError, cv2.error):
        raise FaceError("Não foi possível abrir a imagem. Envie um JPEG, PNG ou WebP válido.", 415) from None


def map_face_to_original(face, original_width, original_height, detection_width, detection_height):
    mapped = np.asarray(face, dtype=np.float32).copy()
    x_ratio = original_width / detection_width
    y_ratio = original_height / detection_height
    mapped[[0, 2, 4, 6, 8, 10, 12]] *= x_ratio
    mapped[[1, 3, 5, 7, 9, 11, 13]] *= y_ratio
    return mapped


def match_embedding(embedding, snapshot, threshold, comparison=None):
    profiles, matrix, owners = snapshot
    if comparison is not None:
        comparison.update(threshold=threshold, accept_above=round(threshold + UNCERTAINTY_BAND, 5), required_margin=IDENTITY_MARGIN)
    if not profiles:
        return "unknown", None, None, "Cadastre um rosto para comparar."
    scores = np.clip(matrix @ normalize_embedding(embedding), -1.0, 1.0)
    identity_scores = np.full(len(profiles), -1.0, dtype=np.float32)
    np.maximum.at(identity_scores, owners, scores)
    best_index = int(np.argmax(identity_scores))
    best = float(identity_scores[best_index])
    identity_scores[best_index] = -1.0
    second = float(np.max(identity_scores))
    similarity = round(best, 5)
    if comparison is not None:
        comparison.update(runner_up_similarity=round(second, 5) if len(profiles) > 1 else None,
                          margin=round(best - second, 5) if len(profiles) > 1 else None)
    if best < threshold - UNCERTAINTY_BAND:
        return "unknown", None, similarity, "Nenhum perfil atingiu o limiar de similaridade."
    if best < threshold + UNCERTAINTY_BAND:
        return "uncertain", None, similarity, "Similaridade próxima ao limiar. Capture um rosto mais nítido ou ajuste o limiar."
    if best - second < IDENTITY_MARGIN:
        return "uncertain", None, similarity, "Dois perfis têm similaridade próxima. A identificação foi suspensa."
    return "matched", profiles[best_index], similarity, "Perfil identificado."


class FaceEngine:
    def __init__(self, model_directory):
        self.model_directory = Path(model_directory)
        self._lock = threading.RLock()
        self._detector = None
        self._recognizer = None
        self._detector_size = None
        self._status = "models_missing"
        self._message = "Prepare os modelos com o script de instalação e reinicie o serviço."
        self._loaded = False
        self._health_snapshot = None
        # Configure the process-wide native pool once, before serving work.
        # getNumberOfCPUs respects CPUs available to this process.
        self._available_cpus = max(1, cv2.getNumberOfCPUs())
        automatic_threads = min(4, self._available_cpus)
        configured = os.getenv("AEGIS_CPU_THREADS")
        self._thread_mode = "automatic" if configured is None else "manual"
        try:
            threads = automatic_threads if configured is None else int(configured)
        except ValueError:
            threads = automatic_threads
            self._thread_mode = "automatic"
            LOGGER.warning("AEGIS_CPU_THREADS inválido; usando a configuração automática.")
        cv2.setNumThreads(max(1, min(threads, 4, self._available_cpus)))
        cv2.ocl.setUseOpenCL(False)

    def health(self):
        # Initialization publishes one immutable result only after model
        # verification and warmup finish. Status reads then avoid the model
        # lock, so a long inference cannot make health appear disconnected.
        if self._health_snapshot is not None:
            return self._health_snapshot
        with self._lock:
            if not self._loaded:
                self._initialize()
            self._health_snapshot = (self._status, self._message)
            return self._health_snapshot

    def runtime_info(self):
        return {"backend": "OpenCV DNN", "target": "CPU", "opencv": cv2.__version__,
                "threads": cv2.getNumThreads(), "embedding_dimensions": 128,
                "threads_mode": self._thread_mode, "available_cpus": self._available_cpus,
                "auto_detection_edge": AUTO_DETECTION_EDGE, "auto_retry_edge": AUTO_RETRY_EDGE,
                "uncertainty_band": UNCERTAINTY_BAND, "identity_margin": IDENTITY_MARGIN}

    def _initialize(self):
        self._loaded = True
        paths = [self.model_directory / model["filename"] for model in MODELS]
        try:
            if not all(path.is_file() for path in paths):
                return
            if not all(valid_model(path, model) for path, model in zip(paths, MODELS)):
                LOGGER.error("A verificação de integridade dos modelos falhou.")
                self._status = "error"
                self._message = "A integridade dos modelos falhou. Execute a instalação novamente."
                return
            self._detector = cv2.FaceDetectorYN.create(
                str(paths[0]), "", (320, 320), 0.85, 0.3, 5000,
                cv2.dnn.DNN_BACKEND_OPENCV, cv2.dnn.DNN_TARGET_CPU,
            )
            self._recognizer = cv2.FaceRecognizerSF.create(
                str(paths[1]), "", cv2.dnn.DNN_BACKEND_OPENCV, cv2.dnn.DNN_TARGET_CPU,
            )
            self._detector.detect(np.zeros((320, 320, 3), dtype=np.uint8))
            self._detector_size = (320, 320)
            self._recognizer.feature(np.zeros((112, 112, 3), dtype=np.uint8))
            self._status = "ready"
            self._message = "YuNet e SFace prontos para processamento local."
        except (cv2.error, OSError, RuntimeError) as error:
            LOGGER.error("Não foi possível preparar os modelos (%s).", type(error).__name__)
            self._status = "error"
            self._message = "Não foi possível carregar os modelos. Verifique a instalação e reinicie o serviço."
            self._detector = None
            self._recognizer = None

    def _require_ready(self):
        status, message = self.health()
        if status != "ready":
            raise FaceError(message, 503)

    @contextmanager
    def _processing_lock(self,cancel):
        if cancel is None:
            with self._lock:
                yield
            return
        check_cancelled(cancel)
        while not self._lock.acquire(timeout=.05):
            check_cancelled(cancel)
        try:
            check_cancelled(cancel)
            yield
        finally:
            self._lock.release()

    def _detect(self, image, scale):
        height, width = image.shape[:2]
        detection_width = max(1, round(width * scale))
        detection_height = max(1, round(height * scale))
        details = {
            "requested_scale": scale,
            "width": detection_width,
            "height": detection_height,
            "effective_scale": round(detection_width / width, 6),
        }
        if min(detection_width, detection_height) < MIN_IMAGE_EDGE:
            return [], details
        reduced = image if (detection_width, detection_height) == (width, height) else cv2.resize(
            image, (detection_width, detection_height), interpolation=cv2.INTER_AREA,
        )
        if self._detector_size != (detection_width, detection_height):
            self._detector.setInputSize((detection_width, detection_height))
            self._detector_size = (detection_width, detection_height)
        _, faces = self._detector.detect(reduced)
        if faces is None:
            return [], details
        faces = np.asarray(faces, dtype=np.float32)
        if faces.ndim != 2 or faces.shape[1] != 15:
            LOGGER.error("O detector retornou dados com formato inválido.")
            raise FaceError("O detector retornou dados inválidos. Reinicie o serviço e tente novamente.", 503)
        valid = [face for face in faces if np.isfinite(face).all() and min(face[2:4]) > 0 and 0 <= face[14] <= 1]
        valid.sort(key=lambda face: float(face[14]), reverse=True)
        mapped = [map_face_to_original(face, width, height, detection_width, detection_height) for face in valid]
        return mapped, details

    @staticmethod
    def _overlap(first, second):
        left = max(float(first[0]), float(second[0]))
        top = max(float(first[1]), float(second[1]))
        right = min(float(first[0] + first[2]), float(second[0] + second[2]))
        bottom = min(float(first[1] + first[3]), float(second[1] + second[3]))
        intersection = max(0, right - left) * max(0, bottom - top)
        union = float(first[2] * first[3] + second[2] * second[3]) - intersection
        return intersection / union if union > 0 else 0

    def _refine_face(self, image, face):
        height, width = image.shape[:2]
        x, y, face_width, face_height = [float(value) for value in face[:4]]
        left, top = max(0, math.floor(x - face_width * 0.35)), max(0, math.floor(y - face_height * 0.35))
        right, bottom = min(width, math.ceil(x + face_width * 1.35)), min(height, math.ceil(y + face_height * 1.35))
        crop = image[top:bottom, left:right]
        if crop.size == 0:
            return face, False
        candidates, _ = self._detect(crop, min(1.0, 640 / max(crop.shape[:2])))
        for candidate in candidates:
            candidate[[0, 4, 6, 8, 10, 12]] += left
            candidate[[1, 5, 7, 9, 11, 13]] += top
        if not candidates:
            return face, False
        refined = max(candidates, key=lambda candidate: self._overlap(face, candidate))
        # A neighboring face must never replace the original detection.
        return (refined, True) if self._overlap(face, refined) >= REFINE_MIN_OVERLAP else (face, False)

    def _detect_auto(self, image, cancel=None):
        check_cancelled(cancel)
        longest_edge = max(image.shape[:2])
        scale = min(1.0, AUTO_DETECTION_EDGE / longest_edge)
        faces, details = self._detect(image, scale)
        check_cancelled(cancel)
        attempts = [details.copy()]
        retry_scale = min(1.0, AUTO_RETRY_EDGE / longest_edge)
        if not faces and retry_scale > scale:
            faces, details = self._detect(image, retry_scale)
            check_cancelled(cancel)
            scale = retry_scale
            attempts.append(details.copy())
        refinements = []
        for index, face in enumerate(faces[:MAX_PROCESSED_FACES]):
            check_cancelled(cancel)
            refined = False
            if scale < 1.0 and min(face[2:4]) * scale < REFINE_BELOW_PIXELS:
                faces[index], refined = self._refine_face(image, face)
                check_cancelled(cancel)
            refinements.append(refined)
        details.update(requested_scale="auto", attempts=attempts, refined_faces=sum(refinements))
        if not faces:
            details["reason"] = "Nenhum rosto encontrado nas resoluções automáticas. Confira luz, foco e distância."
        return faces, details, refinements

    def _assess_quality(self, image, face, enrollment=False):
        height, width = image.shape[:2]
        x, y, face_width, face_height = [float(value) for value in face[:4]]
        minimum_size = ENROLLMENT_MIN_PIXELS if enrollment else RECOGNITION_MIN_PIXELS
        minimum_sharpness = ENROLLMENT_MIN_SHARPNESS if enrollment else RECOGNITION_MIN_SHARPNESS
        metrics = {"face_pixels": round(min(face_width, face_height), 2), "minimum_pixels": minimum_size,
                   "brightness": None, "sharpness": None, "minimum_sharpness": minimum_sharpness,
                   "brightness_min":BRIGHTNESS_MIN,"brightness_max":BRIGHTNESS_MAX,"reason": None}
        crop = image[max(0, int(y)):min(height, math.ceil(y + face_height)), max(0, int(x)):min(width, math.ceil(x + face_width))]
        if crop.size:
            gray = cv2.cvtColor(cv2.resize(crop, (112, 112), interpolation=cv2.INTER_AREA), cv2.COLOR_BGR2GRAY)
            metrics["brightness"] = round(float(gray.mean()), 2)
            metrics["sharpness"] = round(float(cv2.Laplacian(gray, cv2.CV_32F).var()), 2)
        reason = None
        if min(face_width, face_height) < minimum_size:
            reason = f"Aproxime o rosto. Ele precisa ter pelo menos {minimum_size} pixels na imagem original."
        elif x < -face_width * CROP_TOLERANCE or y < -face_height * CROP_TOLERANCE or x + face_width > width + face_width * CROP_TOLERANCE or y + face_height > height + face_height * CROP_TOLERANCE:
            reason = "O rosto está cortado. Posicione todo o rosto dentro da imagem."
        landmarks = face[4:14].reshape(5, 2)
        if reason is None and ((landmarks[:, 0] < 0).any() or (landmarks[:, 0] >= width).any() or (landmarks[:, 1] < 0).any() or (landmarks[:, 1] >= height).any()):
            reason = "Os pontos faciais estão fora da imagem."
        eye_distance = float(np.linalg.norm(landmarks[0] - landmarks[1]))
        if reason is None:
            if eye_distance < face_width * MIN_EYE_RATIO:
                reason = "Vire o rosto em direção à câmera para melhorar o alinhamento."
            elif not crop.size:
                reason = "Não foi possível recortar o rosto."
            elif metrics["brightness"] < BRIGHTNESS_MIN or metrics["brightness"] > BRIGHTNESS_MAX:
                reason = "Ajuste a iluminação. O rosto está escuro ou superexposto."
            elif metrics["sharpness"] < minimum_sharpness:
                reason = "O rosto está desfocado. Mantenha a câmera estável e tente novamente."
        metrics["reason"] = reason
        metrics['signals'] = {
            'small':min(face_width,face_height) < minimum_size,
            'lighting':metrics['brightness'] is not None and not BRIGHTNESS_MIN <= metrics['brightness'] <= BRIGHTNESS_MAX,
            'blurred':metrics['sharpness'] is not None and metrics['sharpness'] < minimum_sharpness,
            'cropped':x < -face_width*CROP_TOLERANCE or y < -face_height*CROP_TOLERANCE or x+face_width > width+face_width*CROP_TOLERANCE or y+face_height > height+face_height*CROP_TOLERANCE,
            'pose':eye_distance < face_width*MIN_EYE_RATIO or bool((landmarks[:,0]<0).any() or (landmarks[:,0]>=width).any() or (landmarks[:,1]<0).any() or (landmarks[:,1]>=height).any()),
        }
        return metrics

    def _quality_reason(self, image, face, enrollment=False):
        return self._assess_quality(image, face, enrollment)["reason"]

    def _embedding(self, image, face):
        aligned = self._recognizer.alignCrop(image, face)
        return normalize_embedding(self._recognizer.feature(aligned).copy())

    def assess_enrollment(self, images, cancel=None):
        """Return photo diagnostics and internal vectors, without persisting images."""
        photos, vectors, indices = [], [], []
        advice = {
            'small':'Aproxime o rosto ou use uma foto com mais detalhes reais.',
            'lighting':'Use luz frontal uniforme e evite contraluz ou superexposição.',
            'blurred':'Confira o foco, estabilize a câmera e evite compressão excessiva.',
            'cropped':'Enquadre o rosto inteiro, com espaço ao redor.',
            'pose':'Olhe mais diretamente para a câmera; preserve olhos, nariz e boca visíveis.',
        }
        with self._processing_lock(cancel):
            self._require_ready()
            for index, image in enumerate(images,1):
                check_cancelled(cancel)
                item={'photo':index,'accepted':False,'face_count':None,'quality':None,'reason':'','advice':[]}
                try:
                    if isinstance(image,FaceError):
                        raise image
                    item['image']={'width':image.shape[1],'height':image.shape[0]}
                    faces, detection, _ = self._detect_auto(image,cancel)
                    item['face_count']=len(faces)
                    item['detection']=detection
                    if len(faces)!=1:
                        raise FaceError(f'Use exatamente um rosto inteiro; foram encontrados {len(faces)}.')
                    quality=self._assess_quality(image,faces[0],enrollment=True)
                    item['quality']=quality
                    item['advice']=[text for signal,text in advice.items() if quality.get('signals',{}).get(signal)]
                    if quality['reason']:
                        raise FaceError(quality['reason'])
                    embedding=self._embedding(image,faces[0])
                    check_cancelled(cancel)
                    vectors.append(embedding)
                    indices.append(index)
                    item.update(accepted=True,reason='Foto adequada aos filtros de cadastro.')
                except ProcessingCancelled:
                    raise
                except FaceError as error:
                    item['reason']=str(error)
                except (cv2.error,ValueError):
                    item['reason']='Não foi possível extrair uma referência facial válida. Use outra foto.'
                photos.append(item)
        return photos,vectors,indices

    def enroll(self, images, cancel=None):
        embeddings = []
        with self._processing_lock(cancel):
            self._require_ready()
            try:
                for index, image in enumerate(images, 1):
                    check_cancelled(cancel)
                    faces, _, _ = self._detect_auto(image,cancel)
                    if len(faces) != 1:
                        raise FaceError(f"Imagem {index}: precisa conter exatamente um rosto; foram encontrados {len(faces)}.")
                    reason = self._assess_quality(image, faces[0], enrollment=True)["reason"]
                    if reason:
                        raise FaceError(f"Imagem {index}: {reason}")
                    embeddings.append(self._embedding(image, faces[0]))
                    check_cancelled(cancel)
            except FaceError:
                raise
            except (cv2.error, ValueError) as error:
                LOGGER.error("Falha no cadastro facial (%s).", type(error).__name__)
                raise FaceError("Falha no processamento facial. Tente uma imagem diferente.") from None
        return embeddings

    def recognize(self, image, scale, threshold, snapshot, decode_ms=0.0, cancel=None):
        queued = time.perf_counter()
        with self._processing_lock(cancel):
            queue_ms = (time.perf_counter() - queued) * 1000
            self._require_ready()
            started = time.perf_counter()
            try:
                detect_started = time.perf_counter()
                if scale == "auto":
                    faces, detection, refinements = self._detect_auto(image,cancel)
                else:
                    faces, detection = self._detect(image, scale)
                    refinements = [False] * min(MAX_PROCESSED_FACES, len(faces))
                    if min(detection["width"], detection["height"]) < MIN_IMAGE_EDGE:
                        detection["reason"] = f"A resolução reduzida ficou abaixo de {MIN_IMAGE_EDGE} pixels. Use uma escala maior."
                check_cancelled(cancel)
                detection["faces_detected"] = len(faces)
                detection["faces_processed"] = min(MAX_PROCESSED_FACES, len(faces))
                detect_ms = (time.perf_counter() - detect_started) * 1000
                recognition_started = time.perf_counter()
                outcomes = []
                height, width = image.shape[:2]
                embed_ms = match_ms = 0.0
                for face, refined in zip(faces[:MAX_PROCESSED_FACES], refinements):
                    check_cancelled(cancel)
                    x, y, box_width, box_height = [float(value) for value in face[:4]]
                    x1, y1 = min(width, max(0, x)), min(height, max(0, y))
                    x2, y2 = min(width, max(0, x + box_width)), min(height, max(0, y + box_height))
                    quality = self._assess_quality(image, face)
                    reason = quality["reason"]
                    comparison = {}
                    status, profile, similarity = "low_quality", None, None
                    if reason is None:
                        embedding = None
                        if snapshot[0]:
                            embedding_started = time.perf_counter()
                            embedding = self._embedding(image, face)
                            check_cancelled(cancel)
                            embed_ms += (time.perf_counter() - embedding_started) * 1000
                        matching_started = time.perf_counter()
                        status, profile, similarity, reason = match_embedding(embedding, snapshot, threshold, comparison)
                        match_ms += (time.perf_counter() - matching_started) * 1000
                    outcomes.append({
                        "box": {"x": round(x1, 2), "y": round(y1, 2), "width": round(max(0, x2 - x1), 2), "height": round(max(0, y2 - y1), 2)},
                        "status": status,
                        "profile": profile,
                        "similarity": similarity,
                        "detector_score": round(float(face[14]), 5),
                        "reason": reason,
                        "quality": quality,
                        "comparison": comparison,
                        "refined": refined,
                        "landmarks": [{"x": round(float(x), 2), "y": round(float(y), 2)} for x, y in face[4:14].reshape(5, 2)],
                    })
                recognize_ms = (time.perf_counter() - recognition_started) * 1000
                compute_ms = (time.perf_counter() - started) * 1000
            except FaceError:
                raise
            except (cv2.error, ValueError) as error:
                LOGGER.error("Falha na inferência facial (%s).", type(error).__name__)
                raise FaceError("Falha no processamento facial. Tente uma imagem diferente.") from None
        return {
            "image": {"width": width, "height": height},
            "faces": outcomes,
            "timings": {
                "decode_ms": round(decode_ms, 2),
                "detect_ms": round(detect_ms, 2),
                "recognize_ms": round(recognize_ms, 2),
                "queue_ms": round(queue_ms, 2),
                "embedding_ms": round(embed_ms, 2),
                "match_ms": round(match_ms, 2),
                "total_ms": round(compute_ms + decode_ms, 2),
            },
            "detection": detection,
            "profile_count": len(snapshot[0]),
        }

    def benchmark(self, image, threshold, iterations, snapshot, decode_ms=0.0, cancel=None):
        results = []
        options = {"cancel":cancel} if cancel is not None else {}
        with self._processing_lock(cancel):
            self._require_ready()
            for scale in BENCHMARK_SCALES:
                check_cancelled(cancel)
                self.recognize(image, scale, threshold, snapshot,**options)
                runs = []
                for _ in range(iterations):
                    check_cancelled(cancel)
                    runs.append(self.recognize(image, scale, threshold, snapshot, decode_ms,**options))
                check_cancelled(cancel)
                durations = [run["timings"]["total_ms"] for run in runs]
                last = runs[-1]
                signatures = [sorted((face["status"], face["profile"]["id"] if face["profile"] else "") for face in run["faces"]) for run in runs]
                results.append({
                    "scale": scale,
                    "mean_ms": round(float(np.mean(durations)), 2),
                    "median_ms": round(float(np.median(durations)), 2),
                    "min_ms": round(float(np.min(durations)), 2),
                    "max_ms": round(float(np.max(durations)), 2),
                    "stable": all(signature == signatures[0] for signature in signatures),
                    "p95_ms": round(float(np.percentile(durations, 95)), 2),
                    "faces": last["faces"],
                    "matched": sum(face["status"] == "matched" for face in last["faces"]),
                    "similarities": [face["similarity"] for face in last["faces"] if face["similarity"] is not None],
                    "detection": last["detection"],
                    "timings": {key: round(float(np.mean([run["timings"][key] for run in runs])), 2) for key in last["timings"]},
                })
        height, width = image.shape[:2]
        return {"results": results, "image": {"width": width, "height": height}, "iterations": iterations, "warmups": 1}
