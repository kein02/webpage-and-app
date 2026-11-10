"""End-to-end editing, actual composition, upload and simulated upscale."""
import io
import os
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
import time
import urllib.request
import wave
from PIL import Image
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'tests' / 'output' / 'editing'
OUT.mkdir(parents=True, exist_ok=True)
with tempfile.TemporaryDirectory(prefix='dreamcraft-editing-browser-') as data:
    with socket.socket() as sock:
        sock.bind(('127.0.0.1', 0))
        port = sock.getsockname()[1]
    base = f'http://127.0.0.1:{port}'
    env = {**os.environ, 'DATA_DIR': data, 'DREAMCRAFT_MODE': 'public', 'NO_LOCAL_ENV': '1',
           'COMFYUI_DISABLE': '1', 'EDITING_TEST_PORT': str(port)}
    with (OUT / 'server.log').open('w', encoding='utf-8') as log:
        server = subprocess.Popen([sys.executable, '-X', 'utf8', str(ROOT / 'tests' / 'editing_server.py')],
                                  env=env, cwd=ROOT, stdout=log, stderr=subprocess.STDOUT)
        try:
            for _ in range(200):
                if server.poll() is not None:
                    raise RuntimeError((OUT / 'server.log').read_text('utf-8'))
                try:
                    urllib.request.urlopen(base + '/api/runtime', timeout=1).close()
                    break
                except OSError:
                    time.sleep(.1)
            with sync_playwright() as pw:
                browser = pw.chromium.launch(headless=True)
                page = browser.new_page(viewport={'width': 1440, 'height': 1000})
                errors = []
                page.on('pageerror', lambda e: errors.append(str(e)))
                page.on('dialog', lambda d: d.accept())
                page.goto(base + '/login')
                page.get_by_placeholder('用户名', exact=True).fill('editing-browser')
                page.get_by_placeholder('密码（至少 6 位）').fill('test-password')
                page.get_by_role('button', name='登录', exact=True).last.click()
                page.wait_for_url(base + '/')
                page.goto(base + '/ai-tool/novel')
                page.wait_for_load_state('networkidle')
                expect(page.get_by_label('镜头 1 画面描述', exact=True)).to_have_value('red scene')
                expect(page.get_by_label('镜头 1 预览', exact=True)).to_have_attribute('src', '/exports/red.mp4')
                page.get_by_label('下移镜头 1', exact=True).click()
                expect(page.get_by_label('镜头 1 画面描述', exact=True)).to_have_value('blue scene')
                expect(page.get_by_label('镜头 1 预览', exact=True)).to_have_attribute('src', '/exports/blue.mp4')
                page.get_by_label('镜头 1 字幕', exact=True).fill('蓝色镜头字幕')
                page.get_by_label('镜头 1 剪辑起点', exact=True).fill('0.5')
                audio = io.BytesIO()
                with wave.open(audio, 'wb') as wav:
                    wav.setnchannels(1); wav.setsampwidth(2); wav.setframerate(8000)
                    wav.writeframes(b'\x00\x00' * 8000)
                page.get_by_label('上传配乐', exact=True).set_input_files({
                    'name': 'test-music.wav', 'mimeType': 'audio/wav', 'buffer': audio.getvalue()})
                expect(page.get_by_text('test-music.wav', exact=True)).to_be_visible()
                page.get_by_label('配乐音量', exact=True).fill('0.35')
                page.get_by_role('button', name='保存项目', exact=True).click()
                expect(page.get_by_role('status').filter(has_text='已保存')).to_be_visible()
                page.reload()
                expect(page.get_by_label('镜头 1 画面描述', exact=True)).to_have_value('blue scene')
                expect(page.get_by_label('镜头 1 字幕', exact=True)).to_have_value('蓝色镜头字幕')
                expect(page.get_by_label('镜头 1 剪辑起点', exact=True)).to_have_value('0.5')
                expect(page.get_by_label('配乐音量', exact=True)).to_have_value('0.35')
                with page.expect_response('**/lv/v1/short_drama/compose', timeout=60000) as composed:
                    page.get_by_role('button', name='合成完整成片', exact=True).click()
                result = composed.value.json()
                assert composed.value.ok, result
                assert result['has_bgm'] and result['subtitles'] and result['clips'] == 2, result
                request = composed.value.request.post_data_json
                assert request['task_ids'] == ['blue', 'red']
                assert request['clips'][0] == {'start': 0.5, 'duration': 1}
                final = page.locator('video').last
                expect(final).to_have_attribute('src', result['url'])
                final.evaluate('(v) => new Promise((resolve, reject) => { if(v.readyState >= 1) resolve(); else {v.onloadedmetadata=resolve; v.onerror=reject} })')
                assert 1.8 <= final.evaluate('(v) => v.duration') <= 2.3
                page.screenshot(path=str(OUT / 'drama-desktop.png'), full_page=True)
                print('PASS reorder + result binding, subtitle/trim/BGM persistence, actual FFmpeg compose and playback', flush=True)

                page.get_by_label('镜头 1 画面描述', exact=True).fill('Edited blue scene')
                expect(page.get_by_label('镜头 1 预览', exact=True)).to_have_count(0)
                expect(page.get_by_label('镜头 2 预览', exact=True)).to_have_attribute('src', '/exports/red.mp4')
                expect(page.get_by_role('button', name='合成完整成片', exact=True)).to_have_count(0)
                first = page.get_by_role('region', name='镜头 1', exact=True)
                with page.expect_response('**/lv/v1/short_drama/render_all') as submitted:
                    first.get_by_role('button', name='生成镜头', exact=True).click()
                assert len(submitted.value.request.post_data_json['shots']) == 1
                expect(page.get_by_label('镜头 1 预览', exact=True)).to_be_visible(timeout=15000)
                page.get_by_role('button', name='添加镜头', exact=True).click()
                expect(page.get_by_label('镜头 3 画面描述', exact=True)).to_be_visible()
                page.get_by_label('镜头 3 画面描述', exact=True).fill('new shot')
                page.get_by_label('镜头 3 运镜', exact=True).fill('slow pan')
                page.get_by_label('镜头 3 时长', exact=True).fill('3')
                page.get_by_label('删除镜头 3', exact=True).click()
                expect(page.get_by_label('镜头 3 画面描述', exact=True)).to_have_count(0)
                print('PASS edited prompt invalidates only its result; single-shot submit, add/remove/camera/duration', flush=True)

                page.goto(base + '/ai-tool/asset')
                page.get_by_role('button', name='音频', exact=True).click()
                expect(page.get_by_label('素材音频')).to_have_count(1)
                page.goto(base + '/ai-tool/tools')
                page.get_by_role('button', name='图像放大', exact=False).click()
                expect(page.get_by_label('放大模型', exact=True)).to_be_enabled()
                image = io.BytesIO()
                Image.new('RGB', (64, 48), 'green').save(image, 'PNG')
                page.get_by_label('上传待处理图片').set_input_files({'name': 'input.png', 'mimeType': 'image/png', 'buffer': image.getvalue()})
                page.get_by_label('目标长边', exact=True).select_option('1024')
                page.get_by_label('放大模型', exact=True).select_option('offline-x2.pth')
                with page.expect_response('**/lv/v1/editor/image/super_resolution') as processed:
                    page.get_by_role('button', name='开始处理', exact=True).click()
                assert processed.value.json()['engine'] == 'comfyui-upscale'
                expect(page.locator('figcaption')).to_contain_text('offline-x2.pth')
                page.get_by_label('放大方式').select_option('lanczos')
                with page.expect_response('**/lv/v1/editor/image/super_resolution') as processed:
                    page.get_by_role('button', name='开始处理', exact=True).click()
                assert processed.value.json()['engine'] == 'lanczos'
                expect(page.locator('figcaption')).to_contain_text('Lanczos')
                print('PASS audio asset preview, model selection, simulated AI response and explicit Lanczos result', flush=True)
                for route in ('novel', 'tools'):
                    for width in (390, 1440):
                        page.set_viewport_size({'width': width, 'height': 844})
                        page.goto(base + '/ai-tool/' + route)
                        page.wait_for_load_state('networkidle')
                        if route == 'tools':
                            page.get_by_role('button', name='图像放大', exact=False).click()
                            expect(page.get_by_role('button', name='图像放大', exact=False)).to_have_attribute('aria-pressed', 'true')
                            page.wait_for_timeout(250)
                        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth + 1'), (route, width)
                        page.screenshot(path=str(OUT / f'{route}-{width}.png'), full_page=True)
                assert not errors, errors
                browser.close()
                print('PASS mobile/desktop layout and no JS errors', flush=True)
        finally:
            server.terminate()
            server.wait(timeout=20)
