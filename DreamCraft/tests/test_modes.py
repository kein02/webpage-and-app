"""Run each mode in a fresh process; never invoke a paid generation API."""
import asyncio
import os
import sys
import tempfile
from pathlib import Path
from unittest.mock import patch, MagicMock

mode = sys.argv[1]
folder = tempfile.TemporaryDirectory(prefix='dreamcraft-mode-')
os.environ.update(DREAMCRAFT_MODE=mode, DATA_DIR=folder.name,
    DREAMCRAFT_DB=str(Path(folder.name) / 'test.db'), NO_LOCAL_ENV='1',
    BYOK_ONLY='0', COMFYUI_DISABLE='0', AGNES_API_KEY='fake-owner-key')
sys.path.insert(0, str(__import__('pathlib').Path(__file__).resolve().parents[1] / 'app' / 'backend'))
from fastapi.testclient import TestClient
with patch('urllib.request.urlopen', side_effect=OSError('offline')):
    import main
import providers
client = TestClient(main.app)
client.__enter__()
assert client.get('/api/runtime').json()['mode'] == mode

if mode == 'public':
    assert main.AGNES_KEY is None
    assert main._BYOK_ONLY
    assert isinstance(main._GLOBAL, main.MockProvider)
    assert main._video_platform_for('anon')[0] is None
    assert client.get('/api/comfy/system_stats', headers={'X-Comfy-Base': main.COMFYUI_URL}).status_code == 403
    assert client.post('/lv/v1/editor/image/ai_model/submit_task', json={'prompt': 'test'}).status_code == 401
    registration = client.post('/api/auth/register', json={'username': 'public-audit', 'password': 'test-password'}).json()
    headers = {'Authorization': 'Bearer ' + registration['token']}
    uid = registration['user_id']
    main.userconfig.save('anon', agnes_key='fake-anonymous-owner-key')
    assert isinstance(main._provider_for('anon'), main.MockProvider)
    assert client.get('/lv/v1/generate/model_config').json()['engine'] == 'none'
    with patch.object(providers, 'open_remote', side_effect=AssertionError('unexpected network')):
        assert client.post('/lv/v1/editor/image/ai_model/submit_task', headers=headers, json={'prompt': 'test'}).status_code == 400
        assert client.post('/lv/v1/editor/video/submit_task', headers=headers, json={'prompt': 'test'}).status_code == 400
    for url in ['http://127.0.0.1:8188', 'http://[::1]:8188', 'http://192.168.1.2:8188', 'http://169.254.169.254', 'http://2130706433:8188']:
        r = client.post('/api/biz/v1/engine/config', headers=headers, json={'comfyui_url': url})
        assert r.status_code == 400, (url, r.text)
        r = client.post('/lv/v1/editor/image/interactive_matting', headers=headers,
            json={'image_url': 'test', 'engine': {'comfyui_url': url}})
        assert r.status_code == 400, (url, r.text)
    with patch.object(providers.socket, 'getaddrinfo', return_value=[(2, 1, 6, '', ('93.184.216.34', 443))]):
        r = client.post('/api/biz/v1/engine/config', headers=headers,
            json={'agnes_key': 'fake-user-key', 'agnes_root': 'https://user.example.com'})
        assert r.status_code == 200, r.text
    assert main._provider_for(uid).api_key == 'fake-user-key'
    assert main._video_platform_for(uid)[1] == 'fake-user-key'
    assert main._video_platform_for(uid)[4] == 'user'
    assert isinstance(main._provider_for('another-user'), main.MockProvider)
    with patch.object(providers.socket, 'getaddrinfo', return_value=[(2, 1, 6, '', ('127.0.0.1', 80))]):
        try:
            providers._PublicRedirect().redirect_request(MagicMock(), None, 302, '', {}, 'http://private.example/')
            raise AssertionError('redirect to private address was accepted')
        except ValueError:
            pass
    print('PASS public: inherited owner key ignored, no default provider, auth required, proxy closed, private addresses rejected, own credentials isolated')
else:
    assert main.AGNES_KEY == 'fake-owner-key'
    assert not main._BYOK_ONLY
    assert isinstance(main._GLOBAL, main.AgnesProvider)
    assert main._video_platform_for('anon')[1] == 'fake-owner-key'
    with patch.object(main, '_comfy_reachable', return_value=True), patch.object(main, '_GLOBAL', main.MockProvider()):
        assert isinstance(main._provider_for('anon'), main.ComfyUIProvider)
    assert client.get('/api/runtime').json()['local_comfy_proxy']
    providers.validate_remote_url('http://127.0.0.1:8188')
    print('PASS local: inherited owner key and automatic ComfyUI available, loopback allowed, local proxy enabled')

async def close():
    for module in (main.auth, main.wallet, main.team, main.userconfig, sys.modules['taskstore']):
        conn = getattr(module._local, 'conn', None)
        if conn:
            conn.close(); module._local.conn = None
client.portal.call(close)
client.__exit__(None, None, None)
asyncio.run(close())
folder.cleanup()
