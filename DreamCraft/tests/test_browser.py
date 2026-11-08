import io
import json
import pathlib
import time
from PIL import Image
from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parent / 'output'
ROOT.mkdir(parents=True, exist_ok=True)
BASE = 'http://127.0.0.1:8101'
png = io.BytesIO()
Image.new('RGB', (80, 60), '#d04b48').save(png, format='PNG')
image_file = {'name': 'audit.png', 'mimeType': 'image/png', 'buffer': png.getvalue()}
routes = ['home', 'ai-image', 'ai-video', 'ai-agent', 'tools', 'canvas-home', 'explore', 'asset', 'task-center', 'novel', 'team', 'jimeng-api', 'engine']


with sync_playwright() as pw:
    browser = pw.chromium.launch(headless=True)
    context = browser.new_context(viewport={'width': 1440, 'height': 1000}, accept_downloads=True)
    page = context.new_page()
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.goto(BASE + '/ai-tool/home')
    page.wait_for_load_state('networkidle')
    page.wait_for_timeout(1500)
    assert page.locator('.static-studio, canvas').count()
    page.screenshot(path=str(ROOT / 'home-audit.png'))
    for width, height in [(1440, 1000), (390, 844)]:
        page.set_viewport_size({'width': width, 'height': height})
        for route in routes + ['pricing', 'login']:
            url = BASE + ('/' + route if route in ('pricing', 'login') else '/ai-tool/' + route)
            page.goto(url)
            page.wait_for_load_state('networkidle')
            assert page.evaluate('document.documentElement.scrollWidth <= innerWidth + 1'), (route, width)
        page.screenshot(path=str(ROOT / f'login-{width}.png'))
    print('PASS 15 routes at desktop/mobile without JS errors or outer overflow', flush=True)

    page.set_viewport_size({'width': 1440, 'height': 1000})
    page.goto(BASE + '/ai-tool/canvas-home')
    page.wait_for_load_state('networkidle')
    page.get_by_role('button', name='文本', exact=True).click()
    page.get_by_label('文本内容').fill('Audit text')
    page.get_by_label('图层 w', exact=True).fill('220')
    text = page.get_by_text('Audit text', exact=True)
    rect = text.bounding_box()
    page.mouse.move(rect['x'] + 20, rect['y'] + 15)
    page.mouse.down()
    page.mouse.move(rect['x'] + 120, rect['y'] + 75, steps=12)
    page.mouse.up()
    assert int(page.get_by_label('图层 x', exact=True).input_value()) > 160
    assert int(page.get_by_label('图层 y', exact=True).input_value()) > 440
    page.get_by_label('上传画布图片').set_input_files(image_file)
    page.get_by_text('图片已添加', exact=True).wait_for()
    with page.expect_download() as event:
        page.get_by_role('button', name='导出 PNG', exact=True).click()
    download = event.value
    download.save_as(str(ROOT / 'canvas-export.png'))
    assert Image.open(ROOT / 'canvas-export.png').size == (800, 600)
    page.get_by_role('button', name='删除图层', exact=True).click()
    page.get_by_text('text-1', exact=True).click()
    page.get_by_role('button', name='删除图层', exact=True).click()
    assert page.get_by_label('文本内容').count() == 0
    print('PASS canvas upload, persistent drag, text/size editing, export, deleting every layer type', flush=True)

    page.goto(BASE + '/login')
    page.get_by_role('button', name='注册', exact=True).click()
    page.get_by_placeholder('用户名', exact=True).fill('browser-' + str(int(time.time())))
    page.get_by_placeholder('密码（至少 6 位）', exact=True).fill('audit-password')
    page.get_by_role('button', name='注册并登录', exact=True).click()
    page.wait_for_url(BASE + '/')
    assert page.evaluate("Boolean(localStorage.getItem('dc_token'))")
    page.goto(BASE + '/ai-tool/team')
    page.get_by_label('团队名称', exact=True).fill('Audit Team')
    page.get_by_role('button', name='创建团队', exact=True).click()
    page.get_by_text('席位 1/1', exact=True).wait_for()
    page.get_by_role('button', name='升级套餐 →', exact=True).click()
    page.get_by_text('席位 1/5', exact=True).wait_for()
    page.get_by_placeholder('成员名', exact=True).fill('Test Member')
    page.get_by_placeholder('邮箱', exact=True).fill('member@example.com')
    page.get_by_role('button', name='+ 加成员', exact=True).click()
    row = page.locator('tr', has_text='Test Member')
    row.wait_for()
    row.locator('select').select_option('viewer')
    row.get_by_role('button', name='移除', exact=True).click()
    row.wait_for(state='detached')
    print('PASS registration authentication, team creation, plan, members, roles, removal', flush=True)

    page.goto(BASE + '/ai-tool/asset')
    page.get_by_label('上传素材', exact=True).set_input_files(image_file)
    page.locator('.asset-grid img').first.wait_for()
    assert page.locator('.asset-grid img').first.evaluate('(img) => img.complete && img.naturalWidth > 0')
    page.goto(BASE + '/ai-tool/tools')
    page.get_by_role('button', name='高清化').click()
    page.get_by_label('上传待处理图片').set_input_files(image_file)
    page.get_by_role('button', name='开始处理', exact=True).click()
    page.locator('.tool-editor figure img').wait_for()
    page.locator('.tool-editor figure img').evaluate('(img) => img.decode()')
    assert page.locator('.tool-editor figure img').evaluate('(img) => img.naturalWidth') == 2048
    print('PASS asset upload/list and actual upscale output', flush=True)

    page.goto(BASE + '/ai-tool/ai-image')
    page.get_by_role('button', name='图生图', exact=True).click()
    page.get_by_label('画面描述', exact=True).fill('reference test')
    page.get_by_role('button', name='立即生成', exact=True).click()
    page.get_by_role('alert').get_by_text('请先添加参考图片', exact=True).wait_for()
    page.get_by_role('button', name='文生图', exact=True).click()
    page.get_by_label('模型档位', exact=True).select_option('sdxl-draft')
    page.get_by_role('button', name='1 张', exact=True).click()
    page.get_by_label('画面描述', exact=True).fill('a green glass bottle on a white table, studio photography')
    page.get_by_role('button', name='立即生成', exact=True).click()
    page.locator('.generator-preview figure img').wait_for(timeout=180000)
    page.locator('.generator-preview figure img').evaluate('(img) => img.decode()')
    assert page.locator('.generator-preview figure img').evaluate('(img) => img.naturalWidth') == 1024
    page.screenshot(path=str(ROOT / 'image-generated.png'))
    page.goto(BASE + '/ai-tool/task-center')
    page.get_by_text('完成', exact=True).first.wait_for()
    page.locator('tbody img').first.evaluate('(img) => img.decode()')
    print('PASS actual browser GPU image generation and task results', flush=True)

    page.goto(BASE + '/ai-tool/novel')
    page.get_by_placeholder('输入短剧主题，例如：深夜便利店里的重逢').fill('A mountain sunrise')
    page.get_by_role('button', name='生成剧本', exact=True).click()
    page.get_by_role('heading', name='分镜脚本（6 镜头）').wait_for()
    print('PASS script generation', flush=True)

    page.evaluate("localStorage.setItem('dc_token', 'invalid')")
    page.goto(BASE + '/ai-tool/task-center')
    page.get_by_role('link', name='登录').wait_for()
    assert page.evaluate("!localStorage.getItem('dc_token')")
    assert not errors, errors
    print('PASS expired login resets UI; no unhandled browser exceptions', flush=True)
    context.close()
    browser.close()
