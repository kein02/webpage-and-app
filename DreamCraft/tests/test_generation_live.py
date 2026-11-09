"""Opt-in live acceptance. --cloud performs billable image/edit/video requests."""
import argparse
import base64
import io
import json
import os
import socket
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path


def run():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--cloud', action='store_true', help='Allow three billable cloud requests')
    parser.add_argument('--video-only', action='store_true', help='Allow one billable video request without repeating images')
    parser.add_argument('--comfy', action='store_true', help='Test installed ComfyUI editing and browser download')
    args = parser.parse_args()
    if not args.cloud and not args.comfy and not args.video_only:
        print('SKIP: choose --comfy, --cloud or --video-only explicitly')
        return
    root = Path(__file__).resolve().parents[1]
    output = root / 'tests' / 'output' / 'live-acceptance'
    output.mkdir(parents=True, exist_ok=True)
    os.environ.update(DREAMCRAFT_MODE='local', BYOK_ONLY='0', DATA_DIR=str(output),
                      DREAMCRAFT_DB=str(output / 'dreamcraft.db'))
    sys.path.insert(0, str(root / 'app' / 'backend'))
    import main
    import providers
    import uvicorn
    from PIL import Image

    # The editing regression uses this fixed loopback port; fail if it is occupied.
    with socket.socket() as sock:
        sock.bind(('127.0.0.1', 8101))
    base = 'http://127.0.0.1:8101'
    server = uvicorn.Server(uvicorn.Config(main.app, host='127.0.0.1', port=8101, log_level='warning'))
    thread = threading.Thread(target=server.run, daemon=True)
    summary_path = output / 'summary.json'
    summary = json.loads(summary_path.read_text(encoding='utf-8')) if args.video_only and summary_path.exists() else {}
    summary.pop('error', None)
    headers = {'Content-Type': 'application/json'}

    def request(path, body=None, timeout=600):
        data = json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(base + path, data=data, headers=headers)
        try:
            with urllib.request.urlopen(req, timeout=timeout) as response:
                return json.loads(response.read())
        except urllib.error.HTTPError as error:
            detail = error.read().decode('utf-8', errors='replace')
            if providers.AGNES_KEY:
                detail = detail.replace(providers.AGNES_KEY, '[redacted]')
            raise RuntimeError(f'HTTP {error.code}: {detail[:400]}') from None

    def inspect_image(url, filename):
        if url.startswith('/'):
            with urllib.request.urlopen(base + url) as response:
                content = response.read()
        else:
            content = providers.read_image_bytes(url)
        image = Image.open(io.BytesIO(content))
        image.load()
        assert min(image.size) >= 256
        assert max(hi - lo for lo, hi in image.convert('RGB').getextrema()) > 20
        image.save(output / filename)
        return content

    try:
        thread.start()
        for _ in range(200):
            if server.started:
                break
            time.sleep(.05)
        assert server.started, 'Acceptance server did not start'
        if args.comfy:
            env = dict(os.environ, DREAMCRAFT_TEST_BASE=base)
            for name in ('test_edit_live.py', 'test_direct.py'):
                subprocess.run([sys.executable, '-X', 'utf8', str(root / 'tests' / name)],
                               cwd=root, env=env, check=True)
            summary['comfy'] = 'passed: inpaint/outpaint/matting/background/browser/download/assets/3D'

        if args.cloud or args.video_only:
            assert providers.AGNES_KEY, 'No configured cloud credential'
            req = urllib.request.Request(providers.AGNES_ROOT.rstrip('/') + '/v1/models',
                                         headers={'Authorization': 'Bearer ' + providers.AGNES_KEY})
            with providers.open_remote(req, timeout=30) as response:
                models = json.loads(response.read())
            ids = [item.get('id') for item in models.get('data', []) if isinstance(item, dict)]
            print('Cloud models:', ', '.join(str(item) for item in ids if item and ('image' in item or 'video' in item)), flush=True)
            assert providers.AGNES_IMAGE_MODEL in ids, 'Configured cloud image model is not listed'
            account = request('/api/auth/register', {'username': 'live-' + str(time.time_ns()), 'password': 'acceptance-only-password'})
            headers['Authorization'] = 'Bearer ' + account['token']
            request('/api/biz/v1/engine/config', {
                'agnes_key': providers.AGNES_KEY, 'agnes_root': providers.AGNES_ROOT,
                'video_platform': 'agnes', 'video_key': providers.AGNES_KEY,
                'video_base': providers.AGNES_ROOT,
            })
            if args.cloud:
                result = request('/lv/v1/editor/image/ai_model/submit_task', {
                    'prompt': 'A red ceramic vase with a single green leaf on a white table, clear studio product photograph, soft daylight',
                    'resolution': 512, 'n': 1, 'seed': 41,
                })
                image_url = result['result']['results'][0]['url']
                image_bytes = inspect_image(image_url, 'cloud-image.png')
                summary['cloud_image'] = 'passed'
                print('PASS real cloud image generation and nonblank download', flush=True)
                reference = 'data:' + 'image/png;base64,' + base64.b64encode(image_bytes).decode()
                edited = request('/lv/v1/editor/image/ai_model/submit_task', {
                    'prompt': 'Change the red vase to a blue ceramic vase while preserving the single leaf, white table and composition.',
                    'resolution': 512, 'n': 1, 'ref_image': reference, 'seed': 43,
                })
                edited_bytes = inspect_image(edited['result']['results'][0]['url'], 'cloud-image-edited.png')
                assert edited_bytes != image_bytes, 'Cloud edit returned unchanged bytes'
                summary['cloud_edit'] = 'passed'
                print('PASS real cloud reference-image editing', flush=True)
            video = request('/lv/v1/editor/video/submit_task', {
                'prompt': 'A red ceramic vase and one green leaf on a white table. A slow subtle camera push in, steady soft daylight, realistic studio shot.',
                'duration': 3,
            })
            task_id = video['task_id']
            (output / 'cloud-video-task.json').write_text(json.dumps({'task_id': task_id}), encoding='utf-8')
            deadline = time.monotonic() + 1250
            while time.monotonic() < deadline:
                task = request('/lv/v1/task/status/' + task_id)
                if task['status'] in ('succeed', 'failed'):
                    break
                print('Cloud video: generating', flush=True)
                time.sleep(20)
            assert task['status'] == 'succeed', 'Cloud video failed or timed out: ' + str(task.get('error', 'timeout'))
            summary['cloud_video'] = 'passed'
            print('PASS real cloud video completion', flush=True)
            check = request('/api/biz/v1/engine/diagnostics')
            assert check['ffmpeg']['ready'], check['ffmpeg']['message']
            composed = request('/lv/v1/short_drama/compose', {
                'task_ids': [task_id, task_id], 'shot_duration': 2,
                'subtitles': [{'text': '第一幕：光与器物'}, {'text': '第二幕：镜头缓缓推进'}],
                'prompt': 'Live acceptance short drama',
            })
            with urllib.request.urlopen(base + composed['url']) as response:
                clip = response.read()
            assert len(clip) > 10000
            (output / 'cloud-drama.mp4').write_bytes(clip)
            assert composed['clips'] == 2 and composed['subtitles']
            summary['cloud_drama'] = 'passed: two clips reuse one paid video, Chinese subtitles'
            assets = request('/api/biz/v1/asset/list')['assets']
            assert any(item['url'] == composed['url'] for item in assets)
            print('PASS real short-drama composition, Chinese subtitles, download and asset persistence', flush=True)
    except Exception as error:
        message = str(error)
        if providers.AGNES_KEY:
            message = message.replace(providers.AGNES_KEY, '[redacted]')
        summary['error'] = message[:500]
        print('FAIL live acceptance:', summary['error'], flush=True)
        raise SystemExit(1) from None
    finally:
        (output / 'summary.json').write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding='utf-8')
        server.should_exit = True
        thread.join(timeout=10)


if __name__ == '__main__':
    run()
