import hashlib
import io
import json

import pytest

import developer_test.download_models as module


class Response(io.BytesIO):
    def geturl(self):
        return "https://media.githubusercontent.com/verified-model"


@pytest.mark.parametrize("expected_size, expected_hash", [(3, hashlib.sha256(b"bad").hexdigest()), (2, hashlib.sha256(b"new").hexdigest()), (4, hashlib.sha256(b"new").hexdigest())])
def test_failed_download_preserves_existing_file_and_removes_temporary_file(tmp_path, monkeypatch, expected_size, expected_hash):
    target = tmp_path / "model.onnx"
    target.write_bytes(b"old")
    monkeypatch.setattr(module.urllib.request, "urlopen", lambda *arguments, **keywords: Response(b"new"))
    with pytest.raises(RuntimeError):
        module.download_file("https://official.example/model", target, expected_size, expected_hash)
    assert target.read_bytes() == b"old"
    assert list(tmp_path.glob("*.download")) == []


def test_successful_download_is_atomic_verified_and_does_not_use_fixed_temporary_name(tmp_path, monkeypatch):
    target = tmp_path / "model.onnx"
    target.write_bytes(b"old")
    legacy_temporary = tmp_path / "model.onnx.download"
    legacy_temporary.write_bytes(b"another process")
    monkeypatch.setattr(module.urllib.request, "urlopen", lambda *arguments, **keywords: Response(b"new"))
    module.download_file("https://official.example/model", target, 3, hashlib.sha256(b"new").hexdigest())
    assert target.read_bytes() == b"new"
    assert legacy_temporary.read_bytes() == b"another process"
    assert list(tmp_path.glob("model.onnx.*.download")) == []


def test_cached_models_and_licenses_skip_network_and_manifest_rewrite(tmp_path, monkeypatch):
    value = b"model"
    license_contents = b"license"
    model = {"name": "Test", "directory": "test", "filename": "test.onnx", "sha256": hashlib.sha256(value).hexdigest(), "size": len(value), "license": "MIT", "license_filename": "LICENSE.txt", "license_size": len(license_contents), "license_sha256": hashlib.sha256(license_contents).hexdigest()}
    monkeypatch.setattr(module, "MODELS", (model,))
    (tmp_path / model["filename"]).write_bytes(value)
    (tmp_path / model["license_filename"]).write_bytes(license_contents)
    monkeypatch.setattr(module.urllib.request, "urlopen", lambda *arguments, **keywords: pytest.fail("Cached installation attempted network access."))
    module.download_models(tmp_path)
    manifest = tmp_path / "manifest.json"
    contents = json.loads(manifest.read_text(encoding="utf-8"))
    assert contents["revision"] == module.REVISION
    assert module.REVISION in contents["models"][0]["url"]
    assert module.REVISION in contents["models"][0]["license_url"]
    monkeypatch.setattr(module.tempfile, "NamedTemporaryFile", lambda *arguments, **keywords: pytest.fail("Unchanged manifest was rewritten."))
    module.download_models(tmp_path)
