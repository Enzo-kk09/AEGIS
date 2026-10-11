import io
import threading

import numpy as np
import pytest
from fastapi.testclient import TestClient
from PIL import Image

from developer_test.app import create_app
from developer_test.engine import FaceError, ProcessingCancelled
from developer_test.enrollment import compare_references
from developer_test.tests.test_api import authorize, picture, TOKEN
from developer_test.tests.test_engine import fake_engine
from developer_test.tests.test_storage import vector


def test_consistency_redundancy_and_existing_gallery_use_distinct_rules():
    report=compare_references([vector(),vector()],np.stack([vector(1)]))
    assert report['consistency']['passed']
    assert report['redundant_pairs']==1
    assert not report['gallery']['similar_to_existing']
    assert not compare_references([vector(),vector(1)])['consistency']['passed']
    assert compare_references([vector()],np.stack([vector()]))['gallery']['similar_to_existing']
    assert compare_references([])['consistency']['passed'] is None


def test_photo_diagnostics_keep_order_and_skip_extraction_for_bad_photos(tmp_path):
    engine=fake_engine(tmp_path)
    good=np.zeros((600,1000,3),dtype=np.uint8)
    photos,vectors,indices=engine.assess_enrollment([FaceError('Formato inválido.'),good,good])
    assert [photo['photo'] for photo in photos]==[1,2,3]
    assert not photos[0]['accepted']
    assert indices==[2,3]
    assert len(vectors)==2
    assert len(engine._recognizer.aligned_shapes)==2
    engine._assess_quality=lambda *args,**kwargs:{'reason':'Desfocado.','signals':{'blurred':True}}
    photos,vectors,indices=engine.assess_enrollment([good])
    assert not photos[0]['accepted'] and 'foco' in photos[0]['advice'][0]
    assert not vectors and not indices
    assert len(engine._recognizer.aligned_shapes)==2


@pytest.mark.parametrize('face_count',[0,2])
def test_photo_diagnostics_reject_missing_and_multiple_faces(tmp_path,face_count):
    engine=fake_engine(tmp_path,count=face_count)
    photos,vectors,_=engine.assess_enrollment([np.zeros((600,1000,3),dtype=np.uint8)])
    assert photos[0]['face_count']==face_count
    assert not photos[0]['accepted'] and not vectors


def test_preflight_can_cancel_between_photos(tmp_path):
    engine=fake_engine(tmp_path)
    event=threading.Event()
    original=engine._embedding
    def extract(*args):
        result=original(*args)
        event.set()
        return result
    engine._embedding=extract
    with pytest.raises(ProcessingCancelled):
        engine.assess_enrollment([np.zeros((600,1000,3),dtype=np.uint8)]*3,cancel=event)
    assert len(engine._recognizer.aligned_shapes)==1


def test_preflight_api_has_no_writes_vectors_or_names_and_rechecks_gallery(tmp_path):
    engine=fake_engine(tmp_path/'models')
    app=create_app(engine=engine,data_directory=tmp_path/'data',token=TOKEN)
    with TestClient(app,base_url='http://localhost:8765') as client:
        files=[('images',picture()),('images',picture())]
        first=client.post('/api/dev/enrollment-check',files=files,headers=authorize())
        assert first.status_code==200
        report=first.json()
        assert report['can_enroll'] and report['redundant_pairs']==1
        assert app.state.store.list_profiles()==[]
        assert not any(key in str(report) for key in ['embeddings','vector','private name'])
        app.state.store.add_profile('private name',[vector()])
        before=app.state.store.path.read_bytes()
        response=client.post('/api/dev/enrollment-check',files=files,headers=authorize())
        assert response.status_code==200 and not response.json()['can_enroll']
        assert response.json()['gallery']['similar_to_existing']
        assert 'private name' not in response.text
        assert app.state.store.path.read_bytes()==before
        assert client.post('/api/dev/enrollment-check',files=files).status_code==403
        assert client.post('/api/dev/enrollment-check',files=files*3,headers=authorize()).status_code==422


def test_preflight_reports_decode_error_for_only_the_affected_photo(tmp_path):
    engine=fake_engine(tmp_path/'models')
    app=create_app(engine=engine,data_directory=tmp_path/'data',token=TOKEN)
    with TestClient(app,base_url='http://localhost:8765') as client:
        response=client.post('/api/dev/enrollment-check',files=[('images',('bad.jpg',b'invalid','image/jpeg')),('images',picture())],headers=authorize())
        assert response.status_code==200
        photos=response.json()['photos']
        assert not response.json()['can_enroll']
        assert not photos[0]['accepted'] and photos[1]['accepted']
        assert response.json()['consistency']['pairs']==[]
