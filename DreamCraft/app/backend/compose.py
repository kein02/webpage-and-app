"""视频合成：ffmpeg 把逐镜头 mp4 顺序拼接成一条完整短剧。
支持逐镜头字幕烧录 + BGM 混音。
ffmpeg 路径：环境变量 DREAMCRAFT_FFMPEG 或默认搜索本机已有安装。
"""
import os, shutil, subprocess, urllib.request, uuid, pathlib, tempfile, json, re
from providers import download_remote

FFMPEG = os.environ.get("DREAMCRAFT_FFMPEG") or shutil.which("ffmpeg") or \
         os.path.join(os.path.expanduser("~"), ".dsh-wallpaper-engine", "ffmpeg", "ffmpeg.exe")

EXPORT_DIR = os.path.join(
    os.environ.get("DATA_DIR") or os.path.dirname(__file__), "exports")
os.makedirs(EXPORT_DIR, exist_ok=True)


def find_ffmpeg() -> str:
    if not os.path.isfile(FFMPEG):
        raise RuntimeError("ffmpeg 未安装，请设置 DREAMCRAFT_FFMPEG")
    return FFMPEG


def compose(urls: list, output_name: str = None, subtitles: list = None,
            bgm: str = None, shot_duration: float = 5.0) -> dict:
    """Normalize each clip before concatenating; every job owns its temporary files."""
    if not isinstance(urls, list) or not 1 <= len(urls) <= 20:
        raise ValueError("Provide 1 to 20 clips")
    if not 0 < shot_duration <= 60:
        raise ValueError("Invalid clip duration")
    output_name = output_name or f"drama_{uuid.uuid4().hex[:8]}.mp4"
    if pathlib.Path(output_name).name != output_name or not output_name.endswith('.mp4'):
        raise ValueError('Invalid output filename')
    out_path = os.path.join(EXPORT_DIR, output_name)
    with tempfile.TemporaryDirectory(prefix='dreamcraft-compose-') as folder:
        tmp = pathlib.Path(folder)
        ffprobe = pathlib.Path(find_ffmpeg()).with_name('ffprobe.exe' if os.name == 'nt' else 'ffprobe')
        for i, url in enumerate(urls):
            source = tmp / f'source_{i}.mp4'
            _copy(url, source)
            if ffprobe.is_file():
                probe = subprocess.run([str(ffprobe), '-v', 'error', '-show_streams', '-of', 'json', str(source)],
                    capture_output=True, encoding='utf-8', errors='replace', timeout=30)
                if probe.returncode:
                    raise ValueError('Cannot read video clip')
                has_audio = any(s.get('codec_type') == 'audio' for s in json.loads(probe.stdout)['streams'])
            else:
                probe = subprocess.run([find_ffmpeg(), '-nostdin', '-i', str(source)],
                    capture_output=True, encoding='utf-8', errors='replace', timeout=30)
                if not re.search(r'Stream #\d+:\d+.*Video:', probe.stderr):
                    raise ValueError('Cannot read video clip')
                has_audio = bool(re.search(r'Stream #\d+:\d+.*Audio:', probe.stderr))
            args = ['-i', str(source)]
            if not has_audio:
                args += ['-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=48000']
            filters = ['scale=1280:720:force_original_aspect_ratio=decrease', 'pad=1280:720:(ow-iw)/2:(oh-ih)/2', 'setsar=1', 'fps=24']
            if subtitles and i < len(subtitles) and subtitles[i].get('text'):
                (tmp / f'sub_{i}.txt').write_text(str(subtitles[i]['text']), encoding='utf-8')
                font = pathlib.Path(os.environ.get('WINDIR', 'C:/Windows')) / 'Fonts' / 'msyh.ttc'
                font_option = ''
                if font.is_file():
                    if not (tmp / 'font.ttc').exists():
                        shutil.copyfile(font, tmp / 'font.ttc')
                    font_option = 'fontfile=font.ttc:'
                filters.append(f'drawtext={font_option}textfile=sub_{i}.txt:expansion=none:fontsize=26:fontcolor=white:box=1:boxcolor=black@0.5:boxborderw=4:x=(w-text_w)/2:y=h-64')
            args += ['-map', '0:v:0', '-map', '0:a:0' if has_audio else '1:a:0', '-vf', ','.join(filters),
                     '-t', str(shot_duration), '-shortest', '-c:v', 'libx264', '-preset', 'fast', '-crf', '20',
                     '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-ar', '48000', '-ac', '2', f'clip_{i}.mp4']
            _run(args, folder)
        (tmp / 'concat.txt').write_text(''.join(f"file 'clip_{i}.mp4'\n" for i in range(len(urls))), encoding='ascii')
        _run(['-f', 'concat', '-safe', '0', '-i', 'concat.txt', '-c', 'copy', 'joined.mp4'], folder)
        if bgm:
            _copy(bgm, tmp / 'bgm.audio')
            _run(['-i', 'joined.mp4', '-stream_loop', '-1', '-i', 'bgm.audio', '-filter_complex',
                  '[1:a]volume=0.2[bg];[0:a][bg]amix=inputs=2:duration=first:normalize=0[a]',
                  '-map', '0:v:0', '-map', '[a]', '-c:v', 'copy', '-c:a', 'aac', '-shortest', '-movflags', '+faststart', 'final.mp4'], folder)
        else:
            _run(['-i', 'joined.mp4', '-c', 'copy', '-movflags', '+faststart', 'final.mp4'], folder)
        shutil.copyfile(tmp / 'final.mp4', out_path)
    return {"path": out_path, "url": f"/exports/{output_name}",
            "clips": len(urls), "has_bgm": bool(bgm), "subtitles": bool(subtitles)}


def _run(args, cwd):
    result = subprocess.run([find_ffmpeg(), '-nostdin', '-y', *args], cwd=cwd,
                            capture_output=True, encoding='utf-8', errors='replace', timeout=600)
    if result.returncode:
        raise RuntimeError('ffmpeg failed: ' + result.stderr[-1000:])


def _copy(source, destination):
    if source.startswith(('https://', 'http://')):
        download_remote(source, destination)
        return
    if os.environ.get('DREAMCRAFT_MODE', 'public') == 'public' and not source.startswith(('/uploads/', '/exports/')):
        raise ValueError('Public mode requires an uploaded or generated media URL')
    root = pathlib.Path(EXPORT_DIR).parent.resolve()
    if source.startswith(('/uploads/', '/exports/')):
        path = (root / source.lstrip('/')).resolve()
    else:
        path = pathlib.Path(source).resolve()
    allowed = [root / 'exports', root / 'uploads', pathlib.Path(__file__).parent / 'assets_bgm']
    if source.startswith(('/uploads/', '/exports/')):
        media_root = root / ('uploads' if source.startswith('/uploads/') else 'exports')
        if not path.is_relative_to(media_root.resolve()):
            raise ValueError('Invalid media path')
    if not any(path.is_relative_to(p.resolve()) for p in allowed):
        raise ValueError('Only uploaded or generated media can be composed')
    shutil.copyfile(path, destination)
