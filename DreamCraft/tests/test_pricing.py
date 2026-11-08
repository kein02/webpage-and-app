from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent / 'output'
ROOT.mkdir(parents=True, exist_ok=True)
with sync_playwright() as pw:
    browser = pw.chromium.launch(headless=True)
    page = browser.new_page(viewport={'width': 1440, 'height': 1000})
    mutations = []
    page.on('request', lambda request: mutations.append(request.url) if request.method == 'POST' and '/commerce/' in request.url else None)
    page.route('**/lv/v1/commerce/balance', lambda route: route.fulfill(json={
        'balance': 100, 'subscription': {'plan': 'free'}, 'demo_commerce': False, 'ledger': []}))
    page.goto('http://127.0.0.1:8102/pricing')
    page.wait_for_load_state('networkidle')
    assert page.get_by_role('radio', name='免费套餐', exact=True).is_checked()
    for name in ['Pro', '企业', '免费']:
        card = page.locator('.pricing-plan').filter(has=page.get_by_role('radio', name=name + '套餐', exact=True))
        card.locator('.pricing-plan-choice').click()
        assert page.get_by_role('radio', name=name + '套餐', exact=True).is_checked()
        assert page.locator('.pricing-plan.is-selected').count() == 1
        assert page.get_by_role('status').inner_text().startswith('免费是当前' if name == '免费' else '已选择' + name)
    page.get_by_role('radio', name='免费套餐', exact=True).focus()
    page.keyboard.press('ArrowRight')
    assert page.get_by_role('radio', name='Pro套餐', exact=True).is_checked()
    assert not mutations
    page.screenshot(path=str(ROOT / 'pricing-selection-desktop.png'))
    page.set_viewport_size({'width': 390, 'height': 844})
    page.get_by_role('radio', name='企业套餐', exact=True).check()
    assert page.evaluate('document.documentElement.scrollWidth <= innerWidth + 1')
    page.screenshot(path=str(ROOT / 'pricing-selection-mobile.png'), full_page=True)

    page.route('**/lv/v1/commerce/balance', lambda route: route.fulfill(json={
        'balance': 100, 'subscription': {'plan': 'pro'}, 'demo_commerce': True, 'ledger': []}))
    page.route('**/lv/v1/commerce/subscribe', lambda route: route.fulfill(json={'plan': 'pro'}))
    page.reload()
    page.wait_for_load_state('networkidle')
    assert page.get_by_role('radio', name='Pro套餐', exact=True).is_checked()
    page.get_by_role('radio', name='企业套餐', exact=True).check()
    assert not mutations
    page.get_by_role('button', name='确认测试切换', exact=True).click()
    page.get_by_role('button', name='确认测试切换', exact=True).wait_for(state='visible')
    assert len(mutations) == 1
    print('PASS default current plan, all mouse selections, keyboard arrows, mobile layout, no purchase on selection, explicit demo confirmation')
    browser.close()
