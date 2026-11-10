"""Local browser fixture: real FFmpeg, simulated generation and upscale only."""
import os
from pathlib import Path
import subprocess
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'app' / 'backend'))
import main
import compose
import providers
from PIL import Image
import io
import uvicorn

if __name__ == '__main__':
    user = main.auth.register('editing-browser', 'test-password')
    uid = user['user_id']
    main.userconfig.save(uid, video_platform='agnes', video_key='offline-key')
    for name, color in (('red', 'red'), ('blue', 'blue')):
        path = Path(main.EXPORT_DIR) / (name + '.mp4')
        subprocess.run([compose.find_ffmpeg(), '-nostdin', '-y', '-f', 'lavfi', '-i',
            f'color={color}:size=320x240:rate=24', '-t', '2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', str(path)],
            capture_output=True, check=True, timeout=30)
        main.wallet.add_asset('/exports/' + path.name, 'video', owner=uid)
        main.store.create(name, 'drama-shot', {'prompt': name}, 'succeed', owner=uid)
        main.store.update(name, result={'results': [{'url': '/exports/' + path.name}]})
    main.projectstore.save_project(uid, None, 'drama', 'Editable drama', {
        'theme': 'Editing test',
        'shots': [{'shot_id': index, 'prompt': name + ' scene', 'camera': 'wide', 'duration': 1,
                   'subtitle': name, 'trim_start': 0} for index, name in ((9, 'red'), (4, 'blue'))],
        'taskIds': ['red', 'blue'], 'finalVideo': None, 'finalMeta': None,
    }, 0)

    class SimulatedUpscale(providers.ComfyUIProvider):
        def upscale_models(self):
            return {'ready': True, 'models': ['offline-x2.pth'], 'message': 'Offline simulated model'}

        async def upscale(self, image_url, model, width, height):
            image = Image.open(io.BytesIO(providers.read_image_bytes(image_url)))
            name = 'simulated-upscale.png'
            image.resize((width, height)).save(Path(main.EXPORT_DIR) / name)
            return {'result_url': '/exports/' + name, 'engine': 'comfyui-upscale', 'model': 'offline-x2.pth'}

    main._edit_provider = lambda body, request: SimulatedUpscale()
    main.video_platforms.submit = lambda *args, **kwargs: {'task_id': 'offline-new', 'model': 'test'}
    main.video_platforms.poll = lambda *args, **kwargs: {'status': 'succeed', 'url': '/exports/red.mp4'}
    uvicorn.run(main.app, host='127.0.0.1', port=int(os.environ['EDITING_TEST_PORT']), log_level='warning')
