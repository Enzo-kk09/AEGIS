"""Preflight feedback, invalidation and responsive layout with a simulated API."""
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
    data=io.BytesIO()
    Image.new('RGB',(640,480),(110,130,150)).save(data,format='PNG')
    file={'name':'reference.png','mimeType':'image/png','buffer':data.getvalue()}
    rules=public_rules()
    report={
        'photos':[{'photo':1,'accepted':False,'face_count':1,'reason':'O rosto está desfocado.',
                  'quality':{'face_pixels':140,'minimum_pixels':100,'brightness':18,'brightness_min':35,'brightness_max':225,'sharpness':5,'minimum_sharpness':35},
                  'advice':['Use luz frontal uniforme.','Confira o foco e estabilize a câmera.']}],
        'consistency':{'passed':True,'minimum_similarity':.999,'required_similarity':.4,'pairs':[{'first':1,'second':2,'similarity':.999,'consistent':True,'redundant':True}]},
        'gallery':{'profile_count':0,'similar_to_existing':False,'maximum_similarity':None,'required_similarity':.45},
        'redundant_pairs':1,'can_enroll':False,'warnings':['Há fotos muito parecidas entre si.'],
        'rules':rules,'note':'Avaliação sem gravação. O cadastro repete as validações ao salvar.'}
    calls=[]
    errors=[]
    def respond(route,payload):
        route.fulfill(status=200,content_type='application/json',body=json.dumps(payload))
    with sync_playwright() as p:
        browser=p.chromium.launch(executable_path=r'C:\Program Files\Google\Chrome\Application\chrome.exe',headless=True)
        context=browser.new_context()
        context.route('**/api/dev/health',lambda route:respond(route,{'status':'ready','token':'test-token','rules':rules}))
        context.route('**/api/dev/profiles',lambda route:respond(route,{'profiles':[]}))
        def check(route):
            calls.append(route.request)
            assert route.request.headers['x-aegis-token']=='test-token'
            respond(route,report)
        context.route('**/api/dev/enrollment-check',check)
        page=context.new_page()
        page.on('pageerror',lambda error:errors.append(str(error)))
        page.goto(args.base_url+'/DeveloperTest.html',wait_until='networkidle')
        page.locator('#dev-tab-profiles').click()
        page.locator('#dev-enroll-images').set_input_files([file,{**file,'name':'second.png'}])
        page.locator('#dev-enroll-check').click()
        section=page.locator('#dev-enroll-diagnostics')
        expect(section).to_be_visible()
        expect(section).to_contain_text('140 / 100 px')
        expect(section).to_contain_text('18 / 35–225')
        expect(section).to_contain_text('Confira o foco')
        expect(page.locator('#dev-message')).to_contain_text('Nenhum perfil foi salvo')
        section.locator('summary').click()
        expect(section).to_contain_text('Muito parecidas')
        for width in [1440,1024,760,390]:
            page.set_viewport_size({'width':width,'height':1000})
            assert page.evaluate('document.documentElement.scrollWidth<=innerWidth+1'),width
        page.locator('[data-photo="1"]').click()
        expect(section).to_be_hidden()
        expect(page.locator('#dev-enroll-previews img')).to_have_count(1)
        page.locator('#dev-enroll-check').click()
        expect(section).to_be_visible()
        expect(page.locator('#dev-enroll-submit')).to_be_enabled()
        assert len(calls)==2
        assert not errors,errors
        context.close()
        browser.close()
    print('Photo diagnostics, numeric limits, advice, redundancy, invalidation and 4 viewport widths passed without enrollment.')


if __name__=='__main__':
    main()
