import threading
from concurrent.futures import ThreadPoolExecutor

import numpy as np
from developer_test.tests.test_api import environment, authorize, picture
from developer_test.tests.test_storage import vector
from developer_test.storage import ProfileStore


def test_parallel_duplicate_enrollment_is_atomic(environment):
    client,app,engine=environment
    barrier=threading.Barrier(2)
    def enroll(images,cancel=None):
        barrier.wait(timeout=3)
        return [engine.vector.copy()]
    engine.enroll=enroll
    def request(name):
        return client.post('/api/dev/profiles',data={'name':name},files=[('images',picture())],headers=authorize()).status_code
    with ThreadPoolExecutor(2) as pool:
        results=list(pool.map(request,['First','Second']))
    assert sorted(results)==[201,409]
    assert len(app.state.store.list_profiles())==1
    assert len(app.state.store.snapshot()[1])==1


def test_processing_capacity_keeps_health_available_and_delete_invalidates_result(environment):
    client,app,engine=environment
    profile=app.state.store.add_profile('Concurrent reference',[vector()])
    _,original_revision=app.state.store.snapshot_with_revision()
    started=threading.Barrier(3)
    release=threading.Event()
    original=engine.recognize
    def recognize(*args,**kwargs):
        started.wait(timeout=3)
        assert release.wait(5)
        return original(*args,**kwargs)
    engine.recognize=recognize
    def request():
        return client.post('/api/dev/recognize',files={'image':picture()},headers=authorize())
    with ThreadPoolExecutor(2) as pool:
        workers=[pool.submit(request) for _ in range(2)]
        try:
            started.wait(timeout=3)
            assert client.get('/api/dev/health').status_code==200
            assert client.get('/api/dev/profiles').json()['profiles'][0]['id']==profile['id']
            assert request().status_code==429
            assert client.delete('/api/dev/profiles/'+profile['id'],headers=authorize()).status_code==200
        finally:
            release.set()
        for worker in workers:
            response=worker.result(timeout=3)
            assert response.status_code==200
            result=response.json()
            assert result['gallery_changed']
            assert result['gallery_revision']==original_revision
            assert result['gallery_current_revision']!=original_revision
            assert result['faces'][0]['status']=='uncertain'
            assert result['faces'][0]['profile'] is None
    engine.recognize=original
    assert request().json()['faces'][0]['status']=='unknown'
    assert app.state.store.list_profiles()==[]


def test_immutable_snapshots_remain_consistent_during_concurrent_mutations(tmp_path):
    store=ProfileStore(tmp_path/'profiles.sqlite3')
    barrier=threading.Barrier(4)
    def mutate(axis):
        barrier.wait(timeout=3)
        for iteration in range(20):
            profile=store.add_profile(f'Worker {axis}/{iteration}',[vector(axis)])
            assert store.delete_profile(profile['id'])
    def read():
        barrier.wait(timeout=3)
        for _ in range(100):
            (profiles,matrix,owners),revision=store.snapshot_with_revision()
            assert len(revision)==16
            assert len(matrix)==len(owners)
            assert matrix.shape[1]==128
            assert not matrix.flags.writeable and not owners.flags.writeable
            assert all(0<=owner<len(profiles) for owner in owners)
            if len(matrix):
                assert np.allclose(np.linalg.norm(matrix,axis=1),1)
    with ThreadPoolExecutor(4) as pool:
        futures=[pool.submit(mutate,axis) for axis in range(3)]+[pool.submit(read)]
        for future in futures:
            future.result(timeout=8)
    assert store.list_profiles()==[]
    store.close()


def test_benchmark_is_invalidated_when_gallery_changes_with_same_profile_count(environment):
    client,app,engine=environment
    profile=app.state.store.add_profile('Original',[vector()])
    started=threading.Event()
    release=threading.Event()
    original=engine.benchmark
    def benchmark(*args,**kwargs):
        started.set()
        assert release.wait(3)
        return original(*args,**kwargs)
    engine.benchmark=benchmark
    with ThreadPoolExecutor(1) as pool:
        pending=pool.submit(client.post,'/api/dev/benchmark',files={'image':picture()},headers=authorize())
        try:
            assert started.wait(3)
            assert client.delete('/api/dev/profiles/'+profile['id'],headers=authorize()).status_code==200
            app.state.store.add_profile('Replacement',[vector(1)])
        finally:
            release.set()
        result=pending.result(timeout=3).json()
    assert result['gallery_changed']
    assert len(app.state.store.list_profiles())==1
    assert all(not row['stable'] and row['gallery_changed'] for row in result['results'])
    assert all(face['status']=='uncertain' and face['profile'] is None for row in result['results'] for face in row['faces'])
