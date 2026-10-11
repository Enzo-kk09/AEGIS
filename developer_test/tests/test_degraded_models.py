import json
from pathlib import Path

import cv2
import numpy as np
import pytest

from developer_test.engine import FaceEngine
from developer_test.storage import ProfileStore


def test_real_model_known_unknown_degraded_and_multiple_face_frames(tmp_path):
    root=Path(__file__).resolve().parents[2]
    fixtures=root/'.runtime/downloads'
    if not all((fixtures/name).is_file() for name in ['lena.jpg','grace_hopper.jpg']):
        pytest.skip('Public face fixtures not installed.')
    engine=FaceEngine(root/'developer_test/models')
    if engine.health()[0]!='ready':
        pytest.skip('Verified face models not installed.')
    known=cv2.imread(str(fixtures/'lena.jpg'))
    unknown=cv2.imread(str(fixtures/'grace_hopper.jpg'))
    store=ProfileStore(tmp_path/'profiles.sqlite3')
    profile=store.add_profile('Temporary reference',engine.enroll([known]))
    snapshot=store.snapshot()
    ok,compressed=cv2.imencode('.jpg',known,[cv2.IMWRITE_JPEG_QUALITY,20])
    assert ok
    probes={
        'known_clear':known,'unknown_clear':unknown,
        'heavy_blur':cv2.GaussianBlur(known,(51,51),20),
        'low_light':(known*.08).astype('uint8'),
        'small_face':cv2.resize(known,(64,64)),
        'compressed':cv2.imdecode(compressed,cv2.IMREAD_COLOR),
    }
    resized_unknown=cv2.resize(unknown,(round(unknown.shape[1]*512/unknown.shape[0]),512))
    probes['multiple_faces']=np.concatenate([known,resized_unknown],axis=1)
    evidence={}
    for label,image in probes.items():
        result=engine.recognize(image,'auto',.45,snapshot)
        evidence[label]={'image':result['image'],'faces':[{'status':face['status'],'similarity':face['similarity'],'reason':face['reason'],'quality':face['quality']} for face in result['faces']],
                         'timings':result['timings'],'detection':result['detection']}
        assert all(value>=0 and np.isfinite(value) for value in result['timings'].values())
        if label=='known_clear':
            assert len(result['faces'])==1 and result['faces'][0]['profile']['id']==profile['id']
        if label=='unknown_clear':
            assert len(result['faces'])==1 and result['faces'][0]['status']=='unknown'
        if label in ['heavy_blur','low_light','small_face']:
            assert not any(face['status']=='matched' for face in result['faces']),label
        if label=='multiple_faces':
            assert len(result['faces'])==2
    store.close()
    output=root/'.runtime/validation/review/degraded-recognition-real-models.json'
    output.parent.mkdir(parents=True,exist_ok=True)
    output.write_text(json.dumps({'scope':'Controlled quality, known/unknown and multiple-face fixtures; not general identity accuracy.','results':evidence},ensure_ascii=False,indent=2),encoding='utf-8')
