"""Public release regression: no real cloud requests or GPU jobs."""
import asyncio
import base64
import io
import os
import sys
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

folder = tempfile.TemporaryDirectory(prefix='dreamcraft-public-security-')
os.environ.update(DREAMCRAFT_MODE='public', DATA_DIR=folder.name, NO_LOCAL_ENV='1')
sys.path.insert(0, str(__import__('pathlib').Path(__file__).resolve().parents[1] / 'app' / 'backend'))
from fastapi.testclient import TestClient
from PIL import Image
import main
import providers


def png():
    out = io.BytesIO()
    Image.new('RGB', (32, 24), 'red').save(out, 'PNG')
    return out.getvalue()


class PublicTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.client = TestClient(main.app)
        cls.client.__enter__()
        cls.users = []
        for name in ('public-owner', 'public-other'):
            result = cls.client.post('/api/auth/register', json={'username': name, 'password': 'test-password'})
            assert result.status_code == 200, result.text
            cls.users.append(result.json())
        cls.a, cls.b = [{'Authorization': 'Bearer ' + user['token']} for user in cls.users]

    def setUp(self):
        main._rate_windows.clear()
        self.client.cookies.clear()

    def upload(self, headers=None, key=None):
        key = key or self.client.post('/api/biz/v1/common/get_upload_sign', headers=self.a).json()['upload_key']
        return self.client.post('/api/upload/' + key, headers=headers or self.a,
                                files={'file': ('image.png', png(), 'image/png')})

    def test_private_media_and_reference_isolation(self):
        result = self.upload()
        self.assertEqual(result.status_code, 200, result.text)
        url = result.json()['url']
        self.assertEqual(self.client.get(url).status_code, 401)
        self.assertEqual(self.client.get(url, headers=self.b).status_code, 404)
        response = self.client.get(url, headers=self.a)
        self.assertEqual(response.content, png())
        self.assertEqual(response.headers['cache-control'], 'private, no-store')
        self.assertEqual(self.client.get(url, headers={**self.a, 'Range': 'bytes=0-10'}).status_code, 206)
        for endpoint, body in [
            ('/api/biz/v1/asset/create_v2', {'url': url}),
            ('/lv/v1/editor/image/super_resolution', {'image_url': url}),
            ('/lv/v1/editor/image/ai_model/submit_task', {'prompt': 'private', 'ref_image': url}),
            ('/lv/v1/short_drama/compose', {'urls': [url]}),
        ]:
            self.assertEqual(self.client.post(endpoint, json=body, headers=self.b).status_code, 404)

    def test_media_cookie_and_logout(self):
        url = self.upload().json()['url']
        login = self.client.post('/api/auth/login', json={'username': 'public-owner', 'password': 'test-password'})
        self.assertIn('HttpOnly', login.headers['set-cookie'])
        self.assertEqual(self.client.get(url).status_code, 200)
        self.client.post('/api/auth/logout')
        self.assertEqual(self.client.get(url).status_code, 401)
        self.client.get('/api/auth/me', headers=self.a)
        self.assertEqual(self.client.get(url).status_code, 200)
        self.client.post('/api/auth/login', json={'username': 'public-other', 'password': 'test-password'})
        self.assertEqual(self.client.get(url).status_code, 404)

    def test_reused_upload_key_never_overwrites(self):
        key = 'f' * 32
        first, second = self.upload(key=key), self.upload(headers=self.b, key=key)
        self.assertNotEqual(first.json()['url'], second.json()['url'])
        self.assertEqual(self.client.get(first.json()['url'], headers=self.a).content, png())

    def test_encrypted_config_no_response_leaks(self):
        key = 'fake-private-video-key'
        result = self.client.post('/api/biz/v1/engine/config', headers=self.a,
            json={'video_platform': 'agnes', 'video_key': key})
        self.assertEqual(result.status_code, 200, result.text)
        self.assertNotIn(key, result.text)
        uid = self.users[0]['user_id']
        raw = main.userconfig._conn().execute('SELECT video_key FROM user_engine_config WHERE owner=?', (uid,)).fetchone()[0]
        self.assertTrue(raw.startswith('fernet:'))
        self.assertNotIn(key, raw)
        self.assertEqual(main.userconfig.get(uid)['video_key'], key)
        self.assertNotIn(key, self.client.get('/api/biz/v1/engine/config', headers=self.a).text)
        self.assertFalse(self.client.get('/api/biz/v1/engine/config', headers=self.b).json()['has_video_key'])
        self.client.post('/api/biz/v1/engine/config', headers=self.a, json={'video_model': 'kept-model'})
        self.assertEqual(main.userconfig.get(uid)['video_key'], key)
        self.client.post('/api/biz/v1/engine/config', headers=self.a, json={'video_key': ''})
        self.assertIsNone(main.userconfig.get(uid)['video_key'])

    def test_legacy_key_migration_and_redirect_credentials(self):
        uid = 'legacy-user'
        connection = main.userconfig._conn()
        connection.execute("INSERT INTO user_engine_config(owner,agnes_key) VALUES (?,?)", (uid, 'legacy-plaintext'))
        connection.commit()
        connection.close()
        main.userconfig._local.conn = None
        self.assertEqual(main.userconfig.get(uid)['agnes_key'], 'legacy-plaintext')
        raw = main.userconfig._conn().execute('SELECT agnes_key FROM user_engine_config WHERE owner=?', (uid,)).fetchone()[0]
        self.assertTrue(raw.startswith('fernet:'))
        import urllib.request
        req = urllib.request.Request('https://one.example/start', headers={'Authorization': 'Bearer private'})
        with patch.object(providers, 'validate_remote_url'):
            redirected = providers._PublicRedirect().redirect_request(req, None, 302, '', {}, 'https://two.example/end')
        self.assertFalse(redirected.has_header('Authorization'))

    def test_media_token_cannot_authenticate_api(self):
        token = main.auth.media_token(self.users[0]['user_id'])
        self.assertIsNone(main.auth.verify(token))
        self.assertEqual(self.client.get('/api/biz/v1/asset/list', headers={'Authorization': 'Bearer ' + token}).status_code, 401)
        url = self.upload().json()['url']
        self.assertEqual(self.client.get(url + '?access=' + token).status_code, 200)

    def test_browser_results_record_tasks_and_download(self):
        response = self.client.post('/api/biz/v1/asset/create_v2', headers=self.a,
            json={'url': 'data:' + 'image/png;base64,' + base64.b64encode(png()).decode(), 'kind': 'image', 'prompt': 'direct-image', 'record_task': True})
        self.assertEqual(response.status_code, 200, response.text)
        url = response.json()['url']
        self.assertTrue(url.startswith('/exports/'))
        self.assertEqual(self.client.get(url, headers=self.a).content, png())
        self.assertEqual(self.client.get(url, headers=self.b).status_code, 404)
        tasks = self.client.post('/lv/v2/task/multi_get_tasks', headers=self.a, json={}).json()['tasks']
        self.assertTrue(any(t['payload'].get('prompt') == 'direct-image' and t['status'] == 'succeed' for t in tasks))

    def test_busy_limit_and_secret_redaction(self):
        uid = self.users[0]['user_id']
        main._inflight[uid] = 3
        try:
            self.assertEqual(self.client.post('/lv/v1/editor/image/ai_model/submit_task', headers=self.a, json={'prompt': 'test'}).status_code, 429)
        finally:
            main._inflight.clear()
        main.userconfig.save(uid, agnes_key='do-not-leak-key')
        provider = providers.AgnesProvider()
        provider.generate_image = AsyncMock(side_effect=RuntimeError('upstream echoed do-not-leak-key'))
        with patch.object(main, '_provider_for', return_value=provider):
            response = self.client.post('/lv/v1/editor/image/ai_model/submit_task', headers=self.a, json={'prompt': 'test'})
        self.assertEqual(response.status_code, 502)
        self.assertNotIn('do-not-leak-key', response.text)
        self.assertNotIn('do-not-leak-key', self.client.post('/lv/v2/task/multi_get_tasks', headers=self.a, json={}).text)
        main.userconfig.save(uid, agnes_key='')

    def test_limits(self):
        for _ in range(10):
            self.assertEqual(self.client.post('/api/auth/login', json={'username': 'missing', 'password': 'wrong'}).status_code, 401)
        r = self.client.post('/api/auth/login', headers={'Origin': 'https://frontend.example'}, json={'username': 'missing', 'password': 'wrong'})
        self.assertEqual(r.status_code, 429)
        self.assertIn('retry-after', r.headers)
        self.assertEqual(r.headers['access-control-allow-origin'], '*')
        main._rate_windows.clear()
        for _ in range(12):
            self.assertEqual(self.client.post('/lv/v1/editor/image/ai_model/submit_task', headers=self.b, json={'prompt': 'test'}).status_code, 400)
        self.assertEqual(self.client.post('/lv/v1/editor/image/ai_model/submit_task', headers=self.b, json={'prompt': 'test'}).status_code, 429)
        main._rate_windows.clear()
        for _ in range(20):
            self.assertEqual(self.upload().status_code, 200)
        self.assertEqual(self.upload().status_code, 429)
        self.assertEqual(self.client.post('/api/auth/register', content=b'x' * (30 * 1024 * 1024 + 1)).status_code, 413)

    def test_image_tasks_assets_and_failures(self):
        provider = providers.AgnesProvider()
        result = {'results': [{'url': 'data:' + 'image/png;base64,' + base64.b64encode(png()).decode()}]}
        provider.generate_image = AsyncMock(return_value=result)
        with patch.object(main, '_provider_for', return_value=provider):
            response = self.client.post('/lv/v1/editor/image/ai_model/submit_task', headers=self.a, json={'prompt': 'release-test'})
            self.assertEqual(response.status_code, 200, response.text)
            tid = response.json()['task_id']
            self.assertEqual(self.client.get('/lv/v1/task/status/' + tid, headers=self.a).json()['status'], 'succeed')
            self.assertEqual(self.client.get('/lv/v1/task/status/' + tid, headers=self.b).json()['status'], 'not_found')
            self.assertEqual(self.client.post('/lv/v2/task/multi_get_tasks', headers=self.b, json={'task_ids': [tid]}).json()['tasks'], [])
            self.assertTrue(any(a['task_id'] == tid for a in self.client.get('/api/biz/v1/asset/list', headers=self.a).json()['assets']))
            provider.generate_image = AsyncMock(side_effect=RuntimeError('generation unavailable'))
            response = self.client.post('/lv/v1/editor/image/ai_model/submit_task', headers=self.a, json={'prompt': 'failed-test'})
            self.assertEqual(response.status_code, 502)
            self.assertFalse(main._inflight)

    def test_agent_and_edit_data_results_are_private_files(self):
        provider = providers.AgnesProvider()
        provider.generate_image = AsyncMock(side_effect=lambda **kwargs: {'results': [{'url': 'data:' + 'image/png;base64,' + base64.b64encode(png()).decode()}]})
        with patch.object(main, '_provider_for', return_value=provider):
            for endpoint, body, result_path in [
                ('/api/biz/v1/agent/submit_run', {'messages': [{'role': 'user', 'content': 'draw'}]}, ('result', 'image', 'results', 0, 'url')),
                ('/lv/v1/editor/image/inpaint', {'image_url': 'data:' + 'image/png;base64,' + base64.b64encode(png()).decode(), 'mask_url': 'data:' + 'image/png;base64,' + base64.b64encode(png()).decode()}, ('result_url',)),
            ]:
                response = self.client.post(endpoint, headers=self.a, json=body)
                self.assertEqual(response.status_code, 200, response.text)
                value = response.json()
                for key in result_path:
                    value = value[key]
                self.assertTrue(value.startswith('/exports/'), value[:30])
                self.assertEqual(self.client.get(value, headers=self.a).status_code, 200)
                self.assertEqual(self.client.get(value, headers=self.b).status_code, 404)
        assets = self.client.get('/api/biz/v1/asset/list', headers=self.a).json()['assets']
        self.assertFalse(any(asset['url'].startswith('data:') for asset in assets))

    def test_video_refresh_and_persistence(self):
        uid = self.users[0]['user_id']
        main.userconfig.save(uid, video_platform='agnes', video_key='fake-video-key')
        with patch.object(main.video_platforms, 'generate_blocking', return_value={'results': [{'url': 'https://example.com/video.mp4'}]}):
            response = self.client.post('/lv/v1/editor/video/submit_task', headers=self.a, json={'prompt': 'video-test'})
            self.assertEqual(response.status_code, 200, response.text)
            tid = response.json()['task_id']
            for _ in range(50):
                status = self.client.get('/lv/v1/task/status/' + tid, headers=self.a).json()
                if status['status'] == 'succeed':
                    break
                time.sleep(.02)
            self.assertEqual(status['status'], 'succeed')
            self.assertEqual(main.store.get(tid, owner=uid)['status'], 'succeed')
            self.assertEqual(self.client.get('/lv/v1/task/status/' + tid, headers=self.b).json()['status'], 'not_found')
        import subprocess
        probe = subprocess.run([sys.executable, '-c',
            'import main,sys; t=main.store.get(sys.argv[1],owner=sys.argv[2]); assert t["status"]=="succeed"; assert main.userconfig.get(sys.argv[2])["video_key"]=="fake-video-key"', tid, uid],
            cwd=str(__import__('pathlib').Path(__file__).resolve().parents[1] / 'app' / 'backend'), capture_output=True, timeout=30)
        self.assertEqual(probe.returncode, 0, probe.stderr.decode(errors='replace'))

    @classmethod
    def tearDownClass(cls):
        async def close():
            for module in (main.auth, main.wallet, main.team, main.userconfig, sys.modules['taskstore']):
                conn = getattr(module._local, 'conn', None)
                if conn:
                    conn.close()
                    module._local.conn = None
        cls.client.portal.call(close)
        cls.client.__exit__(None, None, None)
        asyncio.run(close())
        folder.cleanup()


if __name__ == '__main__':
    unittest.main(verbosity=2)
