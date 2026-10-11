"""Cancelled uploads must release UI controls and preserve selected files."""
import argparse
import io
import json

from PIL import Image
from developer_test.rules import public_rules
from playwright.sync_api import expect,sync_playwright


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--base-url',default='http://127.0.0.1:8765')
    args=parser.parse_args()
    data=io.BytesIO()
    Image.new('RGB',(640,480),(110,130,150)).save(data,format='PNG')
    picture={'name':'selected.png','mimeType':'image/png','buffer':data.getvalue()}
    errors=[]
    def respond(route,payload):
        if route.request.url.endswith('/health'):
            payload = {**payload, 'rules':public_rules()}
        route.fulfill(status=200,content_type='application/json',body=json.dumps(payload))
    with sync_playwright() as p:
        browser=p.chromium.launch(executable_path=r'C:\Program Files\Google\Chrome\Application\chrome.exe',headless=True)
        context=browser.new_context()
        context.add_init_script(r"""
          window.__heldRequests=0;const originalFetch=window.fetch.bind(window);
          window.fetch=(url,options={})=>{
            if(options.method==='POST' && /^\/api\/dev\/(recognize|benchmark|profiles|enrollment-check)$/.test(String(url))){
              window.__heldRequests++;
              return new Promise((resolve,reject)=>{
                const abort=()=>reject(new DOMException('Cancelled by user','AbortError'));
                if(options.signal?.aborted)abort();
                else options.signal?.addEventListener('abort',abort,{once:true});
              });
            }
            return originalFetch(url,options);
          };
        """)
        context.route('**/api/dev/health',lambda route:respond(route,{'status':'ready','token':'test-token','profile_count':0}))
        context.route('**/api/dev/profiles',lambda route:respond(route,{'profiles':[]}))
        page=context.new_page()
        page.on('pageerror',lambda error:errors.append(str(error)))
        page.goto(args.base_url+'/DeveloperTest.html',wait_until='networkidle')
        page.locator('#dev-source-image').click()
        page.locator('#dev-test-image').set_input_files(picture)
        for button in ['dev-recognize-image','dev-benchmark']:
            page.locator('#'+button).click()
            cancel=page.locator('[data-cancel-operation="'+button+'"]')
            expect(cancel).to_be_visible()
            expect(page.locator('#dev-test-image')).to_be_disabled()
            cancel.click()
            expect(cancel).to_be_hidden()
            expect(page.locator('#'+button)).to_be_enabled()
            expect(page.locator('#dev-message')).to_contain_text('cancelada')
            expect(page.locator('#dev-image-name')).to_contain_text('selected.png')
            expect(page.locator('#dev-image-preview')).to_be_visible()
        page.locator('#dev-tab-profiles').click()
        page.locator('#dev-name').fill('Preserved name')
        page.locator('#dev-enroll-images').set_input_files(picture)
        page.locator('#dev-enroll-check').click()
        page.locator('[data-cancel-operation="dev-enroll-check"]').click()
        expect(page.locator('#dev-enroll-check')).to_be_enabled()
        expect(page.locator('#dev-enroll-previews img')).to_have_count(1)
        page.locator('#dev-enroll-submit').click()
        page.locator('[data-cancel-operation="dev-enroll-submit"]').click()
        expect(page.locator('#dev-enroll-submit')).to_be_enabled()
        expect(page.locator('#dev-message')).to_contain_text('fotos selecionadas foram preservadas')
        expect(page.locator('#dev-name')).to_have_value('Preserved name')
        expect(page.locator('#dev-enroll-previews img')).to_have_count(1)
        assert page.evaluate('window.__heldRequests')==4
        context.close()
        browser.close()
    assert not errors,errors
    print('Image, benchmark and enrollment cancellation preserve files and release controls.')


if __name__=='__main__':
    main()
