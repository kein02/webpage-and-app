"""Real portable/installed update handoff with isolated accounts and verified local packages."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import time
import urllib.request
from unittest.mock import patch
import uuid

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'desktop'))
import updater


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('old_release', type=Path)
    parser.add_argument('--old-version', default='1.0.3')
    parser.add_argument('--installed', action='store_true')
    args = parser.parse_args()
    version = (ROOT / 'VERSION').read_text().strip()
    output = ROOT / 'tests/output' / ('update-' + uuid.uuid4().hex[:8])
    output.mkdir(parents=True)
    app, data = output / 'DreamCraft', output / 'data'
    env = dict(os.environ, DREAMCRAFT_UPDATE_CHECK='0')
    for key in ('AGNES_API_KEY', 'AGNES_API_TOKEN', 'APIHUB_AGNES_API_KEY',
                'AGNES_API_ROOT', 'JWT_SECRET', 'DREAMCRAFT_CONFIG_KEY', 'DATA_DIR', 'DREAMCRAFT_DB'):
        env.pop(key, None)
    processes = []
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))

    def request(state, path, body=None, token=None):
        headers = {'Content-Type': 'application/json'}
        if token:
            headers['Authorization'] = 'Bearer ' + token
        with opener.open(urllib.request.Request(state['url'] + path, headers=headers,
                data=json.dumps(body).encode() if body is not None else None), timeout=20) as response:
            return json.load(response)

    def wait_state(expected):
        for _ in range(400):
            try:
                state = json.loads((data / 'desktop.json').read_text())
                status = request(state, '/api/desktop/status')
                if (status['instance'] == state['instance'] and
                        request(state, '/openapi.json')['info']['version'] == expected):
                    return state
            except (OSError, ValueError, KeyError):
                pass
            time.sleep(.1)
        raise AssertionError('Updated runtime not ready; see ' + str(output))

    def window_handles(pid, visible=False):
        import ctypes
        from ctypes import wintypes
        handles = []
        callback_type = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)
        def visit(hwnd, _):
            found = wintypes.DWORD()
            ctypes.windll.user32.GetWindowThreadProcessId(hwnd, ctypes.byref(found))
            if found.value == pid and (not visible or ctypes.windll.user32.IsWindowVisible(hwnd)):
                handles.append(hwnd)
            return True
        ctypes.windll.user32.EnumWindows(callback_type(visit), 0)
        return handles

    def close_window(pid):
        import ctypes
        for hwnd in window_handles(pid):
            ctypes.windll.user32.PostMessageW(hwnd, 0x0010, 0, 0)

    try:
        if args.installed:
            import winreg
            key = r'Software\Microsoft\Windows\CurrentVersion\Uninstall\{7B50A372-A404-4B9C-9D99-73DECF6F9058}_is1'
            try:
                with winreg.OpenKey(winreg.HKEY_CURRENT_USER, key):
                    raise RuntimeError('Existing user installation; refusing update test')
            except FileNotFoundError:
                pass
            subprocess.run([str(args.old_release / f'DreamCraft-Setup-{args.old_version}-x64.exe'),
                '/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', '/SP-', '/TASKS=',
                '/DIR=' + str(app)], check=True)
            assert updater.installed(app)
        else:
            shutil.copytree(args.old_release / 'portable/DreamCraft', app)
        proc = subprocess.Popen([str(app / 'DreamCraft.exe'), '--data-dir', str(data),
            '--no-browser', '--no-window'], env=env, creationflags=subprocess.CREATE_NO_WINDOW)
        processes.append(proc)
        state = wait_state(args.old_version)
        user = request(state, '/api/auth/register', {'username': 'update-user', 'password': 'update-test-password'})
        token = user['token']
        request(state, '/api/biz/v1/engine/config',
                {'video_platform': 'agnes', 'video_key': 'fake-update-key'}, token)
        # A real asset and the encryption secret must survive directory replacement.
        import io
        import httpx
        from PIL import Image
        buf = io.BytesIO()
        Image.new('RGB', (32, 32), '#2bb8a1').save(buf, 'PNG')
        sign = request(state, '/api/biz/v1/common/get_upload_sign', {})
        with httpx.Client(trust_env=False) as client:
            upload = client.post(state['url'] + sign['url'],
                headers={'Authorization': 'Bearer ' + token},
                files={'file': ('before-update.png', buf.getvalue(), 'image/png')})
            upload.raise_for_status()
        assets_before = request(state, '/api/biz/v1/asset/list', token=token)['assets']
        assert assets_before, upload
        secret = (data / '.engine-key').read_bytes()
        name = f'DreamCraft-{"Setup" if args.installed else "Windows"}-{version}-x64'
        name += '.exe' if args.installed else '.zip'
        payload = ROOT / 'releases' / name
        release = {'tag_name': 'dreamcraft-v' + version, 'assets': [{
            'name': name, 'size': payload.stat().st_size,
            'digest': 'sha256:' + hashlib.sha256(payload.read_bytes()).hexdigest(),
            'browser_download_url': f'https://github.com/{updater.REPOSITORY}/releases/download/dreamcraft-v{version}/{name}'}]}
        with patch.object(updater, 'open_github', side_effect=lambda _: payload.open('rb')):
            plan = updater.prepare(release, args.old_version, app, data,
                                   ROOT / 'desktop/apply-update.ps1', lambda *_: None, no_browser=True)
        metadata = json.loads(plan.read_text())
        metadata['pid'] = proc.pid
        plan.write_text(json.dumps(metadata), encoding='utf-8')
        # The child inherits no browser opening and no automatic network check.
        with patch.dict(os.environ, env, clear=True):
            helper = updater.launch(plan)
        processes.append(helper)
        for _ in range(300):
            if (plan.parent / 'ready').exists():
                break
            if helper.poll() is not None:
                raise AssertionError((plan.parent / 'update.log').read_text())
            time.sleep(.1)
        assert (plan.parent / 'ready').exists()
        req = urllib.request.Request(state['url'] + '/api/desktop/stop', data=b'',
            headers={'X-Desktop-Token': state['instance']}, method='POST')
        opener.open(req, timeout=10).close()
        assert proc.wait(timeout=15) == 0
        assert helper.wait(timeout=120) == 0, (plan.parent / 'update.log').read_text()
        state = wait_state(version)
        for attempt in range(600):
            if window_handles(state['pid'], visible=True):
                break
            if attempt % 100 == 0:
                print('Waiting for updated launcher window, elapsed=' + str(attempt // 10) +
                      's pid=' + str(state['pid']) + ' windows=' +
                      str(window_handles(state['pid'])), flush=True)
            time.sleep(.1)
        assert window_handles(state['pid'], visible=True), 'Updated launcher window is hidden'
        login = request(state, '/api/auth/login', {'username': 'update-user', 'password': 'update-test-password'})
        assert login['user_id'] == user['user_id']
        assert request(state, '/api/biz/v1/engine/config', token=login['token'])['has_video_key']
        assets_after = request(state, '/api/biz/v1/asset/list', token=login['token'])['assets']
        assert [a['url'] for a in assets_after] == [a['url'] for a in assets_before]
        assert (data / '.engine-key').read_bytes() == secret
        close_window(state['pid'])
        for _ in range(150):
            try:
                request(state, '/api/desktop/status')
            except OSError:
                break
            time.sleep(.1)
        if not args.installed:
            assert (Path(metadata['backup']) / 'DreamCraft.exe').exists()
        print('PASS real ' + metadata['kind'] + ' update ' + args.old_version + ' -> ' + version +
              ': handoff, restart, login, encrypted key, assets and backup')
        print('EVIDENCE=' + str(output))
    finally:
        try:
            if (data / 'desktop.json').exists():
                state = json.loads((data / 'desktop.json').read_text())
                close_window(state['pid'])
        except (OSError, ValueError, KeyError):
            pass
        for proc in processes:
            if proc.poll() is None:
                proc.terminate()
                proc.wait(timeout=15)
        if args.installed and (app / 'unins000.exe').exists():
            subprocess.run([str(app / 'unins000.exe'), '/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART'], check=True)


if __name__ == '__main__':
    main()
