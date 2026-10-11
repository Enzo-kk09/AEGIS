import argparse
import io
import json
from pathlib import Path

from PIL import Image
from developer_test.rules import public_rules
from playwright.sync_api import expect, sync_playwright


def picture(name, size):
    output = io.BytesIO()
    Image.new("RGB", size, color=(90, 130, 180)).save(output, format="PNG")
    return {"name": name, "mimeType": "image/png", "buffer": output.getvalue()}


def reply(route, payload):
    if route.request.url.endswith('/health'):
        payload = {**payload, 'rules':public_rules()}
    route.fulfill(status=200, content_type="application/json", body=json.dumps(payload))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", default="http://127.0.0.1:8765/DeveloperTest.html")
    parser.add_argument("--browser", default=r"C:\Program Files\Google\Chrome\Application\chrome.exe")
    arguments = parser.parse_args()
    if not Path(arguments.browser).is_file():
        raise SystemExit("Informe o navegador instalado com --browser.")
    failures = []
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(executable_path=arguments.browser, headless=True)
        profiles = [{"id": "a" * 32, "name": "Perfil local", "samples": 1, "created_at": "2026-01-01T12:00:00Z"}]
        context = browser.new_context()
        context.route("**/api/dev/health", lambda route: reply(route, {"status": "models_missing", "token": "test-token", "profile_count": 1, "message": "Prepare os modelos."}))

        def profile_request(route):
            if route.request.method == "DELETE":
                assert route.request.headers["x-aegis-token"] == "test-token"
                profiles.clear()
                reply(route, {"deleted": True})
            else:
                reply(route, {"profiles": profiles})

        context.route("**/api/dev/profiles**", profile_request)
        page = context.new_page()
        page.on("pageerror", lambda error: failures.append(str(error)))
        page.on("dialog", lambda dialog: dialog.accept())
        page.goto(arguments.url, wait_until="networkidle")
        page.locator('#dev-tab-profiles').click()
        expect(page.locator("#dev-start")).to_be_disabled()
        expect(page.locator("#dev-refresh-profiles")).to_be_enabled()
        expect(page.locator(".dev-profile-delete")).to_be_enabled()
        page.locator(".dev-profile-delete").click()
        expect(page.locator("#dev-profiles")).to_contain_text("Nenhum perfil cadastrado")
        context.close()

        context = browser.new_context()
        context.route("**/api/dev/health", lambda route: reply(route, {"status": "ready", "token": "test-token", "profile_count": 0}))
        context.route("**/api/dev/profiles", lambda route: reply(route, {"profiles": []}))
        requests = []
        context.route("**/api/dev/recognize", lambda route: requests.append(route.request) or reply(route, {"faces": []}))
        context.add_init_script("""
            const decode = window.createImageBitmap.bind(window);
            window.__holdDecode = false;
            window.createImageBitmap = async (...args) => {
                const bitmap = await decode(...args);
                if (window.__holdDecode) await new Promise(resolve => { window.__releaseDecode = resolve; });
                return bitmap;
            };
        """)
        page = context.new_page()
        page.on("pageerror", lambda error: failures.append(str(error)))
        page.goto(arguments.url, wait_until="networkidle")
        page.locator('#dev-source-image').click()
        page.locator("#dev-test-image").set_input_files(picture("first.png", (100, 100)))
        expect(page.locator("#dev-recognize-image")).to_be_enabled()
        page.evaluate("window.__holdDecode = true")
        page.locator("#dev-test-image").set_input_files(picture("second.png", (200, 100)))
        page.wait_for_function("typeof window.__releaseDecode === 'function'")
        expect(page.locator("#dev-recognize-image")).to_be_disabled()
        expect(page.locator("#dev-benchmark")).to_be_disabled()
        page.evaluate("document.querySelector('#dev-recognize-image').dispatchEvent(new Event('click')); window.__releaseDecode(); window.__holdDecode = false;")
        expect(page.locator("#dev-recognize-image")).to_be_enabled()
        expect(page.locator("#dev-image-name")).to_contain_text("second.png")
        assert page.locator("#dev-image-canvas").evaluate("canvas => canvas.width") == 200
        assert not requests
        page.locator("#dev-test-image").set_input_files({"name": "broken.png", "mimeType": "image/png", "buffer": b"invalid"})
        expect(page.locator("#dev-message")).to_contain_text("Não foi possível abrir a imagem")
        expect(page.locator("#dev-recognize-image")).to_be_enabled()
        page.locator("#dev-clear-image").click()
        expect(page.locator("#dev-recognize-image")).to_be_disabled()
        expect(page.locator("#dev-image-preview")).to_be_hidden()
        context.close()
        context = browser.new_context()
        available = [False]
        token = ["test-token"]
        saved = []
        submissions = []
        context.route("**/api/dev/health", lambda route: reply(route, {"status": "ready", "token": token[0], "profile_count": len(saved)}) if available[0] else route.abort())

        def registration_request(route):
            if route.request.method == "POST":
                submissions.append(route.request.headers["x-aegis-token"])
                if route.request.headers["x-aegis-token"] != token[0]:
                    route.fulfill(status=403, content_type="application/json", body=json.dumps({"detail":"Sessao expirada."}))
                    return
                saved.append({"id": "b" * 32, "name": "Teste reconexao", "samples": 3})
                reply(route, {"profile": saved[0]})
            else:
                reply(route, {"profiles": saved})

        context.route("**/api/dev/profiles", registration_request)
        page = context.new_page()
        page.on("pageerror", lambda error: failures.append(str(error)))
        page.goto(arguments.url, wait_until="networkidle")
        page.locator("#dev-tab-profiles").click()
        page.locator("#dev-name").fill("Teste reconexao")
        page.locator("#dev-enroll-images").set_input_files([picture(f"reference-{index}.png", (100, 100)) for index in range(3)])
        expect(page.locator("#dev-enroll-submit")).to_be_disabled()
        expect(page.locator("#dev-enroll-status")).to_contain_text("Cadastro ainda não salvo")
        expect(page.locator("#dev-profile-connection")).to_be_visible()
        available[0] = True
        expect(page.locator("#dev-enroll-submit")).to_be_enabled(timeout=12000)
        expect(page.locator("#dev-profile-connection")).to_be_hidden()
        expect(page.locator("#dev-name")).to_have_value("Teste reconexao")
        expect(page.locator("#dev-enroll-previews img")).to_have_count(3)
        assert not saved, "Reconnecting must not submit the registration."
        # Restarting the server rotates its token; reauthentication preserves
        # the form and never retries a mutating request automatically.
        token[0] = "new-session-token"
        page.locator("#dev-enroll-submit").click()
        expect(page.locator("#dev-message")).to_contain_text("Sessao expirada")
        expect(page.locator("#dev-enroll-submit")).to_be_enabled(timeout=12000)
        expect(page.locator("#dev-name")).to_have_value("Teste reconexao")
        expect(page.locator("#dev-enroll-previews img")).to_have_count(3)
        assert not saved
        assert submissions == ["test-token"]
        page.locator("#dev-enroll-submit").click()
        expect(page.locator("#dev-message")).to_contain_text("Perfil Teste reconexao cadastrado")
        expect(page.locator("#dev-enroll-previews img")).to_have_count(0)
        assert len(saved) == 1
        assert submissions == ["test-token", "new-session-token"]
        context.close()
        browser.close()
    assert not failures, failures
    print("Browser regressions: profiles without models, image handling and connection recovery preserving unsaved references passed.")


if __name__ == "__main__":
    main()
