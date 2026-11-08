"""Real browser workflow against an isolated backend with simulated providers."""
import asyncio
import base64
import io
import os
import socket
import sys
import tempfile
import threading
import time
from pathlib import Path
from unittest.mock import patch

from PIL import Image
from playwright.sync_api import sync_playwright
import uvicorn

data = tempfile.TemporaryDirectory(prefix='dreamcraft-release-ui-', ignore_cleanup_errors=True)
(Path(__file__).resolve().parent / 'output').mkdir(exist_ok=True)
os.environ.update(DREAMCRAFT_MODE='public', DATA_DIR=data.name, NO_LOCAL_ENV='1')
sys.path.insert(0, str(__import__('pathlib').Path(__file__).resolve().parents[1] / 'app' / 'backend'))
import main
import providers

buf = io.BytesIO()
Image.new('RGB', (128, 96), '#21a798').save(buf, 'PNG')
image_bytes = buf.getvalue()
image_data = 'data:' + 'image/png;base64,' + base64.b64encode(image_bytes).decode()


class SimulatedProvider(providers.AgnesProvider):
    async def generate_image(self, **kwargs):
        if kwargs['prompt'] == 'simulate failure':
            raise RuntimeError('upstream unavailable')
        return {'results': [{'url': image_data, 'model': 'test'}]}


original = main._provider_for


def provider_for(uid):
    if main.userconfig.get(uid).get('agnes_key'):
        return SimulatedProvider()
    return original(uid)


with socket.socket() as sock:
    sock.bind(('127.0.0.1', 0))
    port = sock.getsockname()[1]
url = f'http://127.0.0.1:{port}'
server = uvicorn.Server(uvicorn.Config(main.app, host='127.0.0.1', port=port, log_level='warning'))
thread = threading.Thread(target=server.run, daemon=True)

try:
    with patch.object(main, '_provider_for', side_effect=provider_for), sync_playwright() as pw:
        thread.start()
        for _ in range(100):
            if server.started:
                break
            time.sleep(.05)
        browser = pw.chromium.launch(headless=True)
        context = browser.new_context(accept_downloads=True, viewport={'width': 1440, 'height': 1000})
        page = context.new_page()
        errors = []
        page.on('pageerror', lambda error: errors.append(str(error)))
        import json
        page.route('https://browser-engine.example/**', lambda route: route.fulfill(
            status=200, content_type='application/json', body=json.dumps({'data': [{'url': image_data}]})))
        page.goto(url + '/login')
        page.wait_for_load_state('networkidle')
        page.get_by_role('button', name='注册', exact=True).click()
        page.get_by_placeholder('用户名', exact=True).fill('browser-owner')
        page.get_by_placeholder('密码（至少 6 位）').fill('test-password')
        page.get_by_role('button', name='注册并登录').click()
        page.wait_for_url(url + '/')
        page.goto(url + '/ai-tool/engine')
        page.wait_for_load_state('networkidle')
        page.locator('input[type=password]').first.fill('fake-browser-key')
        page.locator('input[placeholder="https://api.agnes-ai.cn"]').fill('https://browser-engine.example')
        page.get_by_role('button', name='测试连接', exact=True).click()
        page.get_by_text('Agnes key 有效', exact=False).wait_for()
        page.get_by_role('button', name='保存', exact=True).click()
        page.goto(url + '/ai-tool/ai-image')
        page.wait_for_load_state('networkidle')
        page.get_by_label('画面描述', exact=True).fill('browser direct generation')
        page.get_by_role('button', name='1 张', exact=True).click()
        page.get_by_role('button', name='立即生成').click()
        page.get_by_alt_text('result', exact=True).wait_for()
        page.goto(url + '/ai-tool/task-center')
        page.get_by_text('browser direct generation', exact=True).wait_for()
        page.goto(url + '/ai-tool/engine')
        page.wait_for_load_state('networkidle')
        token = page.evaluate("localStorage.getItem('dc_token')")
        headers = {'Authorization': 'Bearer ' + token}
        response = page.request.post(url + '/api/biz/v1/engine/config', headers=headers,
            data={'agnes_key': 'fake-server-key'})
        assert response.status == 200
        page.get_by_role('button', name='清除', exact=True).click()
        page.goto(url + '/ai-tool/ai-image')
        page.wait_for_load_state('networkidle')
        page.get_by_label('画面描述', exact=True).fill('browser successful generation')
        page.get_by_role('button', name='立即生成').click()
        page.get_by_alt_text('result', exact=True).wait_for()
        with page.expect_download() as download:
            page.get_by_role('link', name='下载图片').click()
        assert Path(download.value.path()).read_bytes() == image_bytes
        page.get_by_label('画面描述', exact=True).fill('simulate failure')
        page.get_by_role('button', name='立即生成').click()
        page.get_by_role('alert').get_by_text('生成失败：图片生成失败：upstream unavailable', exact=True).wait_for()
        assert page.get_by_role('button', name='立即生成').is_enabled()
        page.goto(url + '/ai-tool/task-center')
        page.get_by_text('browser successful generation', exact=True).wait_for()
        page.reload()
        page.get_by_text('browser successful generation', exact=True).wait_for()
        page.get_by_text('完成', exact=True).first.wait_for()
        page.goto(url + '/ai-tool/asset')
        page.locator('figure img').first.wait_for()
        page.locator('figure img').first.evaluate('(img) => img.decode()')
        assert page.locator('figure img').first.evaluate('(img) => img.complete && img.naturalWidth > 0')
        page.get_by_label('上传素材').set_input_files({'name': 'private.png', 'mimeType': 'image/png', 'buffer': image_bytes})
        page.wait_for_timeout(300)
        page.reload()
        page.locator('figure img').first.wait_for()
        page.locator('figure img').first.evaluate('(img) => img.decode()')
        assert page.locator('figure img').count() >= 2
        assert page.locator('figure img').first.evaluate('(img) => img.complete && img.naturalWidth > 0')
        assets = page.request.get(url + '/api/biz/v1/asset/list', headers=headers).json()['assets']
        media = next(asset['url'] for asset in assets if asset['url'].startswith('/uploads/'))
        assert page.request.get(url + media).status == 200
        page.screenshot(path=str(Path(__file__).resolve().parent / 'output' / 'release-assets.png'))
        print('PASS browser registration, key test/save, backend generation, download, task refresh, upload and private previews', flush=True)

        page.goto(url + '/ai-tool/canvas-home')
        page.get_by_label('上传画布图片').set_input_files({'name': 'canvas.png', 'mimeType': 'image/png', 'buffer': image_bytes})
        page.get_by_text('图片已添加', exact=True).wait_for()
        page.get_by_role('button', name='文本', exact=True).click()
        page.get_by_label('文本内容', exact=True).fill('Canvas regression')
        page.get_by_role('button', name='形状', exact=True).click()
        page.get_by_label('图层 w', exact=True).fill('150')
        with page.expect_download() as exported:
            page.get_by_role('button', name='导出 PNG', exact=True).click()
        assert Image.open(exported.value.path()).size == (800, 600)
        page.get_by_role('button', name='删除图层', exact=True).click()
        page.get_by_text('rect-3', exact=True).wait_for(state='detached')

        page.goto(url + '/ai-tool/team')
        page.get_by_role('textbox', name='团队名称', exact=True).fill('Regression team')
        page.get_by_role('button', name='创建团队', exact=True).click()
        page.get_by_text('席位 1/1', exact=True).wait_for()
        page.get_by_role('button', name='升级套餐', exact=False).click()
        page.get_by_text('席位 1/5', exact=True).wait_for()
        page.get_by_placeholder('成员名', exact=True).fill('Editor')
        page.get_by_placeholder('邮箱', exact=True).fill('editor@example.com')
        page.get_by_role('button', name='+ 加成员', exact=True).click()
        member = page.get_by_role('row').filter(has=page.get_by_text('Editor', exact=True))
        member.get_by_role('combobox').select_option('viewer')
        page.get_by_text('席位 2/5', exact=True).wait_for()
        member.get_by_role('button', name='移除', exact=True).click()
        page.get_by_text('席位 1/5', exact=True).wait_for()

        page.goto(url + '/ai-tool/novel')
        page.get_by_placeholder('输入短剧主题，例如：深夜便利店里的重逢').fill('Regression story')
        page.get_by_role('button', name='生成剧本', exact=True).click()
        page.get_by_role('heading', name='分镜脚本（6 镜头）', exact=True).wait_for()
        page.route('**/lv/v1/short_drama/render_all', lambda route: route.fulfill(json={'task_ids': ['audit-shot']}))
        page.route('**/lv/v2/task/multi_get_tasks', lambda route: route.fulfill(json={'tasks': [{'id': 'audit-shot', 'status': 'running'}]}))
        page.get_by_role('button', name='全部提交渲染', exact=True).click()
        assert page.get_by_role('button', name='重新提交全部', exact=True).is_disabled()
        page.goto(url + '/ai-tool/asset')
        page.goto(url + '/ai-tool/novel')
        page.get_by_role('heading', name='分镜脚本（6 镜头）', exact=True).wait_for()
        assert page.get_by_placeholder('输入短剧主题，例如：深夜便利店里的重逢').input_value() == 'Regression story'
        page.unroute('**/lv/v1/short_drama/render_all')
        page.unroute('**/lv/v2/task/multi_get_tasks')
        print('PASS canvas upload/text/shape/export, team create/plan/member/role/removal, persistent drama and duplicate-submit guard', flush=True)

        page.goto(url + '/ai-tool/engine')
        page.locator('input[type=password]').first.fill('account-a-private-key')
        page.get_by_role('button', name='保存', exact=True).click()
        page.get_by_role('button', name='退出登录', exact=True).click()
        page.wait_for_timeout(300)
        assert page.request.get(url + media).status == 401
        page.goto(url + '/login')
        page.get_by_role('button', name='注册', exact=True).click()
        page.get_by_placeholder('用户名', exact=True).fill('browser-other')
        page.get_by_placeholder('密码（至少 6 位）').fill('test-password')
        page.get_by_role('button', name='注册并登录').click()
        page.wait_for_url(url + '/')
        page.goto(url + '/ai-tool/engine')
        page.wait_for_load_state('networkidle')
        assert page.locator('input[type=password]').first.input_value() == ''
        assert page.request.get(url + media).status == 404
        page.goto(url + '/ai-tool/task-center')
        page.get_by_text('还没有创作任务', exact=True).wait_for()
        page.goto(url + '/ai-tool/asset')
        page.get_by_text('还没有素材', exact=True).wait_for()
        page.set_viewport_size({'width': 390, 'height': 844})
        page.goto(url + '/ai-tool/engine')
        page.wait_for_load_state('networkidle')
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth + 1')
        page.screenshot(path=str(Path(__file__).resolve().parent / 'output' / 'release-mobile.png'), full_page=True)
        assert not errors, errors
        print('PASS logout closes private media, second account has no inherited engine/tasks/assets, mobile layout and JS errors', flush=True)

        routes = ['home', 'ai-image', 'ai-video', 'ai-agent', 'tools', 'canvas-home', 'explore', 'asset', 'task-center', 'novel', 'team', 'jimeng-api', 'engine']
        for width, height in ((1440, 1000), (390, 844)):
            page.set_viewport_size({'width': width, 'height': height})
            for route in routes + ['pricing', 'login']:
                page.goto(url + ('/' + route if route in ('pricing', 'login') else '/ai-tool/' + route))
                page.wait_for_load_state('networkidle')
                assert page.evaluate('document.documentElement.scrollWidth <= innerWidth + 1'), (route, width)
        page.goto(url + '/pricing')
        for name in ('Pro', '企业', '免费'):
            radio = page.get_by_role('radio', name=name + '套餐', exact=True)
            radio.check()
            assert radio.is_checked()
            assert page.locator('.pricing-plan.is-selected').count() == 1
        assert not errors, errors
        print('PASS all 15 routes on desktop/mobile without overflow or JS exceptions, and all pricing selections', flush=True)

        source = (Path(__file__).resolve().parents[1] / 'app' / 'frontend' / 'src' / 'api.js').read_text(encoding='utf-8')
        source = source.replace(r"const BASE = (import.meta.env?.VITE_API_BASE || '').replace(/\/$/, '')", "const BASE = ''")
        import base64
        module_url = 'data:text/javascript;base64,' + base64.b64encode(source.encode()).decode()
        stale = page.evaluate('''async moduleUrl => {
          const client = await import(moduleUrl)
          const current = client.getToken()
          const originalFetch = window.fetch
          let complete
          window.fetch = () => new Promise(resolve => { complete = resolve })
          const pending = client.api.balance().catch(error => error.message)
          localStorage.setItem('dc_token', 'new-account-token')
          complete(new Response(JSON.stringify({detail: 'expired'}), {status: 401}))
          const message = await pending
          const preserved = client.getToken() === 'new-account-token'
          window.fetch = originalFetch
          localStorage.setItem('dc_token', current)
          return {message, preserved}
        }''', module_url)
        assert stale['preserved'] and '账号已切换' in stale['message'], stale
        page.evaluate('''async moduleUrl => {
          const client = await import(moduleUrl)
          const originalFetch = window.fetch
          let complete
          window.fetch = () => new Promise(resolve => { complete = resolve })
          const pending = client.api.me().catch(error => error.message)
          const current = client.getToken()
          localStorage.setItem('dc_token', 'another-token')
          complete(new Response(JSON.stringify({media_token: 'old-account-media'}), {status: 200}))
          await pending
          if (sessionStorage.getItem('dc_media_token') === 'old-account-media') throw new Error('Stale media token accepted')
          window.fetch = originalFetch
          localStorage.setItem('dc_token', current)
        }''', module_url)
        print('PASS delayed responses cannot log out a new account or replace its media token', flush=True)
        browser.close()
finally:
    server.should_exit = True
    if thread.ident:
        thread.join(timeout=10)
    for module in (main.auth, main.wallet, main.team, main.userconfig, sys.modules['taskstore']):
        conn = getattr(module._local, 'conn', None)
        if conn:
            conn.close()
    data.cleanup()
