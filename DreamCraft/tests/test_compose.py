import concurrent.futures
import os
import pathlib
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parent / 'output' / 'compose-data'
ROOT.mkdir(parents=True, exist_ok=True)
os.environ['DATA_DIR'] = str(ROOT)
sys.path.insert(0, str(__import__('pathlib').Path(__file__).resolve().parents[1] / 'app' / 'backend'))
import compose

exports = pathlib.Path(compose.EXPORT_DIR)
ffmpeg = compose.find_ffmpeg()


def ff(*args):
    r = subprocess.run([ffmpeg, '-y', '-nostdin', *args], capture_output=True, encoding='utf-8', errors='replace', timeout=60)
    assert r.returncode == 0, r.stderr[-1000:]


ff('-f', 'lavfi', '-i', 'color=red:size=320x240:rate=24', '-t', '0.5', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', str(exports / 'silent.mp4'))
ff('-f', 'lavfi', '-i', 'color=blue:size=480x270:rate=30', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000', '-t', '0.6', '-c:v', 'libx264', '-c:a', 'aac', '-pix_fmt', 'yuv420p', str(exports / 'audio.mp4'))
ff('-f', 'lavfi', '-i', 'sine=frequency=220:sample_rate=48000', '-t', '1', str(exports / 'music.wav'))


def run(index):
    result = compose.compose(['/exports/silent.mp4', '/exports/audio.mp4'],
        output_name=f'audit_{index}.mp4', subtitles=[{'text': "中文: 100% '字幕'"}, {'text': 'Second shot'}],
        bgm='/exports/music.wav' if index else None, shot_duration=0.7)
    assert pathlib.Path(result['path']).stat().st_size > 1000
    ff('-i', result['path'], '-f', 'null', '-')
    return result


with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
    print(list(pool.map(run, range(2))))
print('PASS concurrent compose, mixed sizes, silent clips, Chinese subtitles, BGM, decoded outputs')

trimmed = compose.compose(['/exports/silent.mp4', '/exports/audio.mp4'],
    subtitles=[{'text': '长字幕自动折行，完整保留在画面内。' * 12}, {'text': 'Second'}], bgm='/exports/music.wav',
    clips=[{'start': 0.1, 'duration': 0.25}, {'start': 0.2, 'duration': 0.3}], bgm_volume=0.35)
ff('-i', trimmed['path'], '-f', 'null', '-')
probe = subprocess.run([ffmpeg, '-i', trimmed['path']], capture_output=True,
                       encoding='utf-8', errors='replace', timeout=10)
import re
duration = re.search(r'Duration: (\d+):(\d+):([\d.]+)', probe.stderr)
seconds = int(duration[1]) * 3600 + int(duration[2]) * 60 + float(duration[3])
assert 0.45 <= seconds <= 0.8, seconds
compose.validate_audio(exports / 'music.wav')
print('PASS actual per-shot start/duration trim, subtitles and adjustable BGM; decoded duration', seconds)
try:
    compose.compose(['/exports/silent.mp4'], clips=[{'start': 10, 'duration': 1}])
    raise AssertionError('Trim past EOF must be rejected')
except ValueError as error:
    assert '剪辑起点' in str(error)
print('PASS trim past actual video length rejected')
