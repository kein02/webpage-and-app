"""Actual browser workflows against an isolated, simulated public server."""
import os
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
import time
import urllib.request
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "tests" / "output" / "workspace"
OUT.mkdir(parents=True, exist_ok=True)


def free_port():
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


with tempfile.TemporaryDirectory(prefix="dreamcraft-workspace-browser-") as data:
    port = free_port()
    base = f"http://127.0.0.1:{port}"
    env = {**os.environ, "DATA_DIR": data, "DREAMCRAFT_MODE": "public", "NO_LOCAL_ENV": "1",
           "COMFYUI_DISABLE": "1", "WORKSPACE_TEST_PORT": str(port)}
    with open(OUT / "server.log", "w", encoding="utf-8") as log:
        server = subprocess.Popen([sys.executable, "-X", "utf8", str(ROOT / "tests" / "workspace_server.py")],
                                  env=env, cwd=ROOT, stdout=log, stderr=subprocess.STDOUT)
        try:
            for _ in range(150):
                if server.poll() is not None:
                    raise RuntimeError("Fixture failed: " + (OUT / "server.log").read_text("utf-8"))
                try:
                    urllib.request.urlopen(base + "/api/runtime", timeout=1).close()
                    break
                except OSError:
                    time.sleep(.1)
            with sync_playwright() as pw:
                browser = pw.chromium.launch(headless=True)
                context = browser.new_context(viewport={"width": 1440, "height": 1000})
                context.route("https://example.invalid/**", lambda route: route.fulfill(status=200, body=b""))
                page = context.new_page()
                errors = []
                page.on("pageerror", lambda e: errors.append(str(e)))
                page.goto(base + "/login")
                page.get_by_placeholder("用户名", exact=True).fill("workspace-browser")
                page.get_by_placeholder("密码（至少 6 位）", exact=True).fill("test-password")
                page.get_by_role("button", name="登录", exact=True).last.click()
                page.wait_for_url(base + "/")
                page.goto(base + "/ai-tool/canvas-home")
                page.wait_for_load_state("networkidle")
                expect(page.get_by_label("项目名称")).to_be_enabled()
                page.get_by_label("项目名称").fill("Canvas saved project")
                page.get_by_role("button", name="文本", exact=True).click()
                expect(page.get_by_label("文本内容")).to_have_value("新的文字")
                page.get_by_role("button", name="撤销", exact=True).click()
                expect(page.get_by_label("文本内容")).to_have_count(0)
                page.get_by_role("button", name="重做", exact=True).click()
                expect(page.get_by_text("text-1", exact=True)).to_be_visible()
                page.get_by_role("button", name="保存项目", exact=True).click()
                expect(page.get_by_role("status").filter(has_text="已保存")).to_be_visible()
                page.reload()
                expect(page.get_by_text("text-1", exact=True)).to_be_visible()
                expect(page.get_by_label("项目名称")).to_have_value("Canvas saved project")
                page.get_by_text("text-1", exact=True).click()
                page.get_by_label("文本内容").fill("Edited layer")
                expect(page.get_by_role("status").filter(has_text="已保存")).to_be_visible()
                # Drag is one history operation.
                layer = page.locator(".canvas-surface .absolute").filter(has_text="Edited layer").first
                box = layer.bounding_box()
                page.mouse.move(box["x"] + 10, box["y"] + 10)
                page.mouse.down()
                page.mouse.move(box["x"] + 100, box["y"] - 30, steps=8)
                page.mouse.up()
                expect(page.get_by_label("图层 x")).not_to_have_value("80")
                page.get_by_role("button", name="撤销", exact=True).click()
                page.get_by_text("text-1", exact=True).click()
                expect(page.get_by_label("图层 x")).to_have_value("80")
                page.get_by_role("button", name="保存项目", exact=True).click()
                expect(page.get_by_role("status").filter(has_text="已保存")).to_be_visible()
                page.screenshot(path=str(OUT / "canvas-desktop.png"))
                print("PASS canvas save/reload/undo/redo/one-drag history", flush=True)

                # Two-tab optimistic concurrency protects the first writer.
                other = context.new_page()
                other.goto(base + "/ai-tool/canvas-home")
                expect(other.get_by_label("项目名称")).to_have_value("Canvas saved project")
                page.get_by_label("项目名称").fill("First writer")
                expect(page.get_by_role("status").filter(has_text="已保存")).to_be_visible()
                other.get_by_label("项目名称").fill("Second writer")
                expect(other.get_by_role("alert")).to_contain_text("其他窗口")
                other.on("dialog", lambda d: d.accept())
                other.get_by_label("打开项目").select_option(label="Canvas saved project")
                expect(other.get_by_label("项目名称")).to_have_value("First writer")
                other.close()
                print("PASS concurrent project edits do not overwrite saved work", flush=True)

                # Keep a recovery draft when saving fails; a reload must not lose it.
                page.route("**/api/biz/v1/project/save", lambda route: route.fulfill(status=503, json={"detail": "offline save"}))
                page.get_by_label("项目名称").fill("Recovered offline draft")
                expect(page.get_by_role("alert")).to_contain_text("offline save")
                page.once("dialog", lambda d: d.accept())
                page.reload()
                expect(page.get_by_label("项目名称")).to_have_value("Recovered offline draft")
                page.unroute("**/api/biz/v1/project/save")
                page.get_by_role("button", name="保存项目", exact=True).click()
                expect(page.get_by_role("status").filter(has_text="已保存")).to_be_visible()
                page.get_by_label("项目名称").fill("First writer")
                expect(page.get_by_role("status").filter(has_text="已保存")).to_be_visible()
                print("PASS failed autosave survives reload and can be saved after recovery", flush=True)

                page.get_by_role("button", name="新建项目", exact=True).click()
                page.get_by_label("项目名称").fill("Another project")
                page.get_by_role("button", name="形状", exact=True).click()
                expect(page.get_by_role("status").filter(has_text="已保存")).to_be_visible()
                page.once("dialog", lambda d: d.dismiss())
                page.get_by_role("button", name="删除项目", exact=True).click()
                expect(page.get_by_role("button", name="撤销", exact=True)).to_be_enabled()
                page.once("dialog", lambda d: d.accept())
                page.get_by_role("button", name="删除项目", exact=True).click()
                expect(page.get_by_label("项目名称")).to_have_value("未命名项目")
                page.get_by_label("打开项目").select_option(label="First writer")
                expect(page.get_by_text("text-1", exact=True)).to_be_visible()
                page.goto(base + "/ai-tool/novel")
                expect(page.get_by_label("项目名称")).to_be_enabled()
                page.get_by_label("项目名称").fill("Persistent drama")
                page.get_by_placeholder("输入短剧主题，例如：深夜便利店里的重逢").fill("Saved story")
                page.get_by_role("button", name="生成剧本", exact=True).click()
                expect(page.get_by_role("heading", name="分镜脚本（6 镜头）")).to_be_visible()
                expect(page.get_by_role("status").filter(has_text="已保存")).to_be_visible()
                page.reload()
                expect(page.get_by_role("heading", name="分镜脚本（6 镜头）")).to_be_visible()
                expect(page.get_by_label("项目名称")).to_have_value("Persistent drama")
                # Unmount before the debounce; the pending save must still complete.
                page.get_by_placeholder("输入短剧主题，例如：深夜便利店里的重逢").fill("Quick navigation")
                page.get_by_role("link", name="素材库", exact=True).click()
                page.get_by_role("link", name="短剧工坊", exact=True).click()
                expect(page.get_by_placeholder("输入短剧主题，例如：深夜便利店里的重逢")).to_have_value("Quick navigation")
                # Force an in-flight write to outlive a route change.
                def slow_save(route):
                    time.sleep(1.2)
                    route.continue_()
                page.route("**/api/biz/v1/project/save", slow_save)
                page.get_by_placeholder("输入短剧主题，例如：深夜便利店里的重逢").fill("In-flight navigation")
                page.get_by_role("link", name="素材库", exact=True).click()
                page.get_by_role("link", name="短剧工坊", exact=True).click()
                expect(page.get_by_placeholder("输入短剧主题，例如：深夜便利店里的重逢")).to_have_value("In-flight navigation")
                expect(page.get_by_role("status").filter(has_text="已保存")).to_be_visible()
                expect(page.get_by_role("alert")).to_have_count(0)
                page.unroute("**/api/biz/v1/project/save")
                print("PASS project switching and persistent drama", flush=True)

                page.goto(base + "/ai-tool/asset")
                expect(page.locator(".asset-item")).to_have_count(24)
                page.get_by_role("button", name="下一页", exact=True).click()
                expect(page.locator(".asset-item")).to_have_count(3)
                page.get_by_role("button", name="上一页", exact=True).click()
                expect(page.locator(".asset-item")).to_have_count(24)
                page.get_by_role("button", name="编辑素材", exact=True).first.click()
                page.get_by_label("素材名称", exact=True).fill("Renamed asset")
                page.get_by_label("素材标签", exact=True).fill("精选, cover")
                page.get_by_role("button", name="保存", exact=True).click()
                expect(page.get_by_role("dialog")).to_have_count(0)
                page.get_by_label("搜索素材").fill("Renamed")
                expect(page.locator(".asset-item")).to_have_count(1)
                expect(page.get_by_text("Renamed asset", exact=True)).to_be_visible()
                page.get_by_label("全选当前页").check()
                with page.expect_download() as info:
                    page.get_by_role("button", name="打包下载选中素材").click()
                download = info.value
                assert download.suggested_filename.endswith(".zip")
                download.save_as(str(OUT / "assets.zip"))
                page.on("dialog", lambda d: d.accept())
                page.get_by_role("button", name="删除素材", exact=True).click()
                expect(page.locator(".asset-item")).to_have_count(0)
                page.get_by_role("button", name="回收站", exact=True).click()
                expect(page.locator(".asset-item")).to_have_count(1)
                page.get_by_role("button", name="恢复素材", exact=True).click()
                expect(page.locator(".asset-item")).to_have_count(0)
                page.get_by_role("button", name="全部素材", exact=True).click()
                expect(page.locator(".asset-item")).to_have_count(1)
                page.get_by_label("搜索素材").fill("")
                expect(page.locator(".asset-item")).to_have_count(24)
                page.screenshot(path=str(OUT / "assets-desktop.png"))
                print("PASS pagination/search/name/tags/trash/restore/ZIP download", flush=True)

                page.goto(base + "/ai-tool/task-center")
                row = page.get_by_role("row").filter(has_text="Reusable video prompt")
                row.get_by_role("button", name="任务详情").click()
                expect(page.get_by_role("dialog")).to_contain_text("Offline simulated failure")
                page.keyboard.press("Escape")
                expect(page.get_by_role("dialog")).to_have_count(0)
                row.get_by_role("button", name="复用提示词").click()
                expect(page.get_by_label("视频描述", exact=True)).to_have_value("Reusable video prompt")
                page.goto(base + "/ai-tool/task-center")
                row = page.get_by_role("row").filter(has_text="Reusable video prompt")
                row.get_by_role("button", name="重试任务").click()
                expect(page.get_by_role("row").filter(has_text="Reusable video prompt")).to_have_count(2)
                paused = page.get_by_role("row").filter(has_text="Recover query")
                paused.get_by_role("button", name="恢复查询").click()
                expect(paused).to_contain_text("完成", timeout=15000)
                print("PASS task details/prompt reuse/manual retry/query recovery", flush=True)

                for route in ("canvas-home", "novel", "asset", "task-center"):
                    page.set_viewport_size({"width": 390, "height": 844})
                    page.goto(base + "/ai-tool/" + route)
                    page.wait_for_load_state("networkidle")
                    assert page.evaluate("document.documentElement.scrollWidth <= innerWidth + 1"), route
                    page.screenshot(path=str(OUT / (route + "-mobile.png")), full_page=True)
                # Switch accounts synchronously while a draft is dirty.
                page.set_viewport_size({"width": 1440, "height": 1000})
                new_user = page.request.post(base + "/api/auth/register", data={"username": "second-browser", "password": "test-password"}).json()
                page.goto(base + "/ai-tool/novel")
                expect(page.get_by_label("项目名称")).to_be_enabled()
                page.get_by_placeholder("输入短剧主题，例如：深夜便利店里的重逢").fill("Private old-account draft")
                page.evaluate("""token => {
                  localStorage.setItem('dc_token', token)
                  window.dispatchEvent(new Event('dc-auth-changed'))
                }""", new_user["token"])
                expect(page.get_by_placeholder("输入短剧主题，例如：深夜便利店里的重逢")).to_have_value("")
                time.sleep(1)
                own_projects = page.request.get(base + "/api/biz/v1/project/list?kind=drama",
                    headers={"Authorization": "Bearer " + new_user["token"]}).json()["projects"]
                assert own_projects == [], own_projects
                print("PASS dirty old-account projects never save into the next account", flush=True)
                original_user = page.request.post(base + "/api/auth/login", data={"username": "workspace-browser", "password": "test-password"}).json()
                page.evaluate("""token => {
                  localStorage.setItem('dc_token', token)
                  window.dispatchEvent(new Event('dc-auth-changed'))
                }""", original_user["token"])
                expect(page.get_by_placeholder("输入短剧主题，例如：深夜便利店里的重逢")).to_have_value("Private old-account draft")
                expect(page.get_by_role("status").filter(has_text="已保存")).to_be_visible()
                print("PASS re-login restores the original account draft with a new token", flush=True)
                assert not errors, errors
                print("PASS mobile pages, no JS errors or document overflow", flush=True)
                browser.close()
        finally:
            server.terminate()
            server.wait(timeout=20)
