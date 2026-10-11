"""Focused behavior checks for the laboratory's technical workspace."""
import argparse
import io
import json
from pathlib import Path

from PIL import Image
from developer_test.rules import public_rules
from playwright.sync_api import expect, sync_playwright


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--base-url', default='http://127.0.0.1:8765')
    parser.add_argument('--browser', default=r'C:\Program Files\Google\Chrome\Application\chrome.exe')
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    output = root / '.runtime/validation/review'
    output.mkdir(parents=True, exist_ok=True)
    errors = []
    payload = {
        'image':{'width':640,'height':480},
        'faces':[{'box':{'x':100,'y':70,'width':140,'height':160},'status':'matched','profile':{'id':'a'*32,'name':'Referência de teste'},'similarity':.81,'detector_score':.98,'reason':'Perfil identificado.','quality':{'face_pixels':140,'minimum_pixels':64,'brightness':121,'sharpness':88,'minimum_sharpness':20,'reason':None},'comparison':{'margin':.19},'refined':True}],
        'detection':{'requested_scale':'auto','width':640,'height':480,'refined_faces':1},
        'timings':{'decode_ms':3,'detect_ms':12,'recognize_ms':8,'queue_ms':0,'total_ms':23}
    }
    def respond(route, data):
        if route.request.url.endswith('/health'):
            data = {**data, 'rules':public_rules()}
        route.fulfill(status=200, content_type='application/json', body=json.dumps(data))
    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path=args.browser,headless=True)
        context = browser.new_context(viewport={'width':1440,'height':1000})
        context.route('**/api/dev/health', lambda route: respond(route, {'status':'ready','token':'test-token','profile_count':1}))
        context.route('**/api/dev/profiles', lambda route: respond(route, {'profiles':[{'id':'a'*32,'name':'Referência de teste','samples':3}]}))
        requests = []
        def recognize(route):
            requests.append(route.request.post_data_buffer)
            respond(route,payload)
        context.route('**/api/dev/recognize', recognize)
        def benchmark(route):
            rows = []
            for scale in ['auto',1,.5,.25,.1]:
                effective = .3 if scale == 'auto' else scale
                rows.append({'scale':scale,'mean_ms':30*effective+5,'median_ms':30*effective+4,'min_ms':30*effective+3,'max_ms':30*effective+7,'stable':True,'p95_ms':35*effective+5,'faces':payload['faces'] if effective>=.25 else [],'detection':{'width':round(640*effective),'height':round(480*effective)},'timings':payload['timings']})
            respond(route, {'iterations':5,'results':rows})
        context.route('**/api/dev/benchmark', benchmark)
        page = context.new_page()
        page.on('pageerror',lambda error: errors.append(str(error)))
        page.goto(args.base_url+'/DeveloperTest.html',wait_until='networkidle')
        expect(page.locator('#dev-scale')).to_have_value('auto')
        page.locator('[data-help=camera]').click()
        expect(page.locator('#dev-help-dialog')).to_be_visible()
        expect(page.locator('#dev-help-title')).to_contain_text('câmera interfere')
        page.keyboard.press('Escape')
        expect(page.locator('#dev-help-dialog')).to_be_hidden()
        expect(page.locator('[data-help=camera]')).to_be_focused()
        page.locator('#dev-tab-analysis').focus()
        page.keyboard.press('ArrowRight')
        expect(page.locator('#dev-pane-profiles')).to_be_visible()
        expect(page.locator('#dev-tab-profiles')).to_be_focused()
        page.keyboard.press('End')
        expect(page.locator('#dev-pane-validation')).to_be_visible()
        page.keyboard.press('Home')
        expect(page.locator('#dev-pane-analysis')).to_be_visible()
        page.locator('#dev-source-image').click()
        buffer = io.BytesIO()
        Image.new('RGB',(640,480),(110,130,150)).save(buffer,format='PNG')
        page.locator('#dev-test-image').set_input_files({'name':'test.png','mimeType':'image/png','buffer':buffer.getvalue()})
        page.locator('#dev-ground-truth').select_option('a'*32)
        page.locator('#dev-recognize-image').click()
        expect(page.locator('#dev-result')).to_contain_text('Referência de teste')
        expect(page.locator('#dev-result-source')).to_contain_text('Arquivo')
        expect(page.locator('#dev-result')).to_contain_text('Nitidez 88')
        expect(page.locator('#dev-input-size')).to_have_text('640 × 480')
        expect(page.locator('#dev-json')).to_contain_text('brightness')
        assert b'name="scale"\r\n\r\nauto' in requests[0]
        page.locator('#dev-benchmark').click()
        expect(page.locator('#dev-benchmark-results tbody tr')).to_have_count(5)
        expect(page.locator('#dev-benchmark-results tbody tr').first).to_contain_text('Auto')
        expect(page.locator('#dev-benchmark-results')).to_contain_text('Mediana')
        expect(page.locator('#dev-benchmark-results')).to_contain_text('Faixa')
        expect(page.locator('#dev-benchmark-results tr[data-best=true]')).to_contain_text('25%')
        page.evaluate('window.scrollTo(0,0)')
        page.screenshot(path=str(output/'laboratory-file.png'),full_page=True)
        page.locator('#dev-tab-validation').click()
        expect(page.locator('#dev-scored')).to_have_text('1')
        expect(page.locator('#dev-tp')).to_have_text('1')
        expect(page.locator('#dev-fn')).to_have_text('0')
        expect(page.locator('#dev-precision')).to_have_text('100%')
        expect(page.locator('#dev-recall')).to_have_text('100%')
        expect(page.locator('#dev-session-records tbody tr')).to_have_count(6)
        with page.expect_download() as pending:
            page.locator('#dev-export').click()
        destination = output/'test-session.csv'
        pending.value.save_as(str(destination))
        csv = destination.read_text(encoding='utf-8-sig')
        assert 'nitidez' in csv and 'auto' in csv
        page.locator('[data-help=report]').click()
        expect(page.locator('#dev-help-title')).to_contain_text('Resumo')
        page.keyboard.press('Escape')
        page.locator('#dev-report-current').click()
        expect(page.locator('#dev-report-output')).to_be_visible()
        expect(page.locator('#dev-report-overview')).to_contain_text('1 capturas')
        with page.expect_download() as pending:
            page.locator('#dev-report-json').click()
        summary_path = output/'laboratory-file-summary.json'
        pending.value.save_as(str(summary_path))
        summary = json.loads(summary_path.read_text(encoding='utf-8'))
        assert summary['frames']['total'] == 1
        assert summary['exclusions']['benchmark'] == 5
        assert summary['evaluation']['tp'] == 1
        page.evaluate('window.scrollTo(0,0)')
        page.screenshot(path=str(output/'laboratory-validation.png'),full_page=True)
        page.locator('#dev-clear-records').click()
        expect(page.locator('#dev-scored')).to_have_text('0')
        expect(page.locator('#dev-precision')).to_have_text('—')
        page.locator('#dev-tab-profiles').click()
        page.evaluate('window.scrollTo(0,0)')
        page.screenshot(path=str(output/'laboratory-profiles.png'),full_page=True)
        page.locator('#dev-tab-analysis').click()
        for width in [320,390,768,1440]:
            page.set_viewport_size({'width':width,'height':900})
            for tab in ['analysis','profiles','validation']:
                page.locator('#dev-tab-'+tab).click()
                assert page.evaluate('document.documentElement.scrollWidth <= innerWidth + 1'), (width,tab)
            page.locator('#dev-tab-analysis').click()
            if width == 390:
                page.locator('#dev-source-camera').click()
                page.evaluate('window.scrollTo(0,0)')
                page.screenshot(path=str(output/'laboratory-mobile.png'),full_page=True)
        browser.close()
    assert not errors, errors
    print('Laboratory: help/focus, keyboard tabs, auto request, telemetry, benchmark, metrics, CSV and 4 viewport widths passed.')


if __name__ == '__main__':
    main()
