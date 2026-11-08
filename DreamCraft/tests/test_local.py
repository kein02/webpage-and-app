"""Exercise the installed ComfyUI without invoking cloud APIs."""
import asyncio
import io
import json
import os
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent / 'output'
ROOT.mkdir(parents=True, exist_ok=True)
DATA = ROOT / 'local-data'
DATA.mkdir(exist_ok=True)
os.environ.update(DREAMCRAFT_MODE='local', DATA_DIR=str(DATA), DREAMCRAFT_DB=str(DATA / 'test.db'), NO_LOCAL_ENV='1')
sys.path.insert(0, str(__import__('pathlib').Path(__file__).resolve().parents[1] / 'app' / 'backend'))
from PIL import Image
from providers import ComfyUIProvider, read_image_bytes


async def run():
    p = ComfyUIProvider('http://127.0.0.1:8188')
    print('Engines:', json.dumps(p.available_engines(), ensure_ascii=True), flush=True)
    result = await p.generate_image(prompt='a red ceramic vase with a green leaf on a white table, studio product photograph', model='sdxl-draft', resolution=512, n=2, seed=17)
    assert len(result['results']) == 2, result
    reference = result['results'][0]['url']
    for item in result['results']:
        image = Image.open(io.BytesIO(read_image_bytes(item['url'])))
        assert image.size == (512, 512)
        assert max(v[1] - v[0] for v in image.getextrema()) > 20
    print('PASS real batch: 2 nonblank images', flush=True)
    (ROOT / 'local-result.json').write_text(json.dumps(result), encoding='utf-8')
    edited = await p.generate_image(prompt='a blue ceramic vase with flowers on a white table', ref_image=reference, model='sdxl-draft', resolution=512, n=1, seed=19)
    assert edited['results'][0]['url']
    print('PASS real image-to-image', flush=True)
    matte = await p.matting(reference)
    assert matte.get('mask_url'), matte
    image = Image.open(io.BytesIO(read_image_bytes(matte['mask_url']))).convert('L')
    assert image.getextrema()[0] != image.getextrema()[1]
    print('PASS real background removal mask', flush=True)


asyncio.run(run())
