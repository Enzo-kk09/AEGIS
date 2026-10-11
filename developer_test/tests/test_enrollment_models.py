"""Controlled quality probes with the installed models and public fixture photos."""
import io
import json
from pathlib import Path

import cv2
import pytest
from fastapi.testclient import TestClient
from developer_test.app import create_app
from developer_test.engine import FaceEngine
from developer_test.tests.test_api import authorize, TOKEN


def test_real_models_preflight_quality_consistency_and_read_only_gallery(tmp_path):
    root=Path(__file__).resolve().parents[2]
    fixtures=root/'.runtime/downloads'
    if not (fixtures/'lena.jpg').is_file() or not (fixtures/'grace_hopper.jpg').is_file():
        pytest.skip('Public image fixtures not installed.')
    engine=FaceEngine(root/'developer_test/models')
    if engine.health()[0]!='ready':
        pytest.skip('Verified face models not installed.')
    photo=cv2.imread(str(fixtures/'lena.jpg'))
    def encoded(image):
        ok,data=cv2.imencode('.jpg',image)
        assert ok
        return ('probe.jpg',data.tobytes(),'image/jpeg')
    app=create_app(engine=engine,data_directory=tmp_path/'data',token=TOKEN)
    evidence={}
    with TestClient(app,base_url='http://localhost:8765') as client:
        def probe(label,files):
            response=client.post('/api/dev/enrollment-check',files=[('images',file) for file in files],headers=authorize())
            assert response.status_code==200,response.text
            result=response.json()
            evidence[label]=result
            return result
        good=probe('clear',[encoded(photo)])
        assert good['can_enroll']
        repeated=probe('redundant',[encoded(photo),encoded(photo)])
        assert repeated['can_enroll'] and repeated['redundant_pairs']==1
        mixed=probe('different_people',[encoded(photo),('other.jpg',(fixtures/'grace_hopper.jpg').read_bytes(),'image/jpeg')])
        assert not mixed['can_enroll'] and not mixed['consistency']['passed']
        for label,image in [('blurred',cv2.GaussianBlur(photo,(51,51),20)),('dark',(photo*.08).astype('uint8')),('small',cv2.resize(photo,(64,64)))]:
            result=probe(label,[encoded(image)])
            assert not result['can_enroll'],label
            assert not result['photos'][0]['accepted']
        assert app.state.store.list_profiles()==[]
        profile=client.post('/api/dev/profiles',data={'name':'Temporary reference'},files=[('images',encoded(photo))],headers=authorize())
        assert profile.status_code==201
        before=app.state.store.path.read_bytes()
        duplicate=probe('existing_face',[encoded(photo)])
        assert not duplicate['can_enroll'] and duplicate['gallery']['similar_to_existing']
        assert app.state.store.path.read_bytes()==before
    output=root/'.runtime/validation/review/enrollment-diagnostics-real-models.json'
    output.parent.mkdir(parents=True,exist_ok=True)
    output.write_text(json.dumps({'scope':'Controlled public fixtures; quality and API behavior, not general identity accuracy.','results':evidence},ensure_ascii=False,indent=2),encoding='utf-8')
