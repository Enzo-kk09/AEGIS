"""Camera-session regressions with simulated API responses and isolated browsers."""
import argparse
import copy
import json
import sys
import unittest
from pathlib import Path

from developer_test.rules import public_rules
from playwright.sync_api import expect, sync_playwright


parser = argparse.ArgumentParser()
parser.add_argument('--base-url', default='http://127.0.0.1:8765')
parser.add_argument('--browser', default=r'C:\Program Files\Google\Chrome\Application\chrome.exe')
arguments, test_arguments = parser.parse_known_args()
OUTPUT = Path(__file__).resolve().parents[1] / '.runtime/validation/review'
PROFILES = [
    {'id':'a'*32, 'name':'Nome privado A', 'samples':3},
    {'id':'b'*32, 'name':'Nome privado B', 'samples':2},
]
PAYLOAD = {
    'image':{'width':640, 'height':480}, 'profile_count':2,
    'faces':[{
        'box':{'x':100, 'y':70, 'width':140, 'height':160},
        'status':'matched', 'profile':PROFILES[0], 'similarity':.81, 'detector_score':.98,
        'reason':'Perfil identificado.', 'refined':True,
        'quality':{'face_pixels':140, 'minimum_pixels':64, 'brightness':121,
                   'brightness_min':35,'brightness_max':225,
                   'sharpness':88, 'minimum_sharpness':20, 'reason':None},
        'comparison':{'margin':.19, 'required_margin':.05},
    }],
    'detection':{'requested_scale':'auto', 'width':640, 'height':480, 'refined_faces':1},
    'timings':{'decode_ms':3, 'detect_ms':12, 'recognize_ms':8, 'embedding_ms':7,
               'match_ms':1, 'queue_ms':0, 'total_ms':23},
}
CAMERA_SCRIPT = """
window.__cameraMode='normal';window.__tracks=[];window.__reports=[];
Object.defineProperty(window,'AegisDeveloperReport',{
  configurable:true,get(){return this.__reportTools;},
  set(value){this.__reportTools={...value,buildReport(...args){
    const report=value.buildReport(...args);window.__reports.push(report);return report;
  }};}
});
Object.defineProperty(navigator.clipboard,'writeText',{configurable:true,value:async text=>{
  if(window.__denyClipboard)throw new DOMException('Denied','NotAllowedError');
  window.__copiedText=text;
}});
navigator.mediaDevices.getUserMedia=async()=>{
  if(window.__cameraMode!=='normal' && window.__cameraMode!=='hold')
    throw new DOMException('Camera unavailable',window.__cameraMode);
  const canvas=document.createElement('canvas');canvas.width=640;canvas.height=480;
  const context=canvas.getContext('2d');
  const draw=()=>{context.fillStyle='#718ea4';context.fillRect(0,0,640,480);requestAnimationFrame(draw);};draw();
  const stream=canvas.captureStream(10);window.__tracks.push(...stream.getTracks());
  if(window.__cameraMode==='hold')await new Promise(resolve=>window.__releaseCamera=resolve);
  return stream;
};
"""


class DiagnosticSession(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        OUTPUT.mkdir(parents=True, exist_ok=True)
        cls.playwright = sync_playwright().start()
        cls.browser = cls.playwright.chromium.launch(executable_path=arguments.browser, headless=True)

    @classmethod
    def tearDownClass(cls):
        cls.browser.close()
        cls.playwright.stop()

    def setUp(self):
        self.context = self.browser.new_context(viewport={'width':1440,'height':1000})
        self.context.add_init_script(CAMERA_SCRIPT)
        self.context.route('**/api/dev/health', lambda route: self.respond(route, {
            'status':'ready','token':'private-session-token','profile_count':2,
            'runtime':{'backend':'OpenCV DNN','target':'CPU','opencv':'4.13.0','threads':2},
        }))
        self.context.route('**/api/dev/profiles', lambda route: self.respond(route, {'profiles':PROFILES}))
        self.calls = []
        self.payload = copy.deepcopy(PAYLOAD)
        self.failure = None
        self.context.route('**/api/dev/recognize', self.recognize)
        self.page = self.context.new_page()
        self.errors = []
        self.page.on('pageerror', lambda error: self.errors.append(str(error)))
        self.page.clock.install()
        self.page.goto(arguments.base_url+'/DeveloperTest.html',wait_until='networkidle')
        self.page.locator('#dev-tab-validation').click()
        expect(self.page.locator('#dev-report-start')).to_be_enabled()
        self.page.locator('#dev-report-duration').select_option('30')

    def tearDown(self):
        self.context.close()
        self.assertEqual(self.errors, [], 'Unhandled browser errors')

    @staticmethod
    def respond(route, payload):
        if route.request.url.endswith('/health'):
            payload = {**payload, 'rules':public_rules()}
        route.fulfill(status=200,content_type='application/json',body=json.dumps(payload))

    def recognize(self, route):
        self.calls.append(route.request)
        if self.failure == 'network':
            route.abort('failed')
        elif self.failure:
            route.fulfill(status=503,content_type='application/json',body=json.dumps({'detail':'Modelo indisponível no teste.'}))
        else:
            self.respond(route, self.payload)

    def start(self, expected='a'*32):
        if self.page.locator('#dev-clear-records').is_enabled():
            self.page.locator('#dev-clear-records').click()
        self.page.locator('#dev-report-expected').select_option(expected)
        self.page.locator('#dev-report-start').click()
        expect(self.page.locator('#dev-report-progress')).to_be_visible()
        self.page.wait_for_function("document.querySelector('#dev-session-records tbody tr') !== null")

    def report(self):
        expect(self.page.locator('#dev-report-output')).to_be_visible()
        return self.page.evaluate('window.__reports.at(-1)')

    def stop(self):
        self.page.locator('#dev-report-stop').click()
        return self.report()

    def assert_camera_released(self):
        self.assertTrue(self.page.evaluate("window.__tracks.every(track=>track.readyState==='ended')"))
        self.assertTrue(self.page.evaluate("document.querySelector('#dev-video').srcObject===null"))
        count = len(self.calls)
        self.page.clock.fast_forward(1500)
        self.assertEqual(len(self.calls), count, 'No further analyses after the test ends')

    def test_automatic_deadline_exports_copy_and_mobile(self):
        self.start()
        expect(self.page.locator('#dev-report-start')).to_be_disabled()
        expect(self.page.locator('#dev-scale')).to_be_disabled()
        expect(self.page.locator('#dev-enroll-submit')).to_be_disabled()
        expect(self.page.locator('#dev-report-expected')).to_be_enabled()
        self.page.clock.fast_forward(31000)
        report = self.report()
        self.assertEqual(report['session']['end_reason'],'completed')
        self.assertEqual(report['session']['requested_seconds'],30)
        self.assertGreaterEqual(report['session']['duration_seconds'],30)
        self.assertGreater(report['frames']['total'],0)
        self.assertEqual(report['evaluation']['tp'],report['frames']['total'])
        self.assertEqual(report['evaluation']['precision'],1)
        self.assert_camera_released()
        text = self.page.locator('#dev-report-text').input_value()
        self.page.locator('#dev-report-copy').click()
        expect(self.page.locator('#dev-report-status')).to_contain_text('Resumo copiado')
        self.assertEqual(self.page.evaluate('window.__copiedText'),text)
        for extension, button in [('txt','download'),('json','json')]:
            with self.page.expect_download() as pending:
                self.page.locator('#dev-report-'+button).click()
            path = OUTPUT / ('diagnostic-summary-simulated.'+extension)
            pending.value.save_as(str(path))
            self.assertTrue(pending.value.suggested_filename.endswith('.'+extension))
            content = path.read_text(encoding='utf-8')
            if extension == 'json':
                self.assertEqual(json.loads(content),report)
            else:
                self.assertEqual(content,text)
            for secret in ['Nome privado A','Nome privado B','a'*32,'b'*32,'private-session-token']:
                self.assertNotIn(secret,content)
        self.page.evaluate('window.__denyClipboard=true')
        self.page.locator('#dev-report-copy').click()
        expect(self.page.locator('#dev-report-status')).to_contain_text('Ctrl+C')
        self.assertEqual(self.page.locator('#dev-report-text').evaluate('e=>e.selectionEnd-e.selectionStart'),len(text))
        self.page.evaluate("const text=document.querySelector('#dev-report-text');text.setSelectionRange(0,0);text.scrollTop=0;text.blur();window.scrollTo(0,0);")
        for width in [320,390,768,1440]:
            self.page.set_viewport_size({'width':width,'height':900})
            self.page.screenshot(path=str(OUTPUT/f'diagnostic-summary-{width}.png'),full_page=True)
            overflow = self.page.evaluate("[...document.querySelectorAll('main *')].filter(e=>e.getBoundingClientRect().right>innerWidth+1).map(e=>({tag:e.tagName,id:e.id,class:e.className,right:e.getBoundingClientRect().right,scroll:e.scrollWidth}))")
            self.assertTrue(self.page.evaluate('document.documentElement.scrollWidth<=innerWidth+1'),(width,overflow))
        for duration in [60,180]:
            self.page.locator('#dev-report-duration').select_option(str(duration))
            self.start()
            self.page.clock.fast_forward(duration*1000+1000)
            next_report = self.report()
            self.assertEqual(next_report['session']['end_reason'],'completed')
            self.assertEqual(next_report['session']['requested_seconds'],duration)
            self.assertGreaterEqual(next_report['session']['duration_seconds'],duration)
            self.assert_camera_released()

    def test_unannotated_summary_and_parameter_reset(self):
        self.page.locator('#dev-report-expected').select_option('b'*32)
        self.page.locator('#dev-tab-analysis').click()
        expect(self.page.locator('#dev-ground-truth')).to_have_value('b'*32)
        self.page.locator('#dev-reset-config').click()
        expect(self.page.locator('#dev-ground-truth')).to_have_value('')
        self.page.locator('#dev-tab-validation').click()
        expect(self.page.locator('#dev-report-expected')).to_have_value('')
        self.start('')
        report = self.stop()
        self.assertEqual(report['session']['end_reason'],'interrupted')
        self.assertEqual(report['observed_identification_rate'],100)
        self.assertIsNone(report['evaluation']['precision'])
        self.assertIsNone(report['evaluation']['accuracy'])
        self.assertEqual(report['evaluation']['scored'],0)
        self.assert_camera_released()

    def test_annotation_changes_record_wrong_identity_and_unknown(self):
        self.start()
        self.page.locator('#dev-report-expected').select_option('b'*32)
        self.page.wait_for_function("Number(document.querySelector('#dev-fn').textContent)>0")
        self.page.locator('#dev-report-expected').select_option('__unknown__')
        previous = int(self.page.locator('#dev-fp').inner_text())
        self.page.wait_for_function("n=>Number(document.querySelector('#dev-fp').textContent)>n",arg=previous)
        report = self.stop()
        self.assertGreater(report['evaluation']['tp'],0)
        self.assertGreater(report['evaluation']['fn'],0)
        self.assertGreater(report['evaluation']['fp'],report['evaluation']['fn'])
        self.assertLess(report['evaluation']['precision'],1)
        self.assertIn('wrong_identity',[example['outcome'] for example in report['examples']])
        self.assertIn('Pessoa não cadastrada',report['configuration']['expected_identities'])
        self.assert_camera_released()

    def test_temporal_confirmation_resets_and_wrong_confirmations_are_reported(self):
        self.start()
        self.page.locator('#dev-tab-analysis').click()
        state=self.page.locator('#dev-temporal-state')
        expect(state).to_have_attribute('data-status','confirmed')
        self.payload['faces']=[]
        expect(state).to_have_attribute('data-status','unconfirmed')
        self.payload=copy.deepcopy(PAYLOAD)
        expect(state).to_have_attribute('data-status','confirmed')
        self.payload['faces'].append(copy.deepcopy(self.payload['faces'][0]))
        expect(state).to_have_attribute('data-status','unconfirmed')
        self.payload=copy.deepcopy(PAYLOAD)
        expect(state).to_have_attribute('data-status','confirmed')
        self.page.locator('#dev-tab-validation').click()
        # Tab changes preserve the running timed session; changing truth resets agreement.
        expect(self.page.locator('#dev-report-progress')).to_be_visible()
        self.page.locator('#dev-report-expected').select_option('b'*32)
        expect(state).to_have_attribute('data-status','unconfirmed')
        expect(state).to_have_attribute('data-status','confirmed')
        self.page.wait_for_timeout(250)
        report=self.stop()
        self.assertGreater(report['temporal']['confirmed'],0)
        self.assertGreater(report['temporal']['pending'],0)
        self.assertGreater(report['temporal']['wrong_confirmed'],0)
        self.assertLess(report['temporal']['confirmation_precision'],1)
        self.assertGreater(report['evaluation']['fn'],0)
        self.assert_camera_released()

    def test_temporal_confirmation_expires_during_a_stalled_request(self):
        self.start()
        state=self.page.locator('#dev-temporal-state')
        expect(state).to_have_attribute('data-status','confirmed')
        self.page.evaluate("""() => {
          const original=window.fetch.bind(window);
          window.fetch=(url,options={})=>String(url).endsWith('/recognize') ? new Promise((resolve,reject)=>{
            window.__heldTemporalRequest=true;
            options.signal.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')),{once:true});
          }) : original(url,options);
        }""")
        self.page.wait_for_function('window.__heldTemporalRequest===true')
        self.page.clock.fast_forward(1200)
        expect(state).to_have_attribute('data-status','unconfirmed')
        expect(state).to_contain_text('captura interrompida')
        self.stop()
        self.assert_camera_released()

    def test_gallery_changed_response_clears_confirmation_and_is_not_scored(self):
        self.start()
        state=self.page.locator('#dev-temporal-state')
        expect(state).to_have_attribute('data-status','confirmed')
        self.payload['gallery_changed']=True
        self.payload['gallery_revision']='0123456789abcdef'
        self.payload['faces'][0].update(status='uncertain',profile=None,reason='A galeria mudou durante a análise.')
        expect(state).to_have_attribute('data-status','discarded')
        self.page.wait_for_timeout(250)
        report=self.stop()
        self.assertGreater(report['temporal']['discarded'],0)
        self.assertGreater(report['evaluation']['excluded'],0)
        self.assertIn('A galeria mudou durante algumas análises. Essas capturas ficaram incertas e foram excluídas da avaliação de identidade.',report['findings'])

    def test_no_face_multiple_faces_and_quality_diagnostics(self):
        self.payload['faces'] = []
        self.start()
        self.page.wait_for_function("Number(document.querySelector('#dev-fn').textContent)>0")
        self.payload = copy.deepcopy(PAYLOAD)
        self.payload['faces'][0]['status'] = 'low_quality'
        self.payload['faces'][0]['quality'].update(face_pixels=40,brightness=18,sharpness=5)
        self.payload['faces'].append(copy.deepcopy(self.payload['faces'][0]))
        self.page.wait_for_function("document.querySelector('#dev-session-records').textContent.includes('Múltiplos rostos')")
        report = self.stop()
        self.assertGreater(report['frames']['no_face'],0)
        self.assertGreater(report['frames']['multiple_faces'],0)
        self.assertGreater(report['evaluation']['excluded'],0)
        for key in ['small','lighting','blurred']:
            self.assertGreater(report['quality_signals'][key],0)
        self.assert_camera_released()

    def test_camera_errors_produce_empty_explanatory_reports(self):
        for mode in ['NotAllowedError','NotFoundError','NotReadableError','unsupported']:
            with self.subTest(mode=mode):
                self.page.evaluate("mode=>{window.__cameraMode=mode;if(mode==='unsupported')navigator.mediaDevices.getUserMedia=null;}",mode)
                self.page.locator('#dev-report-start').click()
                report = self.report()
                self.assertEqual(report['session']['end_reason'],'camera_error')
                self.assertEqual(report['frames']['total'],0)
                self.assertEqual(len(report['errors']),1)
                self.assertIsNone(report['evaluation']['precision'])
                expect(self.page.locator('#dev-report-start')).to_be_enabled()

    def test_cancel_pending_camera_and_start_again(self):
        self.page.evaluate("window.__cameraMode='hold'")
        self.page.locator('#dev-report-start').click()
        self.page.wait_for_function("typeof window.__releaseCamera==='function'")
        expect(self.page.locator('#dev-report-progress')).to_be_hidden()
        self.assertEqual(len(self.calls),0)
        self.stop()
        self.page.evaluate("window.__releaseCamera();window.__cameraMode='normal';")
        self.page.wait_for_function("window.__tracks.every(track=>track.readyState==='ended')")
        self.start()
        report = self.stop()
        self.assertGreater(report['frames']['total'],0)
        self.assert_camera_released()

    def test_server_errors_preserve_completed_captures(self):
        for failure in ['503','network']:
            with self.subTest(failure=failure):
                self.failure = None
                if failure == 'network':
                    self.page.locator('#dev-reconnect').click()
                    expect(self.page.locator('#dev-report-start')).to_be_enabled()
                self.start()
                self.failure = failure
                report = self.report()
                self.assertEqual(report['session']['end_reason'],'error')
                self.assertGreater(report['frames']['total'],0)
                self.assertEqual(len(report['errors']),1)
                self.assertIn('Python' if failure=='network' else 'Modelo',report['errors'][0]['message'])
                self.assert_camera_released()

    def test_hidden_page_interrupts_and_releases_camera(self):
        self.start()
        self.page.evaluate("Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));")
        report = self.report()
        self.assertEqual(report['session']['end_reason'],'interrupted')
        self.assertGreater(report['frames']['total'],0)
        self.assert_camera_released()

    def test_frame_from_previous_camera_run_is_discarded(self):
        self.page.evaluate("""
          const originalFetch=window.fetch.bind(window);window.__holdFrame=true;
          window.fetch=async(...args)=>{
            const response=await originalFetch(...args);
            if(String(args[0]).endsWith('/recognize') && window.__holdFrame){
              window.__holdFrame=false;await new Promise(resolve=>window.__releaseFrame=resolve);
            }
            return response;
          };
        """)
        self.page.locator('#dev-tab-analysis').click()
        self.page.locator('#dev-ground-truth').select_option('b'*32)
        self.page.locator('#dev-start').click()
        self.page.wait_for_function("typeof window.__releaseFrame==='function'")
        self.page.locator('#dev-tab-validation').click()
        self.start()
        self.page.evaluate('window.__releaseFrame()')
        self.page.wait_for_timeout(150)
        report = self.stop()
        self.assertGreater(report['frames']['total'],0)
        self.assertEqual(report['evaluation']['fp'],0)
        self.assertEqual(report['evaluation']['fn'],0)
        self.assertEqual(report['frames']['annotated'],report['frames']['total'])
        self.assertEqual(self.page.evaluate('window.__tracks.length'),1,'The existing stream is reused')
        self.assert_camera_released()


if __name__ == '__main__':
    unittest.main(argv=[sys.argv[0],*test_arguments],verbosity=2)
