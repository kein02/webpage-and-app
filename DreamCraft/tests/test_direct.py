import io
import pathlib
import os
from PIL import Image, ImageChops
from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parent / 'output'
ROOT.mkdir(parents=True, exist_ok=True)
BASE = os.environ.get('DREAMCRAFT_TEST_BASE', 'http://127.0.0.1:8102')
buf = io.BytesIO()
Image.new('RGB', (256, 256), '#ca6950').save(buf, format='PNG')
with sync_playwright() as pw:
    browser = pw.chromium.launch(headless=True)
    page = browser.new_page(viewport={'width': 1440, 'height': 1000})
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.goto(BASE + '/ai-tool/engine')
    page.wait_for_load_state('networkidle')
    page.evaluate("localStorage.setItem('dc_engine_local:anon', JSON.stringify({comfyui_url:'http://127.0.0.1:8188',default_engine:'sdxl-draft'}))")
    page.reload()
    page.get_by_role('button', name='测试连接', exact=True).click()
    page.get_by_text('ComfyUI 可达', exact=False).wait_for()
    page.goto(BASE + '/ai-tool/ai-image')
    page.wait_for_load_state('networkidle')
    page.get_by_role('button', name='图生图', exact=True).click()
    page.get_by_label('上传参考图片', exact=True).set_input_files({'name': 'reference.png', 'mimeType': 'image/png', 'buffer': buf.getvalue()})
    page.get_by_label('画面描述', exact=True).fill('an orange ceramic vase, white table, studio photo')
    page.get_by_role('button', name='1 张', exact=True).click()
    page.get_by_role('button', name='立即生成', exact=True).click()
    image = page.locator('.generator-preview figure img')
    image.wait_for(timeout=180000)
    image.evaluate('(img) => img.decode()')
    assert image.evaluate('(img) => img.naturalWidth') == 256
    assert page.get_by_text('comfyui:http://127.0.0.1:8188', exact=True).count()
    with page.expect_download() as download:
        page.get_by_role('link', name='下载图片', exact=True).click()
    assert Image.open(download.value.path()).size == (256, 256)
    page.goto(BASE + '/ai-tool/asset')
    page.wait_for_load_state('networkidle')
    image = page.locator('.asset-grid img').first
    image.wait_for()
    image.evaluate('(img) => img.decode()')
    assert image.evaluate('(img) => img.naturalWidth') == 256
    print('PASS browser direct ComfyUI connection, reference upload, image-to-image and asset persistence', flush=True)

    page.goto(BASE + '/ai-tool/home')
    page.wait_for_load_state('networkidle')
    page.get_by_label('场景画质', exact=True).select_option('low')
    canvas = page.locator('.scene-stage canvas')
    canvas.wait_for(timeout=30000)
    page.wait_for_timeout(2500)
    a = canvas.screenshot()
    page.wait_for_timeout(500)
    b = canvas.screenshot()
    image = Image.open(io.BytesIO(b)).convert('RGB')
    assert max(hi - lo for lo, hi in image.getextrema()) > 40
    assert ImageChops.difference(Image.open(io.BytesIO(a)).convert('RGB'), image).getbbox()
    page.get_by_role('button', name='暂停场景动效', exact=True).click()
    page.wait_for_timeout(2000)
    a = canvas.screenshot()
    page.wait_for_timeout(500)
    b = canvas.screenshot()
    assert not ImageChops.difference(Image.open(io.BytesIO(a)), Image.open(io.BytesIO(b))).getbbox()
    page.screenshot(path=str(ROOT / 'home-3d-current.png'))
    print('PASS current 3D scene nonblank, animated, and pause freezes pixels', flush=True)
    assert not errors, errors
    browser.close()
