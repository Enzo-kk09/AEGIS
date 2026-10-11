"""Versioned public rules shared by processing, controls and diagnostics."""
import hashlib
import json

MAX_UPLOAD_BYTES=8*1024*1024
MAX_REQUEST_BYTES=42*1024*1024
MAX_PIXELS=8_000_000
MAX_EDGE=8192
MIN_IMAGE_EDGE=32
MAX_REFERENCES=5
MAX_PROCESSED_FACES=10
SCALES=(1.0,.5,.25,.1)
DEFAULT_THRESHOLD=.45
MIN_THRESHOLD=.30
MAX_THRESHOLD=.90
UNCERTAINTY_BAND=.05
IDENTITY_MARGIN=.05
CONSISTENCY_MIN=.40
DUPLICATE_FACE_MIN=.45
REDUNDANCY_MIN=.985
AUTO_DETECTION_EDGE=768
AUTO_RETRY_EDGE=1920
REFINE_BELOW_PIXELS=96
REFINE_MIN_OVERLAP=.4
RECOGNITION_MIN_PIXELS=64
ENROLLMENT_MIN_PIXELS=100
RECOGNITION_MIN_SHARPNESS=20
ENROLLMENT_MIN_SHARPNESS=35
BRIGHTNESS_MIN=35
BRIGHTNESS_MAX=225
CROP_TOLERANCE=.03
MIN_EYE_RATIO=.12
TARGET_ANALYSES_PER_SECOND=5
MIN_ANALYSIS_INTERVAL_MS=100
MAX_RECORDS=1000
CAMERA_WIDTH=1280
CAMERA_HEIGHT=720
JPEG_QUALITY=.92
SESSION_DURATIONS=(30,60,180)
MIN_BENCHMARK_ITERATIONS=1
MAX_BENCHMARK_ITERATIONS=5
TEMPORAL_MIN_SAMPLES=3
TEMPORAL_MIN_SPAN_MS=400
TEMPORAL_WINDOW_MS=2000
TEMPORAL_MAX_GAP_MS=1000
TEMPORAL_MAX_RESPONSE_AGE_MS=1500
TEMPORAL_MIN_OVERLAP=.3


def public_rules():
    rules={
        'version':1,
        'decision':{'default_threshold':DEFAULT_THRESHOLD,'min_threshold':MIN_THRESHOLD,
                    'max_threshold':MAX_THRESHOLD,'uncertainty_band':UNCERTAINTY_BAND,'identity_margin':IDENTITY_MARGIN},
        'quality':{'recognition_min_pixels':RECOGNITION_MIN_PIXELS,'enrollment_min_pixels':ENROLLMENT_MIN_PIXELS,
                   'recognition_min_sharpness':RECOGNITION_MIN_SHARPNESS,'enrollment_min_sharpness':ENROLLMENT_MIN_SHARPNESS,
                   'brightness_min':BRIGHTNESS_MIN,'brightness_max':BRIGHTNESS_MAX,
                   'crop_tolerance':CROP_TOLERANCE,'min_eye_ratio':MIN_EYE_RATIO},
        'enrollment':{'max_references':MAX_REFERENCES,'consistency_min':CONSISTENCY_MIN,
                      'duplicate_face_min':DUPLICATE_FACE_MIN,'redundancy_min':REDUNDANCY_MIN},
        'upload':{'max_bytes':MAX_UPLOAD_BYTES,'max_pixels':MAX_PIXELS,'max_edge':MAX_EDGE,'min_edge':MIN_IMAGE_EDGE},
        'detector':{'scales':list(SCALES),'auto_edge':AUTO_DETECTION_EDGE,'retry_edge':AUTO_RETRY_EDGE,
                    'refine_below_pixels':REFINE_BELOW_PIXELS,'refine_min_overlap':REFINE_MIN_OVERLAP,
                    'max_processed_faces':MAX_PROCESSED_FACES},
        'capture':{'target_analyses_per_second':TARGET_ANALYSES_PER_SECOND,'min_interval_ms':MIN_ANALYSIS_INTERVAL_MS,
                   'max_records':MAX_RECORDS,'camera_width':CAMERA_WIDTH,'camera_height':CAMERA_HEIGHT,
                   'jpeg_quality':JPEG_QUALITY,'session_durations':list(SESSION_DURATIONS)},
        'benchmark':{'min_iterations':MIN_BENCHMARK_ITERATIONS,'max_iterations':MAX_BENCHMARK_ITERATIONS,'warmups':1},
        'temporal':{'min_samples':TEMPORAL_MIN_SAMPLES,'min_span_ms':TEMPORAL_MIN_SPAN_MS,
                    'window_ms':TEMPORAL_WINDOW_MS,'max_gap_ms':TEMPORAL_MAX_GAP_MS,
                    'max_response_age_ms':TEMPORAL_MAX_RESPONSE_AGE_MS,'min_overlap':TEMPORAL_MIN_OVERLAP},
    }
    rules['revision']=hashlib.sha256(json.dumps(rules,sort_keys=True,separators=(',',':')).encode()).hexdigest()[:16]
    return rules
