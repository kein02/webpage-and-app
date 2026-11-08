import time
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent / 'output'
ROOT.mkdir(parents=True, exist_ok=True)
PUBLIC = 'http://127.0.0.1:8103'
LOCAL = 'http://127.0.0.1:8102'

with sync_playwright() as pw:
    browser = pw.chromium.launch(headless=True)
    page = browser.new_page(viewport={'width': 1440, 'height': 1000})
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.goto(LOCAL + '/ai-tool/engine')
    page.wait_for_load_state('networkidle')
    page.get_by_role('status').get_by_text('本机调试：可使用此电脑上的默认 ComfyUI 和 API。', exact=True).wait_for()
    local = page.request.get(LOCAL + '/api/runtime').json()
    assert local == {'mode': 'local', 'default_engines': True, 'local_comfy_proxy': True}
    assert page.request.get(LOCAL + '/lv/v1/generate/model_config').json()['engine'] != 'none'
    print('PASS local UI and automatic default engine', flush=True)

    page.goto(PUBLIC + '/ai-tool/engine')
    page.wait_for_load_state('networkidle')
    page.get_by_role('status').get_by_text('公开分享：使用你自己的引擎，站点不提供默认算力。', exact=True).wait_for()
    assert not page.get_by_text('本机调试默认引擎', exact=True).count()
    public = page.request.get(PUBLIC + '/api/runtime').json()
    assert public == {'mode': 'public', 'default_engines': False, 'local_comfy_proxy': False}
    assert page.request.get(PUBLIC + '/lv/v1/generate/model_config').json()['engine'] == 'none'
    assert page.request.get(PUBLIC + '/api/comfy/system_stats', headers={'X-Comfy-Base': 'http://127.0.0.1:8188'}).status == 403
    page.get_by_role('button', name='测试连接', exact=True).click()
    page.get_by_text('公开分享模式：请配置你自己的 ComfyUI 或 API Key。', exact=True).wait_for()
    page.screenshot(path=str(ROOT / 'public-engine-desktop.png'))
    print('PASS public UI has no default engines and no local proxy', flush=True)

    page.goto(PUBLIC + '/login')
    page.get_by_role('button', name='注册', exact=True).click()
    page.get_by_placeholder('用户名', exact=True).fill('mode-' + str(int(time.time())))
    page.get_by_placeholder('密码（至少 6 位）', exact=True).fill('test-password')
    page.get_by_role('button', name='注册并登录', exact=True).click()
    page.wait_for_url(PUBLIC + '/')
    page.goto(PUBLIC + '/ai-tool/ai-image')
    page.wait_for_load_state('networkidle')
    page.get_by_label('画面描述', exact=True).fill('No owner engine may be used')
    page.get_by_role('button', name='立即生成', exact=True).click()
    page.get_by_role('alert').get_by_text('生成失败：未配置出图引擎：请到「引擎设置」接入自己的 ComfyUI 地址或 API key', exact=True).wait_for()
    page.goto(PUBLIC + '/ai-tool/ai-video')
    page.get_by_label('视频描述', exact=True).fill('No owner key may be used')
    page.get_by_role('button', name='生成视频', exact=True).click()
    page.get_by_role('alert').get_by_text('提交失败：未配置视频平台：请在「引擎设置」里选择平台并填写 API key', exact=True).wait_for()
    token = page.evaluate("localStorage.getItem('dc_token')")
    tasks = page.request.post(PUBLIC + '/lv/v2/task/multi_get_tasks', headers={'Authorization': 'Bearer ' + token}, data={'task_ids': []}).json()
    assert tasks['tasks'] == []
    page.set_viewport_size({'width': 390, 'height': 844})
    page.goto(PUBLIC + '/ai-tool/engine')
    page.wait_for_load_state('networkidle')
    assert page.evaluate('document.documentElement.scrollWidth <= innerWidth + 1')
    page.screenshot(path=str(ROOT / 'public-engine-mobile.png'), full_page=True)
    assert not errors, errors
    print('PASS public registration, no-key image/video rejection, no owner task creation, mobile layout', flush=True)
    browser.close()
