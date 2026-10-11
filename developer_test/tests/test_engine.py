import io
import time

import numpy as np
import pytest
from PIL import Image

from developer_test.engine import FaceEngine, FaceError, decode_image, map_face_to_original, match_embedding
from developer_test.storage import normalize_embedding


def vector(similarity=1.0):
    value = np.zeros(128, dtype=np.float32)
    value[0] = similarity
    value[1] = np.sqrt(max(0, 1 - similarity * similarity))
    return value


def snapshot(*values):
    return ([{"id": str(index), "name": f"Pessoa {index}"} for index in range(len(values))], np.stack(values) if values else np.empty((0, 128)), np.arange(len(values), dtype=np.int32))


def test_matching_rejects_borderline_and_competing_profiles():
    query = vector()
    assert match_embedding(query, snapshot(vector(0.85)), 0.45)[0] == "matched"
    assert match_embedding(query, snapshot(vector(0.30)), 0.45)[0] == "unknown"
    assert match_embedding(query, snapshot(vector(0.47)), 0.45)[0] == "uncertain"
    assert match_embedding(query, snapshot(vector(0.85), vector(0.82)), 0.45)[0] == "uncertain"
    assert match_embedding(query, snapshot(), 0.45)[:3] == ("unknown", None, None)


@pytest.mark.parametrize("cpus,configured,expected,mode", [
    (1,None,1,"automatic"), (2,None,2,"automatic"), (12,None,4,"automatic"),
    (0,None,1,"automatic"), (12,"2",2,"manual"), (2,"4",2,"manual"),
    (12,"99",4,"manual"), (12,"0",1,"manual"), (12,"-5",1,"manual"),
    (12,"invalid",4,"automatic"),
])
def test_cpu_threads_respect_available_processors_and_manual_configuration(tmp_path,monkeypatch,cpus,configured,expected,mode):
    import cv2
    selected = []
    monkeypatch.setattr(cv2,"getNumberOfCPUs",lambda:cpus)
    monkeypatch.setattr(cv2,"setNumThreads",selected.append)
    monkeypatch.setattr(cv2,"getNumThreads",lambda:selected[-1])
    if configured is None:
        monkeypatch.delenv("AEGIS_CPU_THREADS",raising=False)
    else:
        monkeypatch.setenv("AEGIS_CPU_THREADS",configured)
    engine = FaceEngine(tmp_path)
    assert selected == [expected]
    assert engine.runtime_info()["threads"] == expected
    assert engine.runtime_info()["threads_mode"] == mode
    assert engine.runtime_info()["available_cpus"] == max(1,cpus)


def test_multiple_samples_of_same_identity_do_not_create_ambiguity():
    data = ([{"id": "same", "name": "Pessoa"}], np.stack([vector(), vector(0.97)]), np.array([0, 0]))
    status, profile, _, _ = match_embedding(vector(), data, 0.45)
    assert status == "matched"
    assert profile["id"] == "same"


def test_mapping_preserves_detector_score_and_maps_landmarks_with_actual_axes():
    face = np.arange(15, dtype=np.float32)
    mapped = map_face_to_original(face, 1001, 603, 250, 151)
    assert mapped[14] == face[14]
    assert mapped[4] == pytest.approx(face[4] * 1001 / 250)
    assert mapped[5] == pytest.approx(face[5] * 603 / 151)
    assert np.array_equal(face, np.arange(15, dtype=np.float32))


class Detector:
    def __init__(self, count=1):
        self.count = count
        self.size = None
        self.images = []

    def setInputSize(self, size):
        self.size = size

    def detect(self, image):
        self.images.append(image.shape)
        face = np.array([30, 20, 60, 60, 45, 35, 75, 35, 60, 50, 48, 70, 72, 70, 0.96], dtype=np.float32)
        return None, np.stack([face.copy() for _ in range(self.count)]) if self.count else None


class Recognizer:
    def __init__(self):
        self.aligned_shapes = []
        self.faces = []

    def alignCrop(self, image, face):
        self.aligned_shapes.append(image.shape)
        self.faces.append(face.copy())
        return np.zeros((112, 112, 3), dtype=np.uint8)

    def feature(self, aligned):
        return vector().reshape(1, -1)


def fake_engine(tmp_path, count=1):
    engine = FaceEngine(tmp_path)
    engine._loaded = True
    engine._status = "ready"
    engine._detector = Detector(count)
    engine._recognizer = Recognizer()
    engine._assess_quality = lambda image, face, enrollment=False: {"reason": None}
    return engine


def test_reduced_detection_aligns_full_original_frame(tmp_path):
    engine = fake_engine(tmp_path)
    image = np.zeros((600, 1000, 3), dtype=np.uint8)
    result = engine.recognize(image, 0.25, 0.45, snapshot(vector()))
    assert engine._detector.size == (250, 150)
    assert engine._detector.images == [(150, 250, 3)]
    assert engine._recognizer.aligned_shapes == [(600, 1000, 3)]
    assert engine._recognizer.faces[0][4] == 180
    assert result["faces"][0]["box"] == {"x": 120, "y": 80, "width": 240, "height": 240}
    assert result["faces"][0]["status"] == "matched"
    assert result["detection"]["effective_scale"] == 0.25


def test_experimental_scale_does_not_silently_fallback(tmp_path):
    engine = fake_engine(tmp_path)
    image = np.zeros((200, 300, 3), dtype=np.uint8)
    result = engine.recognize(image, 0.1, 0.45, snapshot())
    assert result["faces"] == []
    assert result["detection"]["width"] == 30
    assert result["detection"]["height"] == 20
    assert engine._detector.images == []


def test_face_limits_and_exactly_one_enrollment(tmp_path):
    engine = fake_engine(tmp_path, 12)
    image = np.zeros((600, 1000, 3), dtype=np.uint8)
    assert len(engine.recognize(image, 0.5, 0.45, snapshot())["faces"]) == 10
    with pytest.raises(FaceError, match="exatamente um rosto"):
        engine.enroll([image])


def test_quality_failure_prevents_feature_extraction(tmp_path):
    engine = fake_engine(tmp_path)
    engine._assess_quality = lambda image, face, enrollment=False: {"reason": "Desfocado."}
    image = np.zeros((600, 1000, 3), dtype=np.uint8)
    result = engine.recognize(image, 0.25, 0.45, snapshot(vector()))
    assert result["faces"][0]["status"] == "low_quality"
    assert engine._recognizer.aligned_shapes == []
    with pytest.raises(FaceError, match="Desfocado"):
        engine.enroll([image])


def test_benchmark_warms_each_scale_and_exposes_face_results(tmp_path):
    engine = fake_engine(tmp_path)
    image = np.zeros((600, 1000, 3), dtype=np.uint8)
    calls = []
    original = engine.recognize

    def record(image, scale, threshold, data, decode_ms=0):
        calls.append((scale, decode_ms))
        return original(image, scale, threshold, data, decode_ms)

    engine.recognize = record
    result = engine.benchmark(image, 0.45, 2, snapshot(vector()), 3.0)
    assert [row["scale"] for row in result["results"]] == ["auto", 1, 0.5, 0.25, 0.1]
    assert calls == [(scale, decoding) for scale in ["auto", 1, 0.5, 0.25, 0.1] for decoding in [0, 3.0, 3.0]]
    assert isinstance(result["results"][0]["faces"], list)
    assert result["results"][0]["mean_ms"] >= 3
    assert result["results"][0]["detection"]["requested_scale"] == "auto"
    for row in result["results"]:
        assert row["min_ms"] <= row["median_ms"] <= row["max_ms"]


def test_missing_and_corrupt_models_report_safe_health(tmp_path):
    engine = FaceEngine(tmp_path)
    assert engine.health()[0] == "models_missing"
    from developer_test.download_models import MODELS
    for model in MODELS:
        (tmp_path / model["filename"]).write_bytes(b"bad")
    assert FaceEngine(tmp_path).health()[0] == "error"


def test_decoder_applies_orientation_and_rejects_invalid_formats():
    buffer = io.BytesIO()
    image = Image.new("RGB", (120, 80))
    exif = image.getexif()
    exif[274] = 6
    image.save(buffer, format="JPEG", exif=exif)
    assert decode_image(buffer.getvalue()).shape == (120, 80, 3)
    with pytest.raises(FaceError):
        decode_image(b"<html>bad</html>")
    buffer = io.BytesIO()
    image.save(buffer, format="GIF")
    with pytest.raises(FaceError, match="JPEG"):
        decode_image(buffer.getvalue())


def test_decoder_rejects_oversized_images_before_decoding():
    image = Image.new("RGB", (3000, 3000))
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    with pytest.raises(FaceError) as error:
        decode_image(buffer.getvalue())
    assert error.value.status_code == 413


def test_model_read_failure_reports_safe_health_and_logs_only_error_class(tmp_path, monkeypatch, caplog):
    import developer_test.engine as module
    from developer_test.download_models import MODELS
    for model in MODELS:
        (tmp_path / model["filename"]).write_bytes(b"placeholder")

    def unreadable(path, model):
        raise PermissionError("secret-profile-path")

    monkeypatch.setattr(module, "valid_model", unreadable)
    status, message = FaceEngine(tmp_path).health()
    assert status == "error"
    assert "secret-profile-path" not in message
    assert "secret-profile-path" not in caplog.text
    assert "PermissionError" in caplog.text


def test_malformed_detector_output_has_safe_service_error(tmp_path):
    engine = fake_engine(tmp_path)
    engine._detector.detect = lambda image: (None, np.zeros((1, 4)))
    image = np.zeros((600, 1000, 3), dtype=np.uint8)
    with pytest.raises(FaceError) as error:
        engine.recognize(image, 0.5, 0.45, snapshot())
    assert error.value.status_code == 503
    with pytest.raises(FaceError) as error:
        engine.enroll([image])
    assert error.value.status_code == 503


def test_bad_enrollment_embedding_is_rejected_without_raw_model_details(tmp_path, caplog):
    engine = fake_engine(tmp_path)
    engine._recognizer.feature = lambda aligned: np.full((1, 128), np.nan)
    image = np.zeros((600, 1000, 3), dtype=np.uint8)
    with pytest.raises(FaceError, match="Falha no processamento"):
        engine.enroll([image])
    assert "ValueError" in caplog.text


def test_queue_delay_is_excluded_from_compute_timing(tmp_path):
    engine = fake_engine(tmp_path, 0)
    engine._require_ready = lambda: None

    class DelayedLock:
        def __enter__(self):
            time.sleep(0.04)

        def __exit__(self, *arguments):
            return False

    engine._lock = DelayedLock()
    result = engine.recognize(np.zeros((600, 1000, 3), dtype=np.uint8), 0.5, 0.45, snapshot())
    assert result["timings"]["queue_ms"] >= 30
    assert result["timings"]["total_ms"] < result["timings"]["queue_ms"]


def test_auto_retries_missing_faces_with_bounded_resolution(tmp_path):
    engine = fake_engine(tmp_path, 0)
    image = np.zeros((1600, 4000, 3), dtype=np.uint8)
    result = engine.recognize(image, 'auto', 0.45, snapshot())
    assert engine._detector.images == [(307, 768, 3), (768, 1920, 3)]
    assert result['detection']['requested_scale'] == 'auto'
    assert len(result['detection']['attempts']) == 2
    assert result['detection']['width'] == 1920
    assert result['detection']['refined_faces'] == 0
    assert result['faces'] == []


def test_refinement_selects_same_face_in_original_coordinates(tmp_path):
    engine = fake_engine(tmp_path)
    image = np.zeros((600, 1000, 3), dtype=np.uint8)
    face = np.array([200, 160, 120, 150, 230, 200, 280, 200, 255, 230, 235, 260, 275, 260, .96], dtype=np.float32)
    # The crop begins at (158, 107); the refinement must restore this origin.
    actual = face.copy()
    actual[[0, 4, 6, 8, 10, 12]] -= 158
    actual[[1, 5, 7, 9, 11, 13]] -= 107
    neighbor = actual.copy()
    neighbor[0] += 180
    engine._detect = lambda image, scale: ([neighbor, actual], {})
    refined, used = engine._refine_face(image, face)
    assert used
    assert np.allclose(refined, face)


def test_refinement_never_substitutes_a_neighbor(tmp_path):
    engine = fake_engine(tmp_path)
    face = np.array([100, 100, 100, 100, 120, 130, 170, 130, 150, 150, 130, 170, 170, 170, .96], dtype=np.float32)
    neighbor = face.copy()
    neighbor[0] = 400
    engine._detect = lambda image, scale: ([neighbor], {})
    refined, used = engine._refine_face(np.zeros((600, 1000, 3), dtype=np.uint8), face)
    assert not used
    assert np.array_equal(refined, face)


def test_empty_gallery_skips_expensive_sface_inference(tmp_path):
    engine = fake_engine(tmp_path)
    result = engine.recognize(np.zeros((600, 1000, 3), dtype=np.uint8), .5, .45, snapshot())
    assert result['faces'][0]['status'] == 'unknown'
    assert engine._recognizer.aligned_shapes == []
    assert result['timings']['embedding_ms'] == 0


def test_quality_telemetry_explains_dark_blurred_and_small_faces(tmp_path):
    engine = FaceEngine(tmp_path)
    face = np.array([50, 50, 120, 120, 80, 80, 140, 80, 110, 110, 85, 145, 135, 145, .96], dtype=np.float32)
    image = np.zeros((256, 256, 3), dtype=np.uint8)
    dark = engine._assess_quality(image, face)
    assert dark['brightness'] == 0
    assert dark['sharpness'] == 0
    assert 'iluminação' in dark['reason']
    image[:] = 128
    blurred = engine._assess_quality(image, face)
    assert blurred['brightness'] == 128
    assert 'desfocado' in blurred['reason']
    small = face.copy()
    small[2:4] = 50
    rejected = engine._assess_quality(image, small)
    assert rejected['face_pixels'] == 50
    assert rejected['minimum_pixels'] == 64
    assert 'Aproxime' in rejected['reason']


def test_matching_reports_competition_without_accepting_ambiguous_identity():
    comparison = {}
    status, profile, score, _ = match_embedding(vector(), snapshot(vector(.85), vector(.82)), .45, comparison)
    assert status == 'uncertain'
    assert profile is None
    assert score == .85
    assert comparison['margin'] == pytest.approx(.03)
    assert comparison['runner_up_similarity'] == .82
    assert comparison['accept_above'] == .5


@pytest.mark.parametrize('orientation', [1, 2, 3, 4, 5, 6, 7, 8])
def test_jpeg_native_path_preserves_exif_and_color(orientation):
    image = Image.new('RGB', (120, 80), (30, 140, 210))
    image.paste((220, 60, 40), (0, 0, 60, 40))
    exif = image.getexif()
    exif[274] = orientation
    buffer = io.BytesIO()
    image.save(buffer, format='JPEG', quality=95, exif=exif)
    from PIL import ImageOps
    with Image.open(io.BytesIO(buffer.getvalue())) as original:
        expected = np.ascontiguousarray(np.asarray(ImageOps.exif_transpose(original).convert('RGB'))[:, :, ::-1])
    result = decode_image(buffer.getvalue())
    assert result.shape == expected.shape
    assert np.max(np.abs(result.astype(np.int16) - expected.astype(np.int16))) <= 2


def test_truncated_jpeg_is_rejected_instead_of_returning_partial_pixels():
    buffer = io.BytesIO()
    Image.new('RGB', (256, 256), (40, 140, 200)).save(buffer,format='JPEG')
    with pytest.raises(FaceError) as error:
        decode_image(buffer.getvalue()[:-64])
    assert error.value.status_code == 415


@pytest.mark.parametrize("format", ["PNG", "WEBP"])
@pytest.mark.parametrize("orientation", range(1, 9))
def test_native_formats_preserve_pixels_and_all_exif_orientations(format, orientation):
    from PIL import ImageOps
    image = Image.new("RGB", (120, 80), (40, 130, 210))
    image.paste((230, 50, 20), (0, 0, 60, 40))
    exif = image.getexif()
    exif[274] = orientation
    buffer = io.BytesIO()
    image.save(buffer, format=format, exif=exif)
    with Image.open(io.BytesIO(buffer.getvalue())) as original:
        expected = np.ascontiguousarray(np.asarray(ImageOps.exif_transpose(original).convert("RGB"))[:, :, ::-1])
    actual = decode_image(buffer.getvalue())
    assert np.array_equal(actual, expected)
    assert actual.flags.c_contiguous


@pytest.mark.parametrize("mode", ["RGB", "L", "RGBA", "P", "I;16"])
def test_png_modes_preserve_existing_color_conversion(mode):
    from PIL import ImageOps
    image = Image.new(mode, (80, 64))
    if mode == "I;16":
        image = Image.fromarray(np.arange(80 * 64, dtype=np.uint16).reshape(64, 80))
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    with Image.open(io.BytesIO(buffer.getvalue())) as original:
        expected = np.ascontiguousarray(np.asarray(ImageOps.exif_transpose(original).convert("RGB"))[:, :, ::-1])
    assert np.array_equal(decode_image(buffer.getvalue()), expected)


def test_ordinary_png_avoids_pillow_pixel_decode(monkeypatch):
    from PIL import PngImagePlugin
    buffer = io.BytesIO()
    Image.new("RGB", (80, 64), (30, 120, 200)).save(buffer, format="PNG")
    monkeypatch.setattr(PngImagePlugin.PngImageFile, "load", lambda *_: pytest.fail("PNG pixels should decode only once, in OpenCV."))
    result = decode_image(buffer.getvalue())
    assert result[0, 0].tolist() == [200, 120, 30]


def test_png_late_exif_keeps_orientation():
    import struct
    import zlib
    from PIL import ImageOps
    image = Image.new("RGB", (120, 80), (40, 130, 210))
    image.paste((230, 50, 20), (0, 0, 60, 40))
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    exif = image.getexif()
    exif[274] = 6
    data = exif.tobytes()[6:]
    chunk = struct.pack(">I", len(data)) + b"eXIf" + data + struct.pack(">I", zlib.crc32(b"eXIf" + data))
    content = buffer.getvalue()[:-12] + chunk + buffer.getvalue()[-12:]
    with Image.open(io.BytesIO(content)) as original:
        expected = np.ascontiguousarray(np.asarray(ImageOps.exif_transpose(original).convert("RGB"))[:, :, ::-1])
    assert decode_image(content).shape == (120, 80, 3)
    assert np.array_equal(decode_image(content), expected)


@pytest.mark.parametrize("damage", ["truncated", "crc"])
def test_native_png_rejects_truncation_and_bad_checksums(damage):
    buffer = io.BytesIO()
    Image.new("RGB", (80, 64), (30, 120, 200)).save(buffer, format="PNG")
    content = bytearray(buffer.getvalue())
    if damage == "truncated":
        content = content[:-8]
    else:
        content[-13] ^= 1  # IDAT checksum immediately before IEND.
    with pytest.raises(FaceError) as error:
        decode_image(bytes(content))
    assert error.value.status_code == 415


@pytest.mark.parametrize("format", ["PNG", "WEBP"])
def test_native_formats_reject_animation(format):
    first = Image.new("RGB", (80, 64), (30, 120, 200))
    second = Image.new("RGB", (80, 64), (200, 30, 120))
    buffer = io.BytesIO()
    first.save(buffer, format=format, save_all=True, append_images=[second], duration=100, loop=0)
    with pytest.raises(FaceError, match="estática"):
        decode_image(buffer.getvalue())


def test_benchmark_reports_outliers_and_unstable_identity_decisions(tmp_path):
    engine = fake_engine(tmp_path)
    calls = {}
    def recognize(image, scale, threshold, data, decode_ms=0):
        calls[scale] = calls.get(scale, 0) + 1
        run = calls[scale] - 1
        # The warmup is omitted. Measured runs have one large latency outlier
        # and the middle run changes the predicted identity.
        identity = "other" if run == 2 else "expected"
        duration = {0:0, 1:1, 2:100, 3:2}[run]
        return {"faces":[{"status":"matched", "profile":{"id":identity}, "similarity":.9}],
                "timings":{"total_ms":duration}, "detection":{"requested_scale":scale}}
    engine.recognize = recognize
    result = engine.benchmark(np.zeros((64, 80, 3), dtype=np.uint8), .45, 3, snapshot())
    for row in result["results"]:
        assert row["median_ms"] == 2
        assert row["min_ms"] == 1
        assert row["max_ms"] == 100
        assert row["mean_ms"] == pytest.approx(34.33)
        assert row["stable"] is False


def test_health_remains_available_while_inference_owns_model_lock(tmp_path):
    import threading
    engine = fake_engine(tmp_path)
    expected = engine.health()
    occupied = threading.Event()
    release = threading.Event()
    completed = threading.Event()
    results = []
    def inference():
        with engine._lock:
            occupied.set()
            release.wait(3)
    def read_health():
        results.append(engine.health())
        completed.set()
    worker = threading.Thread(target=inference)
    status_reader = threading.Thread(target=read_health)
    worker.start()
    try:
        assert occupied.wait(1)
        status_reader.start()
        assert completed.wait(1), "Health must respond before inference releases its lock."
        assert results == [expected]
    finally:
        release.set()
        worker.join(3)
        if status_reader.ident:
            status_reader.join(3)


def test_health_never_publishes_partial_model_initialization(tmp_path):
    import threading
    engine = FaceEngine(tmp_path)
    initializing = threading.Event()
    release = threading.Event()
    attempted = threading.Event()
    completed = threading.Event()
    calls = []
    results = []
    def initialize():
        calls.append(True)
        engine._loaded = True
        engine._status = "ready"
        initializing.set()
        assert release.wait(3)
        engine._message = "Initialization complete."
    engine._initialize = initialize
    def second_health():
        attempted.set()
        results.append(engine.health())
        completed.set()
    first = threading.Thread(target=engine.health)
    second = threading.Thread(target=second_health)
    first.start()
    try:
        assert initializing.wait(1)
        second.start()
        assert attempted.wait(1)
        assert not completed.wait(.1), "Model warmup has not completed yet."
    finally:
        release.set()
        first.join(3)
        if second.ident:
            second.join(3)
    assert calls == [True]
    assert results == [("ready", "Initialization complete.")]


def test_cancelled_waiting_inference_exits_without_acquiring_busy_model(tmp_path):
    import threading
    from developer_test.engine import ProcessingCancelled
    engine = fake_engine(tmp_path)
    occupied, release, cancelled, finished = (threading.Event() for _ in range(4))
    errors = []
    def holder():
        with engine._lock:
            occupied.set()
            release.wait(3)
    def query():
        try:
            engine.recognize(np.zeros((600,1000,3),np.uint8),.5,.45,snapshot(vector()),cancel=cancelled)
        except ProcessingCancelled as error:
            errors.append(error)
        finally:
            finished.set()
    holding = threading.Thread(target=holder)
    waiting = threading.Thread(target=query)
    holding.start()
    try:
        assert occupied.wait(1)
        waiting.start()
        cancelled.set()
        assert finished.wait(1),"Cancelled work must not wait for the native lock to be released."
        assert len(errors)==1 and errors[0].status_code==499
        assert engine._detector.images==[]
    finally:
        release.set()
        holding.join(3)
        if waiting.ident:
            waiting.join(3)


def test_benchmark_cancelled_between_runs_does_not_execute_remaining_strategies(tmp_path):
    import threading
    from developer_test.engine import ProcessingCancelled
    engine = fake_engine(tmp_path)
    cancel = threading.Event()
    calls = []
    original = engine.recognize
    def recognize(*args,**kwargs):
        calls.append(args[1])
        result = original(*args,**kwargs)
        if len(calls)==3:
            cancel.set()
        return result
    engine.recognize = recognize
    with pytest.raises(ProcessingCancelled):
        engine.benchmark(np.zeros((600,1000,3),np.uint8),.45,5,snapshot(vector()),cancel=cancel)
    assert calls==['auto']*3
    cancel.clear()
    assert original(np.zeros((600,1000,3),np.uint8),.5,.45,snapshot(vector()))['faces'][0]['status']=='matched'


def test_cancel_during_native_detection_skips_feature_extraction_and_retry(tmp_path):
    import threading
    from developer_test.engine import ProcessingCancelled
    engine = fake_engine(tmp_path,0)
    cancel = threading.Event()
    original = engine._detector.detect
    def detect(image):
        result = original(image)
        cancel.set()
        return result
    engine._detector.detect = detect
    with pytest.raises(ProcessingCancelled):
        engine.recognize(np.zeros((1200,2400,3),np.uint8),'auto',.45,snapshot(vector()),cancel=cancel)
    assert len(engine._detector.images)==1
    assert engine._recognizer.aligned_shapes==[]
