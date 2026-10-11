"""Identify the backend source loaded at startup, without reading biometric data."""
import hashlib
from pathlib import Path

from .download_models import MODELS, REVISION


def backend_provenance():
    root=Path(__file__).resolve().parent
    digest=hashlib.sha256()
    for name in ['app.py','engine.py','rules.py','storage.py','enrollment.py','uploads.py','download_models.py','provenance.py']:
        digest.update(name.encode())
        digest.update((root/name).read_bytes())
    digest.update((root/'requirements.txt').read_bytes())
    return {'backend_revision':digest.hexdigest()[:16],'model_revision':REVISION,
            'model_checksums':{model['name']:model['sha256'] for model in MODELS}}
