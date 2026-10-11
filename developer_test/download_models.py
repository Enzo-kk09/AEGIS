import argparse
import hashlib
import json
import os
import sys
import tempfile
import urllib.request
from pathlib import Path


REVISION = "47534e27c9851bb1128ccc0102f1145e27f23f98"
MODELS = (
    {
        "name": "YuNet",
        "directory": "face_detection_yunet",
        "filename": "face_detection_yunet_2023mar.onnx",
        "sha256": "8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4",
        "size": 232589,
        "license": "MIT",
        "license_filename": "YuNet-LICENSE.txt",
        "license_size": 1085,
        "license_sha256": "c83b8120c50ccbd4c4f96edf53141bdd566ebb8f8e9227e415326aa1b1aba958",
    },
    {
        "name": "SFace",
        "directory": "face_recognition_sface",
        "filename": "face_recognition_sface_2021dec.onnx",
        "sha256": "0ba9fbfa01b5270c96627c4ef784da859931e02f04419c829e83484087c34e79",
        "size": 38696353,
        "license": "Apache-2.0",
        "license_filename": "SFace-LICENSE.txt",
        "license_size": 11358,
        "license_sha256": "cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30",
    },
)
DEFAULT_DIRECTORY = Path(__file__).resolve().parent / "models"


def model_url(model):
    return (
        f"https://media.githubusercontent.com/media/opencv/opencv_zoo/{REVISION}"
        f"/models/{model['directory']}/{model['filename']}"
    )


def license_url(model):
    return (
        f"https://raw.githubusercontent.com/opencv/opencv_zoo/{REVISION}"
        f"/models/{model['directory']}/LICENSE"
    )


def valid_model(path, model):
    if not path.is_file() or path.stat().st_size != model["size"]:
        return False
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest() == model["sha256"]


def download_file(url, destination, expected_size=None, expected_hash=None):
    destination = Path(destination)
    temporary = None
    digest = hashlib.sha256()
    size = 0
    request = urllib.request.Request(url, headers={"User-Agent": "AEGIS-Developer-Test/1.0"})
    try:
        with urllib.request.urlopen(request, timeout=90) as response, tempfile.NamedTemporaryFile(mode="wb", dir=destination.parent, prefix=destination.name + ".", suffix=".download", delete=False) as output:
            temporary = Path(output.name)
            if not response.geturl().startswith("https://"):
                raise RuntimeError("Redirecionamento inseguro no download.")
            for chunk in iter(lambda: response.read(1024 * 1024), b""):
                size += len(chunk)
                if size > (expected_size if expected_size is not None else 1024 * 1024):
                    raise RuntimeError("O arquivo excedeu o tamanho esperado.")
                digest.update(chunk)
                output.write(chunk)
            output.flush()
            os.fsync(output.fileno())
        if expected_size is not None and size != expected_size:
            raise RuntimeError("O tamanho do modelo não corresponde ao manifesto oficial.")
        if expected_hash is not None and digest.hexdigest() != expected_hash:
            raise RuntimeError("A verificação SHA-256 do modelo falhou.")
        temporary.replace(destination)
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)


def download_models(directory=DEFAULT_DIRECTORY):
    directory = Path(directory)
    directory.mkdir(parents=True, exist_ok=True)
    manifest = {"repository": "https://github.com/opencv/opencv_zoo", "revision": REVISION, "models": []}
    for model in MODELS:
        target = directory / model["filename"]
        if valid_model(target, model):
            print(f"{model['name']}: SHA-256 verificado.")
        else:
            print(f"Baixando {model['name']} ({model['size'] / 1024 / 1024:.1f} MB)...")
            download_file(model_url(model), target, model["size"], model["sha256"])
            print(f"{model['name']}: download e SHA-256 verificados.")
        license_target = directory / model["license_filename"]
        license_metadata = {"size": model["license_size"], "sha256": model["license_sha256"]}
        if not valid_model(license_target, license_metadata):
            download_file(license_url(model), license_target, model["license_size"], model["license_sha256"])
        manifest["models"].append({**model, "url": model_url(model), "license_url": license_url(model)})
    destination = directory / "manifest.json"
    contents = json.dumps(manifest, ensure_ascii=False, indent=2) + "\n"
    if destination.is_file() and destination.read_text(encoding="utf-8") == contents:
        return
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", newline="\n", dir=directory, prefix="manifest.", suffix=".download", delete=False) as output:
            temporary = Path(output.name)
            output.write(contents)
            output.flush()
            os.fsync(output.fileno())
        temporary.replace(destination)
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)


def main():
    parser = argparse.ArgumentParser(description="Baixa e verifica os modelos oficiais usados pelo Developer Test.")
    parser.add_argument("--directory", type=Path, default=DEFAULT_DIRECTORY)
    arguments = parser.parse_args()
    try:
        download_models(arguments.directory)
    except (OSError, RuntimeError) as error:
        print(f"Falha ao preparar os modelos: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
