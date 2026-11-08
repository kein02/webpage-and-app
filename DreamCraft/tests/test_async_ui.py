import json
import pathlib
from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parent / 'output'
ROOT.mkdir(parents=True, exist_ok=True)
BASE = 'http://127.0.0.1:8101'
with sync_playwright() as pw:
    browser = pw.chromium.launch(headless=True)
    page = browser.new_page(viewport={'width': 1440, 'height': 1000})
    page.goto(BASE + '/ai-tool/ai-video')
    page.wait_for_load_state('networkidle')
    task = {'id': 'mock-video', 'kind': 'video', 'payload': {'prompt': 'Polling audit'}, 'status': 'running'}
    requests = []
    def respond(route):
        requests.append(1)
        route.fulfill(json={'tasks': [task]})
    page.route('**/lv/v2/task/multi_get_tasks', respond)
    page.reload()
    page.get_by_text('Polling audit', exact=True).wait_for()
    assert page.get_by_text('生成中…', exact=True).count()
    page.clock.install()
    task.update(status='failed', error='Expected simulated failure')
    page.clock.run_for(11000)
    page.get_by_text('Expected simulated failure', exact=True).wait_for()
    page.get_by_role('button', name='隐藏任务', exact=True).click()
    page.clock.run_for(11000)
    assert not page.get_by_text('Polling audit', exact=True).count()
    print('PASS video polling reaches terminal errors and hidden tasks stay hidden', flush=True)
    task.update(status='running')
    page.goto(BASE + '/ai-tool/task-center')
    page.get_by_text('生成中', exact=True).wait_for()
    task.update(status='failed', error='Task polling failure')
    page.clock.run_for(21000)
    page.get_by_text('失败', exact=True).wait_for()
    assert len(requests) >= 3
    print('PASS task center continues polling beyond its first refresh', flush=True)

    page.unroute('**/lv/v2/task/multi_get_tasks')
    page.goto(BASE + '/ai-tool/novel')
    page.get_by_placeholder('输入短剧主题，例如：深夜便利店里的重逢').fill('Persistent story')
    page.get_by_role('button', name='生成剧本', exact=True).click()
    page.get_by_role('heading', name='分镜脚本（6 镜头）').wait_for()
    page.goto(BASE + '/ai-tool/asset')
    page.goto(BASE + '/ai-tool/novel')
    page.get_by_role('heading', name='分镜脚本（6 镜头）').wait_for()
    assert page.get_by_placeholder('输入短剧主题，例如：深夜便利店里的重逢').input_value() == 'Persistent story'
    print('PASS story survives navigation', flush=True)
    browser.close()
