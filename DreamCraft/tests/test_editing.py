"""Drama editing and AI upscale contracts; no real providers or GPU calls."""
import asyncio
import base64
import io
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import AsyncMock, patch

folder = tempfile.TemporaryDirectory(prefix='dreamcraft-editing-')
os.environ.update(DATA_DIR=folder.name, DREAMCRAFT_DB=str(Path(folder.name) / 'dreamcraft.db'),
                  DREAMCRAFT_MODE='public', NO_LOCAL_ENV='1', COMFYUI_DISABLE='1')
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'app' / 'backend'))
from fastapi.testclient import TestClient
from PIL import Image
import main
import providers
import compose


def png(size=(32, 24)):
    output = io.BytesIO()
    Image.new('RGBA', size, (10, 150, 100, 90)).save(output, 'PNG')
    return output.getvalue()


class EditingTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.client = TestClient(main.app)
        cls.client.__enter__()
        cls.users = [cls.client.post('/api/auth/register', json={
            'username': name, 'password': 'test-password'}).json() for name in ('editor-a', 'editor-b')]
        cls.a, cls.b = [{'Authorization': 'Bearer ' + u['token']} for u in cls.users]

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
        folder.cleanup()

    def setUp(self):
        main._rate_windows.clear()
        self.client.cookies.clear()

    def post(self, path, body, headers=None):
        return self.client.post(path, json=body, headers=headers or self.a)

    def test_ai_workflow_uses_model_before_resize(self):
        provider = providers.ComfyUIProvider()
        async def run(workflow):
            self.assertEqual(workflow['2']['inputs']['model_name'], 'x2.pth')
            self.assertEqual(workflow['3']['class_type'], 'ImageUpscaleWithModel')
            self.assertEqual(workflow['4']['inputs']['image'], ['3', 0])
            self.assertEqual(workflow['4']['inputs']['width'], 256)
            self.assertEqual(workflow['5']['inputs']['images'], ['4', 0])
            return ['https://example.invalid/result.png']
        with patch.object(provider, 'upscale_models', return_value={'ready': True, 'models': ['x2.pth']}), \
                patch.object(provider, '_upload_image', return_value='input.png'), \
                patch.object(provider, '_run', side_effect=run), \
                patch.object(providers, '_mirror_to_exports', return_value='/exports/up.png'):
            result = asyncio.run(provider.upscale('data:image/png;base64,' + base64.b64encode(png()).decode(), '', 256, 192))
        self.assertEqual(result['engine'], 'comfyui-upscale')

    def test_ai_missing_nodes_models_and_unknown_model_do_not_submit(self):
        provider = providers.ComfyUIProvider()
        with patch.object(provider, '_node_names', return_value=set()):
            self.assertFalse(provider.upscale_models()['ready'])
        with patch.object(provider, '_node_names', return_value={'LoadImage', 'UpscaleModelLoader', 'ImageUpscaleWithModel', 'ImageScale', 'SaveImage'}), \
                patch.object(provider, '_opts', return_value=[]):
            info = provider.upscale_models()
            self.assertFalse(info['ready'])
            self.assertIn('upscale_models', info['message'])
        for info, model in (({'ready': False, 'message': 'missing'}, ''), ({'ready': True, 'models': ['x2.pth']}, 'unknown')):
            with patch.object(provider, 'upscale_models', return_value=info), patch.object(provider, '_run', new_callable=AsyncMock) as run:
                with self.assertRaises(ValueError):
                    asyncio.run(provider.upscale('image', model, 256, 192))
                run.assert_not_called()

    def test_ai_endpoint_preserves_alpha_and_registers_owned_asset(self):
        provider = providers.ComfyUIProvider()
        result_path = Path(main.EXPORT_DIR) / 'mock-upscale.png'
        Image.new('RGB', (256, 192), 'green').save(result_path)
        image = 'data:image/png;base64,' + base64.b64encode(png()).decode()
        with patch.object(main, '_edit_provider', return_value=provider), patch.object(provider, 'upscale',
                new_callable=AsyncMock, return_value={'result_url': '/exports/mock-upscale.png', 'engine': 'comfyui-upscale', 'model': 'x2.pth'}) as upscale:
            response = self.post('/lv/v1/editor/image/super_resolution', {
                'image_url': image, 'params': {'method': 'ai', 'resolution': 256}})
            self.assertEqual(response.status_code, 200, response.text)
            self.assertEqual(response.json()['model'], 'x2.pth')
            self.assertEqual(upscale.await_args.args[2:], (256, 192))
        with Image.open(result_path) as result:
            self.assertEqual(result.getpixel((10, 10))[3], 90)
        self.assertEqual(self.client.get('/exports/mock-upscale.png', headers=self.b).status_code, 404)
        with patch.object(main, '_edit_provider', return_value=providers.MockProvider()):
            response = self.post('/lv/v1/editor/image/super_resolution', {'image_url': image, 'params': {'method': 'ai'}})
            self.assertEqual(response.status_code, 400)
            self.assertIn('ComfyUI', response.text)
        response = self.post('/lv/v1/editor/image/super_resolution', {'image_url': image, 'params': {'method': 'lanczos', 'resolution': 256}})
        self.assertEqual(response.json()['engine'], 'lanczos')

    def test_upscale_probe_requires_auth_and_respects_public_network_policy(self):
        self.assertEqual(self.client.post('/lv/v1/editor/image/upscale_models', json={}).status_code, 401)
        result = self.post('/lv/v1/editor/image/upscale_models', {'engine': {'comfyui_url': 'http://127.0.0.1:8188'}})
        self.assertEqual(result.status_code, 400)

    def test_drama_validates_all_shots_before_submission_and_uses_camera_duration(self):
        shots = [{'shot_id': 4, 'prompt': 'first', 'camera': 'pan left', 'duration': 3},
                 {'shot_id': 1, 'prompt': 'second', 'duration': 8}]
        with patch.object(main, '_video_platform_for', return_value=('agnes', 'offline-key', '', 'test', 'user')), \
                patch.object(main, '_submit_video', side_effect=[{'task_id': 'one'}, {'task_id': 'two'}]) as submit:
            result = self.post('/lv/v1/short_drama/render_all', {'shots': shots})
            self.assertEqual(result.status_code, 200, result.text)
            self.assertEqual(result.json()['task_ids'], ['one', 'two'])
            self.assertEqual(submit.call_args_list[0].args[0].duration, 3)
            self.assertIn('Camera: pan left', submit.call_args_list[0].args[0].prompt)
            self.assertEqual(submit.call_args_list[1].kwargs['shot_id'], 1)
            submit.reset_mock()
            for bad in (0, 16, True, 'bad'):
                shots[1]['duration'] = bad
                self.assertEqual(self.post('/lv/v1/short_drama/render_all', {'shots': shots}).status_code, 400)
            shots[1].update(duration=5, prompt='x' * 10000, camera='pan')
            self.assertEqual(self.post('/lv/v1/short_drama/render_all', {'shots': shots}).status_code, 400)
            submit.assert_not_called()

    def test_compose_order_subtitles_and_trim_stay_aligned_when_failed_shot_skipped(self):
        uid = self.users[0]['user_id']
        for tid, status, url in (('shot-a', 'succeed', '/exports/a.mp4'),
                                 ('shot-b', 'failed', None), ('shot-c', 'succeed', '/exports/c.mp4')):
            main.store.create(tid, 'drama-shot', {}, status, owner=uid)
            if url:
                main.store.update(tid, result={'results': [{'url': url}]})
        body = {'task_ids': ['shot-c', 'shot-b', 'shot-a'], 'subtitles': [{'text': 'C'}, {'text': 'B'}, {'text': 'A'}],
                'clips': [{'start': 1, 'duration': 2}, {'start': 0, 'duration': 4}, {'start': 0.5, 'duration': 3}], 'bgm_volume': 0.4}
        with patch.object(compose, 'ffmpeg_status', return_value={'ready': True}), \
                patch.object(compose, 'compose', return_value={'url': '/exports/out.mp4'}) as render:
            result = self.post('/lv/v1/short_drama/compose', body)
            self.assertEqual(result.status_code, 200, result.text)
            self.assertEqual(render.call_args.args[0], ['/exports/c.mp4', '/exports/a.mp4'])
            self.assertEqual(render.call_args.kwargs['subtitles'], [{'text': 'C'}, {'text': 'A'}])
            self.assertEqual(render.call_args.kwargs['clips'], [body['clips'][0], body['clips'][2]])
            self.assertEqual(render.call_args.kwargs['bgm_volume'], 0.4)
            self.assertEqual(self.post('/lv/v1/short_drama/compose', body, self.b).status_code, 404)

    def test_compose_rejects_malformed_options_and_others_music(self):
        for patch_data in ({'clips': []}, {'clips': [{'start': -1}]}, {'subtitles': [{'text': 5}]},
                           {'bgm_volume': 2}, {'shot_duration': True}, {'urls': 'x'}):
            result = self.post('/lv/v1/short_drama/compose', {'urls': ['https://example.com/a.mp4'], **patch_data})
            self.assertEqual(result.status_code, 400, result.text)
        main.wallet.add_asset('/uploads/private.mp3', kind='audio', owner=self.users[1]['user_id'])
        self.assertEqual(self.post('/lv/v1/short_drama/compose', {
            'urls': ['https://example.com/a.mp4'], 'bgm': '/uploads/private.mp3'}).status_code, 404)

    def test_audio_upload_validation_ownership_and_failed_cleanup(self):
        endpoint = '/api/upload/audio/' + 'a' * 32
        with patch.object(compose, 'validate_audio'):
            result = self.client.post(endpoint, files={'file': ('music.wav', b'fake-audio', 'audio/wav')}, headers=self.a)
        self.assertEqual(result.status_code, 200, result.text)
        url = result.json()['url']
        self.assertEqual(self.client.get(url, headers=self.a).content, b'fake-audio')
        self.assertEqual(self.client.get(url, headers=self.b).status_code, 404)
        before = list(Path(main.UPLOAD_DIR).iterdir())
        with patch.object(compose, 'validate_audio', side_effect=ValueError('invalid audio')):
            self.assertEqual(self.client.post(endpoint, files={'file': ('x.mp3', b'bad')}, headers=self.a).status_code, 400)
        self.assertEqual(list(Path(main.UPLOAD_DIR).iterdir()), before)
        self.assertEqual(self.client.post(endpoint, files={'file': ('x.html', b'bad')}, headers=self.a).status_code, 400)

    def test_editable_fields_persist_with_task_slots_and_validate(self):
        document = {'theme': 'edit', 'shots': [{'shot_id': 5, 'prompt': 'scene', 'camera': 'wide',
                    'duration': 4, 'trim_start': 0.5, 'subtitle': 'hello'}], 'taskIds': [''],
                    'bgm': '/uploads/music.mp3', 'bgmName': 'Music', 'bgmVolume': 0.3, 'subtitlesEnabled': False}
        main.wallet.add_asset('/uploads/music.mp3', 'audio', owner=self.users[0]['user_id'])
        result = self.post('/api/biz/v1/project/save', {'kind': 'drama', 'name': 'edit', 'data': document})
        self.assertEqual(result.status_code, 200, result.text)
        saved = self.client.get('/api/biz/v1/project/' + result.json()['id'], headers=self.a).json()
        self.assertEqual(saved['data'], document)
        for patch_data in ({'bgmVolume': -1}, {'subtitlesEnabled': 'yes'}, {'shots': [{'prompt': 'x', 'duration': 0}]}):
            self.assertEqual(self.post('/api/biz/v1/project/save', {'kind': 'drama', 'name': 'bad',
                'data': {**document, **patch_data}}).status_code, 400)


if __name__ == '__main__':
    unittest.main(verbosity=2)
