"""Verify a built production image with disposable container and volume."""
import json
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request
import uuid

image = sys.argv[1] if len(sys.argv) > 1 else 'craft-dreamcraft'
name = 'dreamcraft-qa-' + uuid.uuid4().hex[:12]
volume = name + '-data'
with socket.socket() as sock:
    sock.bind(('127.0.0.1', 0))
    port = sock.getsockname()[1]
base = f'http://127.0.0.1:{port}'
opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))


def docker(*args):
    return subprocess.run(['docker', *args], capture_output=True, text=True,
                          encoding='utf-8', check=True, timeout=120).stdout


def request(path, body=None, token=None, raw=False):
    headers = {'Content-Type': 'application/json'}
    if token:
        headers['Authorization'] = 'Bearer ' + token
    req = urllib.request.Request(base + path,
        data=json.dumps(body).encode() if body is not None else None, headers=headers)
    try:
        with opener.open(req, timeout=10) as response:
            return response.status, response.read() if raw else json.load(response)
    except urllib.error.HTTPError as error:
        return error.code, error.read()


def start():
    docker('run', '-d', '--name', name, '-p', f'127.0.0.1:{port}:8100',
           '-v', volume + ':/data', image)
    for _ in range(60):
        try:
            status, runtime = request('/api/runtime')
            if status == 200:
                assert runtime == {'mode': 'public', 'default_engines': False, 'local_comfy_proxy': False}
                return
        except OSError:
            pass
        time.sleep(1)
    raise AssertionError('Container startup timed out')


created_volume = False
try:
    docker('volume', 'create', volume)
    created_volume = True
    start()
    assert b'<html' in request('/', raw=True)[1]
    assert b'<html' in request('/ai-tool/engine', raw=True)[1]
    assert request('/lv/v1/editor/image/ai_model/submit_task', {'prompt': 'test'})[0] == 401
    account = request('/api/auth/register', {'username': 'container-qa', 'password': 'test-password'})[1]
    token = account['token']
    assert request('/lv/v1/editor/image/ai_model/submit_task', {'prompt': 'test'}, token)[0] == 400
    assert request('/api/biz/v1/engine/config', {'video_platform': 'agnes', 'video_key': 'container-fake-key'}, token)[0] == 200
    assert request('/api/biz/v1/engine/config', token=token)[1]['has_video_key']
    filters = docker('exec', name, 'ffmpeg', '-hide_banner', '-filters')
    assert 'drawtext' in filters, 'FFmpeg lacks subtitle rendering'
    assert docker('exec', name, 'fc-match', ':lang=zh').strip()
    private = docker('exec', name, 'find', '/app', '/frontend', '-name', '*.db', '-o', '-name', '.env', '-o', '-name', '.jwt-secret', '-o', '-name', '.engine-key')
    assert not private.strip(), 'Private runtime files in application directory'
    print('PASS production container: frontend/routes, isolated public API, account/config, FFmpeg/subtitle font and clean image', flush=True)
    docker('rm', '-f', name)
    start()
    login = request('/api/auth/login', {'username': 'container-qa', 'password': 'test-password'})[1]
    assert login['user_id'] == account['user_id']
    assert request('/api/biz/v1/engine/config', token=login['token'])[1]['has_video_key']
    print('PASS replacement container preserves account and encrypted engine config on data volume', flush=True)
except Exception:
    logs = subprocess.run(['docker', 'logs', name], capture_output=True, text=True, encoding='utf-8')
    print(logs.stdout[-3000:], logs.stderr[-3000:])
    raise
finally:
    subprocess.run(['docker', 'rm', '-f', name], capture_output=True, timeout=30)
    if created_volume:
        docker('volume', 'rm', volume)
