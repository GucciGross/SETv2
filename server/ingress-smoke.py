"""Real HTTP(S)/WS(S) Nginx ingress against the disposable H5P CI stack only."""
import asyncio
import json
import os
import ssl
from urllib.request import Request, urlopen
import websockets

if os.environ.get('H5P_TEST_DATABASE') != '1':
    raise RuntimeError('Use only the disposable CI fixture with H5P_TEST_DATABASE=1')

async def check(port, tls):
    origin = f"{'https' if tls else 'http'}://localhost:{port}"
    context = ssl._create_unverified_context() if tls else None
    def request(method, path, data=None):
        body = None if data is None else json.dumps(data).encode()
        with urlopen(Request(origin + path, data=body, method=method,
                             headers={'content-type': 'application/json'}), context=context, timeout=20) as response:
            assert response.headers.get_content_type() == 'application/json'
            return json.loads(response.read())
    health = request('GET', '/health')
    assert health['ok'] is True and health['name'] == 'SET'
    token = request('POST', '/api/auth/login', {'email': 'demo@set.local', 'password': 'demo-demo'})['token']
    # Never print tokens/URLs. Unauthorized sessions must still be rejected by
    # the application after the transport upgrade. Test canonical + legacy paths.
    for path in ['/api/ws', '/ws']:
        url = f"{'wss' if tls else 'ws'}://localhost:{port}{path}"
        async with websockets.connect(url, additional_headers={'Authorization': 'Bearer ' + token}, ssl=context, open_timeout=10) as ws:
            pong = await ws.ping()
            await asyncio.wait_for(pong, timeout=5)
        async with websockets.connect(url, ssl=context, open_timeout=10) as ws:
            await asyncio.wait_for(ws.wait_closed(), timeout=5)
            assert ws.close_code == 4001
    print(f"PASS: {'HTTPS/WSS' if tls else 'HTTP/WS'} JSON liveness, canonical and legacy WebSockets, authentication denial")

async def main():
    await check(8088, False)
    await check(8448, True)
asyncio.run(main())
