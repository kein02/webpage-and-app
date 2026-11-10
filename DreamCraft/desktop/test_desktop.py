"""Exercise the frozen executable with isolated data and no paid generation."""
import io
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request

from PIL import Image
from playwright.sync_api import sync_playwright

exe = Path(sys.argv[1]).resolve()
version = (Path(__file__).resolve().parents[1] / 'VERSION').read_text(encoding='utf-8').strip()
if '--version' in sys.argv:
    version = sys.argv[sys.argv.index('--version') + 1]
test_root = Path(__file__).resolve().parents[1] / 'tests' / 'output' / ('desktop-' + time.strftime('%Y%m%d-%H%M%S'))
test_root.mkdir(parents=True)
data = test_root / 'data'
env = dict(os.environ)
for field in ('AGNES_API_KEY', 'AGNES_API_TOKEN', 'APIHUB_AGNES_API_KEY', 'AGNES_API_ROOT',
              'DREAMCRAFT_CONFIG_KEY', 'JWT_SECRET', 'DATA_DIR', 'DREAMCRAFT_DB'):
    env.pop(field, None)
env['PATH'] = os.environ['SystemRoot'] + '\\System32'
env['DREAMCRAFT_UPDATE_CHECK'] = '0'
opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
processes = []


def request(url, body=None, token=None, timeout=180):
    headers = {'Content-Type': 'application/json'}
    if token:
        headers['Authorization'] = 'Bearer ' + token
    req = urllib.request.Request(url, data=json.dumps(body).encode() if body is not None else None, headers=headers)
    with opener.open(req, timeout=timeout) as response:
        return json.load(response)


def start(gui=False):
    command = [str(exe), '--data-dir', str(data), '--no-browser']
    if not gui:
        command.append('--no-window')
    proc = subprocess.Popen(command,
        cwd=str(test_root), env=env, creationflags=subprocess.CREATE_NO_WINDOW)
    processes.append(proc)
    for _ in range(200):
        if proc.poll() is not None:
            raise AssertionError('EXE exited: ' + (data / 'desktop.log').read_text(encoding='utf-8'))
        try:
            state = json.loads((data / 'desktop.json').read_text(encoding='utf-8'))
            if (state.get('pid') == proc.pid and
                    request(state['url'] + '/api/desktop/status', timeout=2)['instance'] == state['instance']):
                return proc, state
        except (OSError, ValueError, KeyError):
            pass
        time.sleep(.1)
    raise AssertionError('EXE startup timeout')


def stop(proc, state):
    req = urllib.request.Request(state['url'] + '/api/desktop/stop', data=b'',
        headers={'X-Desktop-Token': state['instance']}, method='POST')
    with opener.open(req, timeout=10) as response:
        assert json.load(response)['stopping']
    assert proc.wait(timeout=15) == 0


try:
    proc, state = start()
    base = state['url']
    assert request(base + '/openapi.json')['info']['version'] == version
    assert request(base + '/api/runtime') == {'mode': 'local', 'default_engines': True, 'local_comfy_proxy': True}
    diagnostics = request(base + '/api/biz/v1/engine/diagnostics')
    assert diagnostics['video']['configured'] is False
    assert isinstance(diagnostics['ffmpeg']['ready'], bool)
    assert 'FFmpeg' in diagnostics['ffmpeg']['message']
    assert Path(request(base + '/api/desktop/status')['data_dir']) == data
    assert not request(base + '/api/biz/v1/asset/list')['assets']
    duplicate = subprocess.Popen([str(exe), '--data-dir', str(data), '--no-browser', '--no-window'],
        cwd=test_root, env=env, creationflags=subprocess.CREATE_NO_WINDOW)
    processes.append(duplicate)
    assert duplicate.wait(timeout=15) == 0
    assert proc.poll() is None
    user = request(base + '/api/auth/register', {'username': 'desktop-test', 'password': 'test-password'})
    token = user['token']
    request(base + '/api/biz/v1/engine/config', {'video_platform': 'agnes', 'video_key': 'fake-desktop-key'}, token)
    assert request(base + '/api/biz/v1/engine/config', token=token)['has_video_key']
    buf = io.BytesIO()
    Image.new('RGB', (64, 48), '#21a798').save(buf, 'PNG')
    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=True)
        page = browser.new_page(viewport={'width': 1440, 'height': 1000})
        errors = []
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.goto(base + '/login')
        page.wait_for_load_state('networkidle')
        page.get_by_placeholder('用户名', exact=True).fill('desktop-test')
        page.get_by_placeholder('密码（至少 6 位）').fill('test-password')
        page.get_by_role('button', name='登录', exact=True).last.click()
        page.wait_for_url(base + '/')
        page.goto(base + '/ai-tool/asset')
        page.wait_for_load_state('networkidle')
        page.get_by_label('上传素材').set_input_files({'name': 'desktop.png', 'mimeType': 'image/png', 'buffer': buf.getvalue()})
        image = page.locator('figure img').first
        try:
            image.wait_for(timeout=10000)
        except Exception:
            print(page.locator('body').inner_text(), flush=True)
            page.screenshot(path=str(test_root / 'failure.png'))
            raise
        image.evaluate('(img) => img.decode()')
        assert image.evaluate('(img) => img.naturalWidth') == 64
        page.screenshot(path=str(test_root / 'desktop-assets.png'))
        for path in ('engine', 'ai-image', 'ai-video', 'task-center', 'team', 'tools', 'novel'):
            page.goto(base + '/ai-tool/' + path)
            page.wait_for_load_state('networkidle')
            assert page.locator('h1').count()
        assert not errors, errors
        browser.close()
    generated_count = 0
    if '--generate' in sys.argv:
        generated = request(base + '/lv/v1/editor/image/ai_model/submit_task',
            {'prompt': 'a green glass vase on a white table, product photograph', 'model': 'sdxl-draft',
             'resolution': 256, 'n': 1}, token)
        assert generated['result']['results'][0]['url'].startswith('/exports/')
        assert request(base + '/lv/v1/task/status/' + generated['task_id'], token=token)['status'] == 'succeed'
        generated_count = 1
        print('PASS frozen EXE real local GPU generation and saved task', flush=True)
    print('PASS frozen EXE: clean data, no Python/Node PATH, loopback runtime, duplicate launch, login, encrypted config, upload and application routes', flush=True)
    stop(proc, state)
    proc, state = start()
    assert request(state['url'] + '/api/auth/login', {'username': 'desktop-test', 'password': 'test-password'})['user_id'] == user['user_id']
    assert request(state['url'] + '/api/biz/v1/engine/config', token=token)['has_video_key']
    assert len(request(state['url'] + '/api/biz/v1/asset/list', token=token)['assets']) == 1 + generated_count
    saved_port = state['port']
    stop(proc, state)
    with socket.socket() as occupied:
        occupied.bind(('127.0.0.1', saved_port))
        occupied.listen()
        proc, state = start()
        assert state['port'] != saved_port
        stop(proc, state)
    proc, state = start(gui=True)
    import ctypes
    from ctypes import wintypes
    user32 = ctypes.windll.user32
    windows = []
    callback_type = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)
    def find_window(hwnd, _):
        pid = wintypes.DWORD()
        user32.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
        if pid.value == state['pid'] and user32.IsWindowVisible(hwnd):
            windows.append(hwnd)
        return True
    for _ in range(100):
        user32.EnumWindows(callback_type(find_window), 0)
        if windows:
            break
        time.sleep(.1)
    assert windows, 'Launcher window missing'
    user32.PostMessageW(windows[0], 0x0010, 0, 0)
    assert proc.wait(timeout=15) == 0
    print('PASS frozen EXE: restart preserves accounts/config/assets; occupied port fallback; authenticated graceful shutdown', flush=True)
    print('PASS native launcher window starts and closes its local backend', flush=True)
    print('EVIDENCE=' + str(test_root), flush=True)
finally:
    for proc in processes:
        if proc.poll() is None:
            proc.terminate()
            proc.wait(timeout=15)
