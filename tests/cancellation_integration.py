"""Verify TCP disconnect cancellation against an isolated loopback server."""
import io
import json
import socket
import tempfile
import threading
import time
import urllib.request
from pathlib import Path

import numpy as np
import uvicorn
from PIL import Image

from developer_test.app import create_app
from developer_test.engine import check_cancelled


class InterruptedEngine:
    def __init__(self):
        self.started=threading.Event()
        self.cancelled=threading.Event()
        self.runs=0

    def health(self):
        return 'ready','Isolated test engine.'

    def benchmark(self,*args,cancel=None):
        self.started.set()
        try:
            for _ in range(100):
                check_cancelled(cancel)
                self.runs+=1
                time.sleep(.02)
            raise AssertionError('Disconnected benchmark executed to completion.')
        finally:
            self.cancelled.set()


def main():
    engine=InterruptedEngine()
    root=Path(__file__).resolve().parents[1]
    with tempfile.TemporaryDirectory(prefix='cancel-tcp-',dir=root/'.runtime/validation') as temporary:
        app=create_app(engine=engine,data_directory=temporary,token='isolated-token')
        listener=socket.socket()
        listener.bind(('127.0.0.1',0))
        port=listener.getsockname()[1]
        server=uvicorn.Server(uvicorn.Config(app,host='127.0.0.1',port=port,log_level='error',access_log=False))
        thread=threading.Thread(target=server.run,kwargs={'sockets':[listener]},daemon=True)
        thread.start()
        try:
            deadline=time.monotonic()+5
            while not server.started:
                if time.monotonic()>deadline:
                    raise RuntimeError('Isolated server did not start.')
                time.sleep(.01)
            image=io.BytesIO()
            Image.new('RGB',(120,100),(100,140,180)).save(image,format='JPEG')
            body=b'--boundary\r\nContent-Disposition: form-data; name="image"; filename="test.jpg"\r\nContent-Type: image/jpeg\r\n\r\n'+image.getvalue()+b'\r\n--boundary--\r\n'
            with socket.create_connection(('127.0.0.1',port),timeout=3) as client:
                headers=f'POST /api/dev/benchmark HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nX-AEGIS-Token: isolated-token\r\nContent-Type: multipart/form-data; boundary=boundary\r\nContent-Length: {len(body)}\r\n\r\n'.encode()
                client.sendall(headers+body)
                assert engine.started.wait(2)
            assert engine.cancelled.wait(2),'Closing the TCP client must stop the benchmark.'
            assert engine.runs<100
            deadline=time.monotonic()+2
            while True:
                first=app.state.capacity.acquire(blocking=False)
                second=first and app.state.capacity.acquire(blocking=False)
                if first:
                    app.state.capacity.release()
                if second:
                    app.state.capacity.release()
                    break
                assert time.monotonic()<deadline,'Processing capacity was not released.'
                time.sleep(.01)
            with urllib.request.urlopen(f'http://127.0.0.1:{port}/api/dev/health',timeout=2) as response:
                assert json.load(response)['status']=='ready'
            assert app.state.store.list_profiles()==[]
            print(f'TCP disconnect stopped the isolated benchmark after {engine.runs} run(s); capacity released.')
        finally:
            server.should_exit=True
            thread.join(5)
            listener.close()
            assert not thread.is_alive()


if __name__=='__main__':
    main()
