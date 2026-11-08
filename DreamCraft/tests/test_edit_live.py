import base64
import io
import json
import os
import pathlib
import sys
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parent / 'output'
ROOT.mkdir(parents=True, exist_ok=True)
os.environ.update(DREAMCRAFT_MODE='local', DATA_DIR=str(ROOT / 'local-data'), DREAMCRAFT_DB=str(ROOT / 'local-data' / 'test.db'), NO_LOCAL_ENV='1')
sys.path.insert(0, str(__import__('pathlib').Path(__file__).resolve().parents[1] / 'app' / 'backend'))
from PIL import Image, ImageChops
from providers import read_image_bytes

BASE = 'http://127.0.0.1:8101'
reference = json.loads((ROOT / 'local-result.json').read_text())['results'][0]['url']
source = Image.open(io.BytesIO(read_image_bytes(reference))).convert('RGB')
source.thumbnail((256, 256))


def data(image):
    buf = io.BytesIO(); image.save(buf, format='PNG')
    return 'data:' + 'image/png;base64,' + base64.b64encode(buf.getvalue()).decode()


def post(tool, **kwargs):
    body = {'image_url': data(source), 'prompt': 'blue vase on a white table with flowers',
            'engine': {'comfyui_url': 'http://127.0.0.1:8188', 'default_engine': 'sdxl-draft'}, 'params': {'model': 'default'}, **kwargs}
    request = urllib.request.Request(BASE + '/lv/v1/editor/image/' + tool,
        data=json.dumps(body).encode(), headers={'Content-Type': 'application/json'})
    with urllib.request.urlopen(request, timeout=300) as response:
        result = json.loads(response.read())
    with urllib.request.urlopen(BASE + result['result_url']) as response:
        image = Image.open(io.BytesIO(response.read())).copy()
    image.save(ROOT / (tool + '-live.png'))
    return image


mask = Image.new('L', source.size, 0)
mask.paste(255, (source.width // 2, 0, source.width, source.height))
edited = post('inpaint', mask_url=data(mask)).convert('RGB')
assert ImageChops.difference(edited.crop((0, 0, 128, 256)), source.crop((0, 0, 128, 256))).getbbox() is None
assert ImageChops.difference(edited.crop((128, 0, 256, 256)), source.crop((128, 0, 256, 256))).getbbox() is not None
print('PASS real masked inpaint preserves every unmasked pixel', flush=True)
extended = post('outpaint').convert('RGB')
assert extended.size == (384, 384), extended.size
assert ImageChops.difference(extended.crop((64, 64, 320, 320)), source).getbbox() is None
print('PASS real outpaint expands canvas and preserves original pixels', flush=True)
matte = post('interactive_matting').convert('RGBA')
assert matte.getchannel('A').getextrema()[0] < matte.getchannel('A').getextrema()[1]
print('PASS real RGBA background removal', flush=True)
background = post('gen_background').convert('RGB')
assert background.size == source.size
assert ImageChops.difference(background, source).getbbox() is not None
print('PASS real foreground/background composition', flush=True)
