"""Offline regression tests; isolated database and no paid API calls."""
import asyncio
import base64
import io
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

SANDBOX = tempfile.TemporaryDirectory(prefix="dreamcraft-audit-")
os.environ.update(DATA_DIR=SANDBOX.name, DREAMCRAFT_DB=str(Path(SANDBOX.name) / "test.db"),
                  NO_LOCAL_ENV="1", DREAMCRAFT_MODE="local", BYOK_ONLY="1", COMFYUI_DISABLE="1")
sys.path.insert(0, str(__import__('pathlib').Path(__file__).resolve().parents[1] / 'app' / 'backend'))
from fastapi.testclient import TestClient
from PIL import Image
import main
import providers


def image_data():
    buf = io.BytesIO()
    Image.new("RGB", (64, 48), "red").save(buf, format="PNG")
    return buf.getvalue()


class Provider(providers.AgnesProvider):
    async def generate_image(self, **kwargs):
        return {"results": [{"url": "data:" + "image/png;base64," + base64.b64encode(image_data()).decode()} for _ in range(kwargs.get("n", 1))]}


class BackendTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.client = TestClient(main.app)
        cls.client.__enter__()
        cls.headers = []
        for name in ("audit-a", "audit-b"):
            r = cls.client.post("/api/auth/register", json={"username": name, "password": "test-password"})
            assert r.status_code == 200, r.text
            cls.headers.append({"Authorization": "Bearer " + r.json()["token"]})

    @classmethod
    def tearDownClass(cls):
        async def close():
            for module in (main.auth, main.wallet, main.team, main.userconfig, sys.modules['taskstore']):
                connection = getattr(module._local, 'conn', None)
                if connection:
                    connection.close()
                    module._local.conn = None
        cls.client.portal.call(close)
        cls.client.__exit__(None, None, None)
        asyncio.run(close())
        SANDBOX.cleanup()

    def test_registration(self):
        self.assertFalse(self.client.get("/api/auth/me", headers=self.headers[0]).json()["anon"])
        self.assertEqual(self.client.get("/api/auth/me", headers={"Authorization": "Bearer bad"}).status_code, 401)

    def test_upload(self):
        h = self.headers[0]
        sign = self.client.post("/api/biz/v1/common/get_upload_sign", json={}).json()
        r = self.client.post(sign["url"], files={"file": ("../../unsafe.png", image_data(), "image/png")}, headers=h)
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual(self.client.get(r.json()["url"]).status_code, 200)
        self.assertNotIn("..", r.json()["url"])
        self.assertEqual(self.client.post(sign["url"], files={"file": ("x.txt", b"invalid", "text/plain")}, headers=h).status_code, 400)
        for i in range(3): main.wallet.add_asset("x", kind="image", owner=main.auth.verify(h["Authorization"][7:]))
        self.assertEqual(len(self.client.get("/api/biz/v1/asset/list?kind=upload&limit=1", headers=h).json()["assets"]), 1)

    def test_team_permissions(self):
        a, b = self.headers
        tid = self.client.post("/api/biz/v1/team/create", json={"name": "Audit"}, headers=a).json()["team_id"]
        self.assertEqual(self.client.get("/api/biz/v1/team/" + tid, headers=b).status_code, 404)
        self.assertEqual(self.client.post("/api/biz/v1/team/" + tid + "/plan", json={"plan": "pro"}, headers=b).status_code, 404)
        owner = self.client.get("/api/biz/v1/team/" + tid, headers=a).json()["members"][0]
        self.assertEqual(self.client.delete(f"/api/biz/v1/team/{tid}/members/{owner['id']}", headers=a).status_code, 400)

    def test_task_isolation_and_refund(self):
        a, b = self.headers
        uid = main.auth.verify(a["Authorization"][7:])
        provider = Provider()
        with patch.object(main, "_provider_for", return_value=provider):
            r = self.client.post("/lv/v1/editor/image/ai_model/submit_task", json={"prompt": "test", "n": 2}, headers=a)
            self.assertEqual(r.status_code, 200, r.text)
            tid = r.json()["task_id"]
            self.assertEqual(len(r.json()["result"]["results"]), 2)
            self.assertEqual(self.client.get("/lv/v1/task/status/" + tid, headers=b).json()["status"], "not_found")
            self.assertEqual(self.client.post("/lv/v2/task/multi_get_tasks", json={"task_ids": [tid]}, headers=b).json()["tasks"], [])
            provider.generate_image = AsyncMock(side_effect=RuntimeError("offline failure"))
            balance = main.wallet.get_balance(uid)
            r = self.client.post("/lv/v1/editor/image/ai_model/submit_task", json={"prompt": "fail"}, headers=a)
            self.assertEqual(r.status_code, 502)
            self.assertEqual(main.wallet.get_balance(uid), balance)
            self.assertEqual(main.store.list(owner=uid)[0]["status"], "failed")

    def test_restart_refund_is_idempotent(self):
        uid = main.auth.verify(self.headers[0]['Authorization'][7:])
        task_id = 'interrupted-audit'
        before = main.wallet.get_balance(uid)
        main.store.create(task_id, 'video', {}, owner=uid)
        self.assertTrue(main.wallet.charge_for('video', uid, task_id=task_id))
        async def restart():
            async with main.lifespan(main.app):
                pass
        self.client.portal.call(restart)
        main.wallet.refund_task(uid, task_id)
        self.assertEqual(main.wallet.get_balance(uid), before)
        self.assertEqual(main.store.get(task_id)['status'], 'failed')

    def test_agent(self):
        with patch.object(main, "_provider_for", return_value=Provider()), patch.object(main.agnes_text, "chat", new=AsyncMock(return_value="done")):
            r = self.client.post("/api/biz/v1/agent/submit_run", json={"messages": [{"role": "user", "content": "test"}]}, headers=self.headers[0])
            self.assertEqual(r.status_code, 200, r.text)
            self.assertTrue(r.json()["result"]["image"]["results"][0]["url"])

    def test_upscale_and_no_fake_matting(self):
        data = "data:" + "image/png;base64," + base64.b64encode(image_data()).decode()
        self.assertEqual(providers.read_image_bytes(data), image_data())
        r = self.client.post("/lv/v1/editor/image/super_resolution", json={"image_url": data, "params": {"resolution": 256}}, headers=self.headers[0])
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual(Image.open(io.BytesIO(providers.read_image_bytes(r.json()["result_url"]))).size, (256, 192))
        with patch.object(main, "_provider_for", return_value=Provider()):
            self.assertEqual(self.client.post("/lv/v1/editor/image/interactive_matting", json={"image_url": data}).status_code, 400)
        narrow = io.BytesIO()
        Image.new('RGB', (1, 1024), 'red').save(narrow, 'PNG')
        response = self.client.post('/lv/v1/editor/image/super_resolution', json={'image_url': 'data:' + 'image/png;base64,' + base64.b64encode(narrow.getvalue()).decode(), 'params': {'resolution': 256}}, headers=self.headers[0])
        self.assertEqual(response.status_code, 200, response.text)

    def test_comfy_workflows(self):
        async def run():
            p = providers.ComfyUIProvider()
            p._has_sdxl = lambda: True
            p._has_lightning = lambda: True
            p._sdxl_checkpoint = lambda: 'renamed_sdxl.safetensors'
            p._lightning_lora = lambda: 'custom_lightning.safetensors'
            p._upload_image = lambda _: "reference.png"
            p._run = AsyncMock(return_value=["one", "two"])
            with patch.object(providers, "_mirror_to_exports", side_effect=lambda u: u):
                await p.generate_image(prompt="test", model="sdxl", n=2)
                self.assertEqual(p._run.call_args.args[0]["4"]["inputs"]["batch_size"], 2)
                self.assertEqual(p._run.call_args.args[0]['3']['inputs']['ckpt_name'], 'renamed_sdxl.safetensors')
                await p.generate_image(prompt="test", model="sdxl", ref_image="reference", n=2)
                wf = p._run.call_args.args[0]
                self.assertEqual(wf["4"]["class_type"], "VAEEncode")
                self.assertEqual(wf["11"]["inputs"]["amount"], 2)
        asyncio.run(run())

    def test_comfy_discovers_installed_sdxl_names(self):
        provider = providers.ComfyUIProvider()
        provider._opts = lambda node, field: {
            'ckpt_name': ['custom_sdxl_v2.safetensors'],
            'lora_name': ['custom_lightning_4step.safetensors'],
        }.get(field, [])
        self.assertTrue(provider._has_sdxl())
        self.assertTrue(provider._has_lightning())
        workflow = provider._workflow_sdxl('test', 512, 512, 1, 4, 1)
        self.assertEqual(workflow['3']['inputs']['ckpt_name'], 'custom_sdxl_v2.safetensors')

    def test_comfy_does_not_advertise_missing_workflow_nodes(self):
        provider = providers.ComfyUIProvider()
        provider._has_zimage = lambda: True
        provider._has_sdxl = lambda: True
        provider._has_lightning = lambda: True
        provider._node_names = lambda: {'KSampler', 'VAEDecode', 'SaveImage', 'CheckpointLoaderSimple',
                                        'CLIPTextEncode', 'EmptyLatentImage'}
        self.assertEqual([item['id'] for item in provider.available_engines()], ['sdxl'])
        provider._node_names = lambda: set()
        self.assertEqual(provider.available_engines(), [])

    def test_drama_validates_entire_batch_before_submission(self):
        with patch.object(main, '_video_platform_for', return_value=('agnes', 'fake', None, None, 'user')), patch.object(main.video_platforms, 'generate_blocking') as generate:
            for shots in ([{'prompt': 'valid'}, {'prompt': '   '}], [{'prompt': 'valid'}, {'prompt': 12}], [{'prompt': 'valid'}, {'prompt': 'x' * 10001}]):
                before = len(main.store.list(500))
                response = self.client.post('/lv/v1/short_drama/render_all', headers=self.headers[0], json={'shots': shots})
                self.assertEqual(response.status_code, 400, response.text)
                self.assertEqual(len(main.store.list(500)), before)
            generate.assert_not_called()

    def test_commerce_and_validation(self):
        self.assertEqual(self.client.post('/lv/v1/commerce/recharge', json={'amount': 100}, headers=self.headers[0]).status_code, 503)
        self.assertEqual(self.client.post('/lv/v1/commerce/subscribe', json={'plan': 'bad'}, headers=self.headers[0]).status_code, 400)
        self.assertEqual(self.client.post('/api/biz/v1/agent/submit_run', json={'messages': ['bad']}, headers=self.headers[0]).status_code, 400)
        self.assertEqual(self.client.post('/lv/v1/editor/image/ai_model/submit_task', json={'prompt': 'test', 'n': 99}).status_code, 422)

    def test_engine_diagnostics_and_missing_ffmpeg(self):
        import compose
        with patch.object(main, '_video_platform_for', return_value=('agnes', 'secret-key', 'private-root', 'model', 'user')), \
                patch.object(compose, 'FFMPEG', '/missing/ffmpeg'):
            result = self.client.get('/api/biz/v1/engine/diagnostics', headers=self.headers[0])
            self.assertEqual(result.status_code, 200, result.text)
            self.assertEqual(result.json()['video'], {'configured': True, 'platform': 'agnes', 'source': 'user'})
            self.assertFalse(result.json()['ffmpeg']['ready'])
            self.assertNotIn('secret-key', result.text)
            self.assertNotIn('private-root', result.text)
            self.assertNotIn('/missing/', result.text)
            with patch.object(compose, 'compose') as render:
                response = self.client.post('/lv/v1/short_drama/compose',
                    headers=self.headers[0], json={'urls': ['https://example.com/clip.mp4']})
                self.assertEqual(response.status_code, 503, response.text)
                self.assertIn('DREAMCRAFT_FFMPEG', response.json()['detail'])
                render.assert_not_called()
        with patch.object(compose, 'find_ffmpeg', return_value='ffmpeg'), \
                patch.object(compose.subprocess, 'run', side_effect=OSError('invalid executable')):
            self.assertFalse(compose.ffmpeg_status()['ready'])

    def test_inpaint_preserves_pixels(self):
        data = 'data:' + 'image/png;base64,' + base64.b64encode(image_data()).decode()
        mask = Image.new('L', (64, 48), 0)
        mask.paste(255, (32, 0, 64, 48))
        buf = io.BytesIO(); mask.save(buf, format='PNG')
        mask_data = 'data:' + 'image/png;base64,' + base64.b64encode(buf.getvalue()).decode()
        provider = Provider()
        blue = io.BytesIO(); Image.new('RGB', (64, 48), 'blue').save(blue, format='PNG')
        provider.generate_image = AsyncMock(return_value={'results': [{'url': 'data:' + 'image/png;base64,' + base64.b64encode(blue.getvalue()).decode()}]})
        with patch.object(main, '_provider_for', return_value=provider):
            r = self.client.post('/lv/v1/editor/image/inpaint', json={'image_url': data, 'mask_url': mask_data})
        self.assertEqual(r.status_code, 200, r.text)
        result = Image.open(io.BytesIO(providers.read_image_bytes(r.json()['result_url'])))
        self.assertEqual(result.getpixel((0, 0))[:3], (255, 0, 0))
        self.assertEqual(result.getpixel((63, 0))[:3], (0, 0, 255))

    def test_video_platform_protocols(self):
        import video_platforms as v
        with patch.object(v, '_post', return_value={'output': {'task_id': 'task'}}) as post:
            self.assertEqual(v.submit('dashscope', 'fake', 'test')['task_id'], 'task')
            self.assertEqual(post.call_args.kwargs['headers'], {'X-DashScope-Async': 'enable'})
        with patch.object(v, '_post', return_value={'status': 'Succeed', 'results': {'videos': [{'url': 'https://example.com/video.mp4'}]}}) as post:
            self.assertEqual(v.poll('siliconflow', 'fake', 'task')['status'], 'succeed')
            self.assertEqual(post.call_args.args[1], {'requestId': 'task'})
        with patch.object(v, '_get', return_value={'status': 'completed'}):
            self.assertEqual(v.poll('agnes', 'fake', 'task')['status'], 'failed')
        with patch.object(v, 'read_image_bytes', return_value=image_data()), patch.object(v, '_post', return_value={'video_id': 'task'}) as post:
            v.submit('agnes', 'fake', 'test', ref_image='/uploads/reference.png')
            self.assertTrue(post.call_args.args[1]['image'].startswith('data:' + 'image/png;base64,'))

    def test_video_service_unavailable_is_not_always_queue_full(self):
        import urllib.error
        import video_platforms as v
        for status, detail, expected in (
                (503, b'{"error":{"code":"video_queue_full"}}', '平台队列已满'),
                (429, b'{"error":{"code":"queue_full"}}', '平台队列已满'),
                (503, b'<html>Service Unavailable</html>', '平台服务暂时不可用（HTTP 503）'),
                (503, b'', '平台服务暂时不可用（HTTP 503）')):
            with self.subTest(status=status, detail=detail):
                error = urllib.error.HTTPError('https://example.com/v1/videos',
                    status, 'Unavailable', {}, io.BytesIO(detail))
                with patch.object(v, 'open_remote', side_effect=error) as remote:
                    with self.assertRaises(v.VideoPlatformError) as caught:
                        v.submit('agnes', 'fake', 'test')
                self.assertIn(expected, str(caught.exception))
                remote.assert_called_once()

    def test_comfy_proxy_is_scoped(self):
        with patch.object(main, '_BYOK_ONLY', False):
            self.assertEqual(self.client.get('/api/comfy/system_stats', headers={'X-Comfy-Base': 'https://example.com'}).status_code, 400)
            self.assertEqual(self.client.post('/api/comfy/interrupt', headers={'X-Comfy-Base': main.COMFYUI_URL}).status_code, 404)


if __name__ == "__main__":
    unittest.main(verbosity=2)
