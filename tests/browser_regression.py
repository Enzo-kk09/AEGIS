import argparse
import base64
import json
import os
import struct
import sys
import tempfile
import unittest
import uuid
import zlib
from pathlib import Path
from urllib.parse import urlparse

from playwright.sync_api import expect, sync_playwright


parser = argparse.ArgumentParser()
parser.add_argument("--base-url", default="http://127.0.0.1:8765")
parser.add_argument("--browser")
parser.add_argument("--face", type=Path)
parser.add_argument("--other-face", type=Path)
arguments, unittest_arguments = parser.parse_known_args()
BASE_URL = arguments.base_url.rstrip("/")
STORAGE_KEY = "aegis.frontend.v1"
SESSION_KEY = "aegis.demo.session"
PAGES = {
    "DadosGerais.html": "Dados gerais",
    "Alunos.html": "Alunos",
    "Identificacoes.html": "Identificações",
    "Eventos.html": "Eventos",
    "Movimentacao.html": "Movimentação dos alunos",
    "PRB.html": "Área PRB",
    "Relatorio.html": "Relatório geral",
    "Configuracoes.html": "Configurações",
    "Suporte.html": "Ajuda e suporte",
    "Privacidade.html": "Política de Privacidade",
    "SolicitarAcesso.html": "Solicitar acesso à plataforma",
    "DeveloperTest.html": "Developer TestLAB 02",
}


def browser_path():
    if arguments.browser:
        return arguments.browser
    for candidate in (
        os.getenv("AEGIS_TEST_BROWSER", ""),
        r"C:\Program Files\Google\Chrome\Application\chrome.exe",
        r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
        "/usr/bin/google-chrome",
        "/usr/bin/chromium",
        "/usr/bin/chromium-browser",
    ):
        if candidate and Path(candidate).is_file():
            return candidate
    return None


def generated_png(width=512, height=512):
    def chunk(kind, data):
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)

    header = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
    pixels = b"".join(b"\x00" + b"\xe7\xee\xf8" * width for _ in range(height))
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", header) + chunk(b"IDAT", zlib.compress(pixels)) + chunk(b"IEND", b"")


class BrowserRegression(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.playwright = sync_playwright().start()
        cls.browser = cls.playwright.chromium.launch(executable_path=browser_path(), headless=True)

    @classmethod
    def tearDownClass(cls):
        cls.browser.close()
        cls.playwright.stop()

    def setUp(self):
        self.context = self.browser.new_context(viewport={"width": 1440, "height": 900}, timezone_id="America/Sao_Paulo")
        self.page = self.context.new_page()
        self.errors = []
        self.failed_assets = []
        self.page.on("pageerror", lambda error: self.errors.append(str(error)))
        self.page.on("response", self.track_asset)
        self.page.on("dialog", lambda dialog: dialog.accept())

    def tearDown(self):
        self.context.close()
        self.assertEqual(self.errors, [], "Unhandled browser errors")
        self.assertEqual(self.failed_assets, [], "Static assets failed to load")

    def track_asset(self, response):
        parsed = urlparse(response.url)
        if response.status >= 400 and response.url.startswith(BASE_URL) and parsed.path.endswith((".js", ".css", ".html", ".png", ".svg")):
            self.failed_assets.append({"url": response.url, "status": response.status})

    def goto(self, filename):
        response = self.page.goto(f"{BASE_URL}/{filename}", wait_until="networkidle")
        self.assertTrue(response.ok, response.status)

    def login(self):
        self.goto("index.html")
        self.page.locator("[data-action=demo-login]").click()
        expect(self.page.locator("h1")).to_have_text("Dados gerais")

    def state(self):
        return self.page.evaluate("key => JSON.parse(localStorage.getItem(key))", STORAGE_KEY)

    def submit(self, form_id):
        self.page.locator(f"#{form_id} button[type=submit]").click()

    def assert_no_overflow(self):
        self.assertLessEqual(self.page.evaluate("document.documentElement.scrollWidth - window.innerWidth"), 1)

    def download(self, action):
        with self.page.expect_download() as pending:
            self.page.locator(f"[data-action={action}]").click()
        with tempfile.TemporaryDirectory(prefix="aegis-browser-") as directory:
            destination = Path(directory) / pending.value.suggested_filename
            pending.value.save_as(str(destination))
            return destination.read_text(encoding="utf-8-sig")

    def test_authentication_guard_and_password_toggle(self):
        self.goto("Alunos.html")
        expect(self.page.locator("#login-form")).to_be_visible()
        self.page.locator("#institution").fill("Instituição de teste")
        self.page.locator("#password").fill("wrong-password")
        self.submit("login-form")
        expect(self.page.locator("#login-form .form-error")).to_contain_text("Senha incorreta")
        self.page.locator("[data-action=toggle-password]").click()
        expect(self.page.locator("#password")).to_have_attribute("type", "text")
        expect(self.page.locator("#institution")).to_have_value("Instituição de teste")
        self.page.locator("#password").fill("AEGIS2026")
        self.submit("login-form")
        expect(self.page.locator("h1")).to_have_text("Dados gerais")
        self.page.locator("[data-action=profile]").click()
        self.page.locator("[data-action=logout]").click()
        expect(self.page.locator("#login-form")).to_be_visible()
        self.assertIsNone(self.page.evaluate("key => sessionStorage.getItem(key)", SESSION_KEY))

    def test_blocked_session_storage_reports_error(self):
        self.page.add_init_script("""
          const originalSet=Storage.prototype.setItem;
          Storage.prototype.setItem=function(key,value){
            if(this===sessionStorage)throw new DOMException('Blocked for regression test','QuotaExceededError');
            return originalSet.call(this,key,value);
          };
        """)
        self.goto("index.html")
        self.page.locator("#institution").fill("Instituição de teste")
        self.page.locator("#password").fill("AEGIS2026")
        self.submit("login-form")
        expect(self.page.locator("#login-form .form-error")).to_contain_text("armazenamento")
        expect(self.page.locator("#login-form")).to_be_visible()
        self.assertIsNone(self.page.evaluate("key => sessionStorage.getItem(key)", SESSION_KEY))

    def test_invalid_local_state_is_preserved_on_login(self):
        self.goto("index.html")
        self.page.evaluate("key => localStorage.setItem(key, '{invalid-json')", STORAGE_KEY)
        self.page.reload(wait_until="networkidle")
        self.page.locator("[data-action=demo-login]").click()
        expect(self.page.locator("h1")).to_have_text("Dados gerais")
        expect(self.page.locator("main")).to_contain_text("dados locais")
        self.assertEqual(self.page.evaluate("key => localStorage.getItem(key)", STORAGE_KEY), "{invalid-json")
        self.goto("Configuracoes.html")
        self.submit("settings-form")
        expect(self.page.locator("#toasts")).to_contain_text("restaure o armazenamento")
        self.assertEqual(self.page.evaluate("key => localStorage.getItem(key)", STORAGE_KEY), "{invalid-json")

    def test_all_routes_desktop_mobile_and_accessible_fields(self):
        self.login()
        for filename, title in PAGES.items():
            with self.subTest(page=filename):
                self.goto(filename)
                expect(self.page.locator("h1")).to_have_text(title)
                self.assert_no_overflow()
                unlabeled = self.page.evaluate("""() => [...document.querySelectorAll('input:not([type=hidden]),select,textarea')]
                  .filter(el => !el.labels.length && !el.getAttribute('aria-label') && !el.getAttribute('aria-labelledby'))
                  .map(el => el.outerHTML)""")
                self.assertEqual(unlabeled, [])
                for textarea in self.page.locator("textarea[required]").all():
                    expect(textarea).to_have_value("")
                ids = self.page.evaluate("""() => {const ids=[...document.querySelectorAll('[id]')].map(el=>el.id);return ids.filter((id,index)=>ids.indexOf(id)!==index);} """)
                self.assertEqual(ids, [])
                self.page.set_viewport_size({"width": 390, "height": 844})
                self.assert_no_overflow()
                self.page.set_viewport_size({"width": 1440, "height": 900})

    def test_student_crud_filters_photo_and_export(self):
        self.login()
        self.goto("Alunos.html")
        self.page.locator("[data-action=new-student]").click()
        self.page.locator("#student-name").fill("Teste Aluno Árvore")
        self.page.locator("#student-enrollment").fill("REGRESSION-1")
        self.page.locator("#student-class-name").fill("TESTE 99")
        self.page.locator("#student-email").fill("aluno@example.com")
        self.page.locator("#student-photo").set_input_files({"name": "generated.png", "mimeType": "image/png", "buffer": generated_png(128, 128)})
        self.submit("student-form")
        expect(self.page.locator("#modal")).not_to_be_visible()
        student = next(student for student in self.state()["students"] if student["enrollment"] == "REGRESSION-1")
        self.assertTrue(student["photo"].startswith("data:image/png;base64,"))
        student_id = student["id"]
        self.page.locator(f"[data-action=edit-student][data-id='{student_id}']").click()
        self.page.locator("#student-name").fill("Teste Aluno Editado")
        self.page.locator("#student-status").select_option("inactive")
        self.page.locator("input[name=removePhoto]").check()
        self.submit("student-form")
        expect(self.page.locator("#modal")).not_to_be_visible()
        self.page.locator("#student-search input").fill("aluno editado")
        expect(self.page.locator("tbody tr")).to_have_count(1)
        self.page.locator("[data-action=student-filters]").click()
        self.page.locator("#student-status-filter").select_option("active")
        self.submit("student-filter-form")
        expect(self.page.locator("tbody tr")).to_have_count(0)
        self.page.locator("[data-action=student-filters]").click()
        self.page.locator("#student-status-filter").select_option("inactive")
        self.submit("student-filter-form")
        expect(self.page.locator("tbody tr")).to_have_count(1)
        self.assertIn("Teste Aluno Editado", self.download("export-students"))
        self.page.locator(f"[data-action=view-student][data-id='{student_id}']").click()
        expect(self.page.locator("#modal")).to_contain_text("Teste Aluno Editado")
        self.page.keyboard.press("Escape")
        expect(self.page.locator("#modal")).not_to_be_visible()
        self.page.locator(f"[data-action=delete-student][data-id='{student_id}']").click()
        self.page.locator("[data-action=confirm-delete]").click()
        self.assertFalse(any(student["id"] == student_id for student in self.state()["students"]))

    def test_student_duplicate_enrollment_rejected(self):
        self.login()
        self.goto("Alunos.html")
        self.page.locator("[data-action=new-student]").click()
        self.page.locator("#student-name").fill("Aluno duplicado")
        self.page.locator("#student-enrollment").fill("2026001")
        self.page.locator("#student-class-name").fill("TESTE 99")
        self.submit("student-form")
        expect(self.page.locator("#student-form .form-error")).to_contain_text("já está cadastrada")
        expect(self.page.locator("#modal")).to_be_visible()

    def test_cross_tab_write_conflict_preserves_newer_records(self):
        self.login()
        self.goto("Alunos.html")
        self.page.locator("[data-action=edit-student][data-id=s1]").click()
        self.page.locator("#student-name").fill("Alteração pendente na primeira aba")
        second = self.context.new_page()
        second.goto(BASE_URL + "/index.html", wait_until="networkidle")
        second.locator("[data-action=demo-login]").click()
        expect(second.locator("h1")).to_have_text("Dados gerais")
        second.goto(BASE_URL + "/Alunos.html", wait_until="networkidle")
        second.locator("[data-action=new-student]").click()
        second.locator("#student-name").fill("Aluno criado na segunda aba")
        second.locator("#student-enrollment").fill("SECOND-TAB")
        second.locator("#student-class-name").fill("TESTE 99")
        second.locator("#student-form button[type=submit]").click()
        expect(second.locator("#modal")).not_to_be_visible()
        self.submit("student-form")
        expect(self.page.locator("#modal")).to_be_visible()
        expect(self.page.locator("#toasts")).to_contain_text("Os dados mudaram em outra aba")
        students = self.state()["students"]
        self.assertTrue(any(student["enrollment"] == "SECOND-TAB" for student in students))
        self.assertEqual(next(student["name"] for student in students if student["id"] == "s1"), "Roberto Almeida")
        second.close()

    def test_dashboard_filters_and_global_search(self):
        self.login()
        self.page.locator("[data-action=camera-filters]").click()
        self.page.locator("#camera-status").select_option("unknown")
        self.submit("camera-filter-form")
        expect(self.page.locator("[data-action=camera-detail]")).to_have_count(1)
        self.page.locator("[data-action=camera-detail]").click()
        expect(self.page.locator("#modal")).to_be_visible()
        self.page.keyboard.press("Escape")
        self.page.locator("#global-search-form input").fill("Laura")
        self.page.locator("#global-search-form input").press("Enter")
        expect(self.page.locator("h1")).to_have_text("Alunos")
        expect(self.page.locator("tbody tr")).to_have_count(1)
        expect(self.page.locator("tbody")).to_contain_text("Laura Braga")
        self.page.locator("#global-search-form input").fill("Biblioteca")
        self.page.locator("#global-search-form input").press("Enter")
        expect(self.page.locator("h1")).to_have_text("Dados gerais")
        expect(self.page.locator("[data-action=camera-detail]")).to_have_count(1)
        expect(self.page.locator("#camera-select")).to_have_value("cam04")

    def test_settings_consult_support_request_and_events(self):
        self.login()
        self.goto("Configuracoes.html")
        self.page.locator("#threshold").evaluate("element => { element.value='87'; element.dispatchEvent(new Event('input', {bubbles:true})); }")
        self.page.locator("#settings-form input[name=recognition]").uncheck()
        self.submit("settings-form")
        self.assertEqual(self.state()["settings"]["threshold"], 87)
        self.assertFalse(self.state()["settings"]["recognition"])
        self.page.locator("#consult-days").select_option("7")
        self.page.locator("#consult-reason").fill("Consulta para validação automática")
        self.submit("consult-form")
        self.assertEqual(self.state()["settings"]["consultaDays"], "7")
        self.goto("Suporte.html")
        self.page.locator("#help-need").fill("Necessidade registrada pelo teste de regressão")
        self.submit("help-form")
        self.assertEqual(len(self.state()["tickets"]), 1)
        self.goto("SolicitarAcesso.html")
        self.page.locator("#request-name").fill("Solicitante Teste")
        self.page.locator("#request-email").fill("solicitante@example.com")
        self.page.locator("#request-institution").fill("Instituição de teste")
        options = self.page.locator("#request-role option").evaluate_all("options => options.filter(option => option.value).map(option=>option.value)")
        self.page.locator("#request-role").select_option(options[0])
        self.page.locator("#request-reason").fill("Solicitação de acesso para validação automática")
        self.page.locator("input[name=consent]").check()
        self.submit("request-form")
        self.assertEqual(len(self.state()["requests"]), 1)
        expect(self.page.locator("main")).to_contain_text(self.state()["requests"][0]["protocol"])
        self.goto("Eventos.html")
        expect(self.page.locator("main")).to_contain_text("Preferências atualizadas")
        expect(self.page.locator("main")).to_contain_text("Consulta de imagens registrada")
        self.page.locator("[data-action=notifications]").click()
        expect(self.page.locator("#modal")).to_be_visible()

    def test_movement_note_and_prb_gate(self):
        self.login()
        self.goto("Movimentacao.html")
        note_form = self.page.locator("[data-note-form]").first
        note_id = note_form.get_attribute("data-note-form")
        note_form.locator("textarea").fill("Observação registrada pelo teste")
        note_form.locator("button[type=submit]").click()
        self.assertEqual(self.state()["notes"][note_id], "Observação registrada pelo teste")
        self.page.reload(wait_until="networkidle")
        expect(self.page.locator(f"[data-note-form='{note_id}'] textarea")).to_have_value("Observação registrada pelo teste")
        self.goto("PRB.html")
        self.page.locator("#prb-code").fill("654321")
        self.submit("prb-form")
        expect(self.page.locator("#prb-form .form-error")).to_contain_text("Código inválido")
        self.page.locator("#prb-code").fill("123456")
        self.submit("prb-form")
        expect(self.page.locator("[data-action=lock-prb]")).to_be_visible()
        self.page.locator("[data-action=camera-detail]").first.click()
        expect(self.page.locator("#modal")).to_be_visible()
        self.page.keyboard.press("Escape")
        self.page.locator("[data-action=lock-prb]").click()
        expect(self.page.locator("#prb-form")).to_be_visible()

    def test_mobile_menu_escape_and_modal_focus(self):
        self.login()
        self.page.set_viewport_size({"width": 390, "height": 844})
        self.page.locator("[data-action=toggle-menu]").click()
        expect(self.page.locator("[data-action=toggle-menu]")).to_have_attribute("aria-expanded", "true")
        self.assertTrue(self.page.evaluate("document.activeElement.closest('.sidebar') !== null"))
        self.page.keyboard.press("Escape")
        expect(self.page.locator("[data-action=toggle-menu]")).to_have_attribute("aria-expanded", "false")
        expect(self.page.locator("[data-action=toggle-menu]")).to_be_focused()
        self.page.locator("[data-action=profile]").click()
        expect(self.page.locator("#modal")).to_be_visible()
        self.page.keyboard.press("Escape")
        expect(self.page.locator("[data-action=profile]")).to_be_focused()
        self.assert_no_overflow()

    def test_mobile_menu_preserves_unsaved_form_values(self):
        self.login()
        self.goto("Configuracoes.html")
        self.page.set_viewport_size({"width": 390, "height": 844})
        self.page.locator("#consult-reason").fill("Motivo ainda não salvo pelo responsável")
        self.page.locator("#threshold").evaluate("element => { element.value='87'; element.dispatchEvent(new Event('input', {bubbles:true})); }")
        self.page.locator("[data-action=toggle-menu]").click()
        self.page.keyboard.press("Escape")
        expect(self.page.locator("#consult-reason")).to_have_value("Motivo ainda não salvo pelo responsável")
        expect(self.page.locator("#threshold")).to_have_value("87")
        self.assertIsNone(self.state())

    def test_csv_reports_and_identifications(self):
        self.login()
        self.goto("Relatorio.html")
        self.assertIn("Alunos cadastrados", self.download("export-report"))
        self.page.locator("[data-action=refresh]").click()
        expect(self.page.locator("h1")).to_have_text("Relatório geral")
        self.goto("Identificacoes.html")
        csv = self.download("export-identifications")
        self.assertIn("Pessoa desconhecida", csv)
        expect(self.page.locator("tbody tr")).to_have_count(4)
        self.page.locator("[data-action=more-identifications]").click()
        expect(self.page.locator("[data-action=more-identifications]")).to_have_text("Ver menos")
        self.assertGreater(self.page.locator("tbody tr").count(), 4)

    def test_developer_blank_image_rejected_and_offline(self):
        self.goto("DeveloperTest.html")
        health = self.page.request.get(BASE_URL + "/api/dev/health").json()
        if health.get("status") != "ready":
            self.skipTest("Real face models are not ready")
        initial_count = health["profile_count"]
        self.page.locator('#dev-tab-profiles').click()
        self.page.locator("#dev-name").fill("Generated no-face regression")
        self.page.locator("#dev-enroll-images").set_input_files({"name": "generated.png", "mimeType": "image/png", "buffer": generated_png()})
        with self.page.expect_response(lambda response: response.url.endswith("/api/dev/profiles") and response.request.method == "POST") as pending:
            self.page.locator("#dev-enroll-submit").click()
        self.assertEqual(pending.value.status, 422)
        expect(self.page.locator("#dev-message")).to_be_visible()
        self.assertEqual(self.page.request.get(BASE_URL + "/api/dev/health").json()["profile_count"], initial_count)
        self.page.route("**/api/dev/health", lambda route: route.abort("failed"))
        self.page.reload(wait_until="networkidle")
        expect(self.page.locator("#dev-setup")).to_be_visible()
        expect(self.page.locator("#dev-start")).to_be_disabled()

    @unittest.skipUnless(arguments.face and arguments.other_face, "Pass --face and --other-face for model/camera integration")
    def test_developer_real_models_camera_benchmark_and_cleanup(self):
        portrait = "data:image/jpeg;base64," + base64.b64encode(arguments.face.read_bytes()).decode("ascii")
        self.context.add_init_script("""
          window.__testTracks=[];
          navigator.mediaDevices.getUserMedia=async()=>{
            const canvas=document.createElement('canvas');canvas.width=512;canvas.height=512;
            const ctx=canvas.getContext('2d');const image=new Image();image.src=""" + json.dumps(portrait) + """;
            await image.decode();const draw=()=>{ctx.drawImage(image,0,0,512,512);requestAnimationFrame(draw);};draw();
            const stream=canvas.captureStream(10);window.__testTracks.push(...stream.getTracks());return stream;
          };
        """)
        self.goto("DeveloperTest.html")
        health = self.page.request.get(BASE_URL + "/api/dev/health").json()
        if health.get("status") != "ready":
            self.skipTest("Real face models are not ready")
        initial_count = health["profile_count"]
        profile_name = "Regression " + uuid.uuid4().hex[:12]
        profile_id = None
        headers = {"X-AEGIS-Token": health["token"]}
        try:
            self.page.locator('#dev-tab-profiles').click()
            self.page.locator("#dev-name").fill(profile_name)
            self.page.locator("#dev-enroll-images").set_input_files(str(arguments.face))
            with self.page.expect_response(lambda response: response.url.endswith('/api/dev/enrollment-check')) as preflight:
                self.page.locator('#dev-enroll-check').click()
            self.assertEqual(preflight.value.status,200)
            self.assertTrue(preflight.value.json()['can_enroll'])
            self.assertEqual(self.page.request.get(BASE_URL+'/api/dev/health').json()['profile_count'],initial_count)
            expect(self.page.locator('#dev-enroll-diagnostics')).to_contain_text('prontas para cadastrar')
            with self.page.expect_response(lambda response: response.url.endswith("/api/dev/profiles") and response.request.method == "POST") as pending:
                self.page.locator("#dev-enroll-submit").click()
            response = pending.value
            if response.status == 409:
                self.skipTest("Fixture face already belongs to a profile; existing biometric data preserved")
            self.assertEqual(response.status, 201, response.text())
            profile_id = response.json()["id"]
            expect(self.page.locator("#dev-profiles")).to_contain_text(profile_name)
            self.page.locator('#dev-tab-analysis').click()
            self.page.locator('#dev-source-image').click()
            self.page.locator("#dev-test-image").set_input_files(str(arguments.other_face))
            self.page.locator("#dev-ground-truth").select_option("__unknown__")
            with self.page.expect_response(lambda response: response.url.endswith("/api/dev/recognize")) as pending:
                self.page.locator("#dev-recognize-image").click()
            result = pending.value.json()
            self.assertTrue(result["faces"])
            self.assertTrue(all(face["status"] != "matched" for face in result["faces"]))
            expect(self.page.locator("#dev-recognize-image")).to_be_enabled()
            self.page.locator("#dev-test-image").set_input_files(str(arguments.face))
            self.page.locator("#dev-ground-truth").select_option(profile_id)
            with self.page.expect_response(lambda response: response.url.endswith("/api/dev/recognize")) as pending:
                self.page.locator("#dev-recognize-image").click()
            result = pending.value.json()
            self.assertEqual(result["faces"][0]["profile"]["id"], profile_id)
            expect(self.page.locator("#dev-benchmark")).to_be_enabled()
            with self.page.expect_response(lambda response: response.url.endswith("/api/dev/benchmark"), timeout=30000) as pending:
                self.page.locator("#dev-benchmark").click()
            benchmark = pending.value.json()
            self.assertEqual([row["scale"] for row in benchmark["results"]], ["auto", 1.0, 0.5, 0.25, 0.1])
            self.assertTrue(all(isinstance(row["faces"], list) for row in benchmark["results"]))
            expect(self.page.locator("#dev-start")).to_be_enabled()
            self.page.locator('#dev-source-camera').click()
            with self.page.expect_response(lambda response: response.url.endswith("/api/dev/recognize"), timeout=20000):
                self.page.locator("#dev-start").click()
            expect(self.page.locator("#dev-stop")).to_be_enabled()
            self.page.locator("#dev-stop").click()
            self.assertTrue(self.page.evaluate("window.__testTracks.every(track => track.readyState === 'ended')"))
            self.assertTrue(self.page.evaluate("document.querySelector('#dev-video').srcObject === null"))
            # Actual wall-clock deadline and inference, using a simulated camera
            # and only the uniquely named profile created by this test.
            self.page.locator('#dev-tab-validation').click()
            self.page.locator('#dev-report-duration').select_option('30')
            self.page.locator('#dev-report-expected').select_option(profile_id)
            self.page.locator('#dev-report-start').click()
            expect(self.page.locator('#dev-report-progress')).to_be_visible()
            expect(self.page.locator('#dev-report-output')).to_be_visible(timeout=40000)
            with self.page.expect_download() as pending:
                self.page.locator('#dev-report-json').click()
            output = Path(__file__).resolve().parents[1] / '.runtime/validation/review'
            output.mkdir(parents=True, exist_ok=True)
            report_path = output / 'diagnostic-summary-real-models.json'
            pending.value.save_as(str(report_path))
            report_text = report_path.read_text(encoding='utf-8')
            report = json.loads(report_text)
            self.assertEqual(report['session']['end_reason'],'completed')
            self.assertGreaterEqual(report['session']['duration_seconds'],30)
            self.assertGreaterEqual(report['frames']['total'],5)
            self.assertEqual(report['evaluation']['tp'],report['frames']['total'])
            self.assertGreater(report['temporal']['confirmed'],0)
            self.assertGreater(report['temporal']['pending'],0)
            self.assertEqual(report['temporal']['wrong_confirmed'],0)
            self.assertEqual(report['temporal']['confirmation_precision'],1)
            self.assertEqual(report['exclusions']['benchmark'],0)
            self.assertGreater(report['timings']['total_ms']['median'],0)
            self.assertEqual(report['camera']['width'],512)
            for secret in [profile_id,profile_name,health['token']]:
                self.assertNotIn(secret,report_text)
            self.assertTrue(self.page.evaluate("window.__testTracks.every(track => track.readyState === 'ended')"))
            self.assertTrue(self.page.evaluate("document.querySelector('#dev-video').srcObject === null"))
        finally:
            if profile_id:
                response = self.page.request.delete(BASE_URL + "/api/dev/profiles/" + profile_id, headers=headers)
                self.assertEqual(response.status, 200)
            self.assertEqual(self.page.request.get(BASE_URL + "/api/dev/health").json()["profile_count"], initial_count)


if __name__ == "__main__":
    unittest.main(argv=[sys.argv[0], *unittest_arguments], verbosity=2)
