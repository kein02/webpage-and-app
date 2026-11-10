"""Real launcher restart and encrypted-data restore using isolated data."""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import urllib.request
import zipfile

ROOT = Path(__file__).resolve().parents[1]
opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
env = {**os.environ, 'DREAMCRAFT_UPDATE_CHECK': '0'}
for key in ('JWT_SECRET', 'DREAMCRAFT_CONFIG_KEY', 'DATA_DIR', 'DREAMCRAFT_DB',
            'AGNES_API_KEY', 'AGNES_API_TOKEN', 'APIHUB_AGNES_API_KEY'):
    env.pop(key, None)
command = [str(Path(sys.argv[1]).resolve())] if len(sys.argv) > 1 else [sys.executable, '-X', 'utf8', str(ROOT / 'desktop' / 'desktop.py')]


def request(url, body=None, headers=None):
    req = urllib.request.Request(url, data=json.dumps(body).encode() if body is not None else None,
        headers={'Content-Type': 'application/json', **(headers or {})})
    with opener.open(req, timeout=20) as response:
        return json.load(response)


with tempfile.TemporaryDirectory(prefix='dreamcraft-desktop-backup-') as folder:
    root = Path(folder)
    data = root / 'data'
    archive = root / 'backup.zip'
    processes = []
    def launch(*extra):
        proc = subprocess.Popen([*command, '--data-dir', str(data), '--no-window', '--no-browser', *extra],
            env=env, cwd=ROOT, creationflags=subprocess.CREATE_NO_WINDOW)
        processes.append(proc)
        return proc

    def ready(proc):
        for _ in range(400):
            if proc.poll() is not None:
                raise AssertionError((data / 'desktop.log').read_text('utf-8'))
            try:
                state = json.loads((data / 'desktop.json').read_text('utf-8'))
                if state['pid'] == proc.pid and request(state['url'] + '/api/desktop/status')['instance'] == state['instance']:
                    return state
            except (OSError, ValueError, KeyError):
                pass
            time.sleep(.1)
        raise AssertionError('Launcher startup timeout')

    def stop(proc, state):
        request(state['url'] + '/api/desktop/stop', {}, {'X-Desktop-Token': state['instance']})
        assert proc.wait(timeout=30) == 0

    try:
        original = launch()
        state = ready(original)
        base = state['url']
        user = request(base + '/api/auth/register', {'username': 'backup-owner', 'password': 'test-password'})
        headers = {'Authorization': 'Bearer ' + user['token']}
        request(base + '/api/biz/v1/engine/config', {'video_platform': 'agnes', 'video_key': 'offline-original-key'}, headers)
        request(base + '/api/biz/v1/project/save', {'kind': 'canvas', 'name': 'Kept project', 'data': {'layers': []}}, headers)
        secret = (data / '.jwt-secret').read_bytes()
        engine_key = (data / '.engine-key').read_bytes()
        # Match the UI handoff: next launcher waits for the previous process to exit.
        exporting = launch('--backup-to', str(archive), '--wait-pid', str(original.pid))
        time.sleep(.2)
        assert not archive.exists()
        stop(original, state)
        state = ready(exporting)
        assert archive.is_file()
        with zipfile.ZipFile(archive) as z:
            assert 'desktop.json' not in z.namelist()
            assert z.read('.engine-key') == engine_key
        base = state['url']
        request(base + '/api/auth/register', {'username': 'after-backup', 'password': 'test-password'})
        request(base + '/api/biz/v1/engine/config', {'video_platform': 'agnes', 'video_key': 'offline-changed-key'}, headers)
        stop(exporting, state)
        restoring = launch('--restore-from', str(archive))
        state = ready(restoring)
        base = state['url']
        assert (data / '.jwt-secret').read_bytes() == secret
        assert (data / '.engine-key').read_bytes() == engine_key
        assert request(base + '/api/auth/login', {'username': 'backup-owner', 'password': 'test-password'})['user_id'] == user['user_id']
        assert request(base + '/api/biz/v1/engine/config', headers=headers)['has_video_key']
        assert request(base + '/api/biz/v1/project/list?kind=canvas', headers=headers)['projects'][0]['name'] == 'Kept project'
        try:
            request(base + '/api/auth/login', {'username': 'after-backup', 'password': 'test-password'})
            raise AssertionError('Newer account survived replacement restore')
        except urllib.error.HTTPError as error:
            assert error.code == 401
        assert list(root.glob('DreamCraft-before-restore-*.zip'))
        stop(restoring, state)
        print('PASS launcher wait/exit/restart, archive, replacement restore, login/project/encrypted config and recovery archive', flush=True)
    finally:
        for proc in processes:
            if proc.poll() is None:
                proc.terminate()
            proc.wait(timeout=30)
