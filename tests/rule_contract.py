"""UI/help/report must follow server rules and reject an incompatible contract."""
import argparse
import io
import json

from PIL import Image
from playwright.sync_api import expect, sync_playwright
from developer_test.rules import public_rules


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--base-url',default='http://127.0.0.1:8765')
    args=parser.parse_args()
    rules=public_rules()
    rules['decision'].update(default_threshold=.42,min_threshold=.32,max_threshold=.8,uncertainty_band=.08,identity_margin=.07)
    rules['quality'].update(brightness_min=60,brightness_max=180,enrollment_min_pixels=110)
    rules['enrollment']['max_references']=4
    rules['revision']='0123456789abcdef'
    data=io.BytesIO()
    Image.new('RGB',(640,480),(100,130,150)).save(data,format='PNG')
    image={'name':'test.png','mimeType':'image/png','buffer':data.getvalue()}
    errors=[]
    def respond(route,payload):
        route.fulfill(status=200,content_type='application/json',body=json.dumps(payload))
    with sync_playwright() as p:
        browser=p.chromium.launch(executable_path=r'C:\Program Files\Google\Chrome\Application\chrome.exe',headless=True)
        context=browser.new_context()
        health={'status':'ready','token':'test-token','rules':rules}
        context.route('**/api/dev/health',lambda route:respond(route,health))
        context.route('**/api/dev/profiles',lambda route:respond(route,{'profiles':[]}))
        context.route('**/api/dev/recognize',lambda route:respond(route,{
            'image':{'width':640,'height':480},'profile_count':0,
            'faces':[{'status':'low_quality','box':{'x':100,'y':80,'width':140,'height':160},'reason':'Ajuste a iluminação.',
                      'quality':{'brightness':50,'brightness_min':60,'brightness_max':180,'face_pixels':140,'minimum_pixels':64,'sharpness':80,'minimum_sharpness':20}}],
            'timings':{'total_ms':30}}))
        page=context.new_page()
        page.on('pageerror',lambda error:errors.append(str(error)))
        page.goto(args.base_url+'/DeveloperTest.html',wait_until='networkidle')
        expect(page.locator('#dev-threshold')).to_have_value('0.42')
        expect(page.locator('#dev-threshold')).to_have_attribute('min','0.32')
        expect(page.locator('#dev-decision-rule')).to_contain_text('0,34 a 0,50')
        page.locator('[data-help=threshold]').click()
        expect(page.locator('#dev-help-content')).to_contain_text('±0,08')
        expect(page.locator('#dev-help-content')).to_contain_text('0,07')
        page.locator('#dev-help-close').click()
        page.locator('#dev-tab-profiles').click()
        expect(page.locator('#dev-enroll-limits')).to_contain_text('1 a 4')
        page.get_by_role('button',name='Como preparar as fotos',exact=True).click()
        expect(page.locator('#dev-help-content')).to_contain_text('1 e 4')
        page.locator('#dev-help-close').click()
        page.locator('#dev-tab-analysis').click()
        page.locator('#dev-source-image').click()
        page.locator('#dev-test-image').set_input_files(image)
        page.locator('#dev-recognize-image').click()
        expect(page.locator('#dev-result [data-failed=true]')).to_contain_text('Luz 50')
        page.locator('#dev-tab-validation').click()
        page.locator('#dev-report-current').click()
        with page.expect_download() as download:
            page.locator('#dev-report-json').click()
        report=json.loads(download.value.path().read_text(encoding='utf-8'))
        assert report['quality_signals']['lighting']==1
        assert report['configuration']['rule_sets'][0]['decision']['uncertainty_band']==.08
        for invalid in [None,{**rules,'version':999}]:
            health['rules']=invalid
            page.locator('#dev-reconnect').dispatch_event('click')
            expect(page.locator('#dev-health-label')).to_have_text('Regras incompatíveis')
            expect(page.locator('#dev-report-start')).to_be_disabled()
            expect(page.locator('#dev-setup-message')).to_contain_text('Reinicie o Python')
        assert not errors,errors
        context.close()
        browser.close()
    print('Alternative rules synchronized across controls, help and report; missing/incompatible rules blocked processing.')


if __name__=='__main__':
    main()
