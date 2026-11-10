"""视频合成：ffmpeg 把逐镜头 mp4 顺序拼接成一条完整短剧。
支持逐镜头字幕烧录 + BGM 混音。
ffmpeg 路径：环境变量 DREAMCRAFT_FFMPEG 或默认搜索本机已有安装。
"""
import os, shutil, subprocess, urllib.request, uuid, pathlib, tempfile, json, re, math, textwrap
from providers import download_remote

FFMPEG = os.environ.get("DREAMCRAFT_FFMPEG") or shutil.which("ffmpeg") or \
         os.path.join(os.path.expanduser("~"), ".dsh-wallpaper-engine", "ffmpeg", "ffmpeg.exe")

EXPORT_DIR = os.path.join(
    os.environ.get("DATA_DIR") or os.path.dirname(__file__), "exports")
os.makedirs(EXPORT_DIR, exist_ok=True)


def find_ffmpeg() -> str:
    if not os.path.isfile(FFMPEG):
        raise RuntimeError("未找到 FFmpeg。请在运行后端的电脑安装并加入 PATH，"
                           "或设置 DREAMCRAFT_FFMPEG 为可执行文件路径，然后重启应用。"
                           "Windows 桌面版也可将 ffmpeg.exe 放在 DreamCraft.exe 旁。")
    return FFMPEG


def ffmpeg_status() -> dict:
    try:
        result = subprocess.run([find_ffmpeg(), '-version'], capture_output=True,
                                timeout=5, creationflags=0x08000000 if os.name == 'nt' else 0)
        if result.returncode:
            raise RuntimeError('FFmpeg 无法运行，请检查安装后重启应用。')
        return {'ready': True, 'message': 'FFmpeg 已就绪，可以合成短剧。'}
    except (OSError, RuntimeError, subprocess.TimeoutExpired):
        return {'ready': False, 'message': 'FFmpeg 未就绪。请在运行后端的电脑安装 FFmpeg 并加入 PATH，'
                '或设置 DREAMCRAFT_FFMPEG，然后重启应用。桌面版可将 ffmpeg.exe 放在 DreamCraft.exe 旁。'}


def validate_options(count, subtitles=None, clips=None, bgm_volume=0.2):
    if type(bgm_volume) not in (int, float) or not math.isfinite(bgm_volume) or not 0 <= bgm_volume <= 1:
        raise ValueError('配乐音量必须在 0 到 1 之间')
    if subtitles is not None and (not isinstance(subtitles, list) or len(subtitles) > count or
            any(not isinstance(s, dict) or not isinstance(s.get('text', ''), str) or len(s.get('text', '')) > 300 for s in subtitles)):
        raise ValueError('字幕格式无效，单条最多 300 字')
    if clips is not None:
        if not isinstance(clips, list) or len(clips) != count:
            raise ValueError('剪辑参数必须与镜头一一对应')
        for clip in clips:
            if not isinstance(clip, dict):
                raise ValueError('剪辑参数无效')
            for key, low, high in (('start', 0, 60), ('duration', 0.1, 60)):
                value = clip.get(key, 0 if key == 'start' else 5)
                if type(value) not in (int, float) or not math.isfinite(value) or not low <= value <= high:
                    raise ValueError('剪辑起点必须在 0 至 60 秒，时长必须在 0.1 至 60 秒')


def validate_audio(path):
    result = subprocess.run([find_ffmpeg(), '-nostdin', '-v', 'error', '-i', str(path),
                            '-map', '0:a:0', '-t', '0.1', '-f', 'null', '-'],
        capture_output=True, timeout=30, creationflags=0x08000000 if os.name == 'nt' else 0)
    if result.returncode:
        raise ValueError('请上传有效的音频文件')


def compose(urls: list, output_name: str = None, subtitles: list = None,
            bgm: str = None, shot_duration: float = 5.0, clips: list = None,
            bgm_volume: float = 0.2) -> dict:
    """Normalize each clip before concatenating; every job owns its temporary files."""
    if not isinstance(urls, list) or not 1 <= len(urls) <= 20:
        raise ValueError("Provide 1 to 20 clips")
    if not 0 < shot_duration <= 60:
        raise ValueError("Invalid clip duration")
    validate_options(len(urls), subtitles, clips, bgm_volume)
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
                streams = json.loads(probe.stdout)['streams']
                has_audio = any(s.get('codec_type') == 'audio' for s in streams)
                source_duration = next((s.get('duration') for s in streams if s.get('codec_type') == 'video'), None)
            else:
                probe = subprocess.run([find_ffmpeg(), '-nostdin', '-i', str(source)],
                    capture_output=True, encoding='utf-8', errors='replace', timeout=30)
                if not re.search(r'Stream #\d+:\d+.*Video:', probe.stderr):
                    raise ValueError('Cannot read video clip')
                has_audio = bool(re.search(r'Stream #\d+:\d+.*Audio:', probe.stderr))
                duration_match = re.search(r'Duration: (\d+):(\d+):([\d.]+)', probe.stderr)
                source_duration = (int(duration_match[1]) * 3600 + int(duration_match[2]) * 60 +
                                   float(duration_match[3])) if duration_match else None
            clip = clips[i] if clips else {}
            try:
                source_duration = float(source_duration)
            except (TypeError, ValueError):
                source_duration = None
            if source_duration is not None and clip.get('start', 0) >= source_duration:
                raise ValueError(f'镜头 {i + 1} 的剪辑起点超过实际片长')
            args = ['-ss', str(clip.get('start', 0)), '-i', str(source)]
            if not has_audio:
                args += ['-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=48000']
            filters = ['scale=1280:720:force_original_aspect_ratio=decrease', 'pad=1280:720:(ow-iw)/2:(oh-ih)/2', 'setsar=1', 'fps=24']
            if subtitles and i < len(subtitles) and subtitles[i].get('text'):
                text = '\n'.join('\n'.join(textwrap.wrap(line, 34)) for line in subtitles[i]['text'].splitlines())
                (tmp / f'sub_{i}.txt').write_text(text, encoding='utf-8')
                font = pathlib.Path(os.environ.get('WINDIR', 'C:/Windows')) / 'Fonts' / 'msyh.ttc'
                if not font.is_file():
                    font = pathlib.Path('/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc')
                font_option = ''
                if font.is_file():
                    if not (tmp / 'font.ttc').exists():
                        shutil.copyfile(font, tmp / 'font.ttc')
                    font_option = 'fontfile=font.ttc:'
                filters.append(f'drawtext={font_option}textfile=sub_{i}.txt:expansion=none:fontsize=26:fontcolor=white:box=1:boxcolor=black@0.5:boxborderw=4:x=(w-text_w)/2:y=h-text_h-40')
            args += ['-map', '0:v:0', '-map', '0:a:0' if has_audio else '1:a:0', '-vf', ','.join(filters),
                     '-t', str(clip.get('duration', shot_duration)), '-shortest', '-c:v', 'libx264', '-preset', 'fast', '-crf', '20',
                     '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-ar', '48000', '-ac', '2', f'clip_{i}.mp4']
            _run(args, folder)
        (tmp / 'concat.txt').write_text(''.join(f"file 'clip_{i}.mp4'\n" for i in range(len(urls))), encoding='ascii')
        _run(['-f', 'concat', '-safe', '0', '-i', 'concat.txt', '-c', 'copy', 'joined.mp4'], folder)
        if bgm:
            _copy(bgm, tmp / 'bgm.audio')
            _run(['-i', 'bgm.audio', '-vn', '-ar', '48000', '-ac', '2', '-c:a', 'pcm_s16le', 'bgm.wav'], folder)
            probe = subprocess.run([find_ffmpeg(), '-nostdin', '-i', str(tmp / 'joined.mp4')],
                capture_output=True, encoding='utf-8', errors='replace', timeout=30,
                creationflags=0x08000000 if os.name == 'nt' else 0)
            match = re.search(r'Duration: (\d+):(\d+):([\d.]+)', probe.stderr)
            if not match:
                raise ValueError('无法读取成片时长')
            total = int(match[1]) * 3600 + int(match[2]) * 60 + float(match[3])
            # A filter source avoids FFmpeg 6's looping input demuxer shutdown
            # deadlock when the output is shorter than the repeated audio.
            _run(['-i', 'joined.mp4', '-filter_complex',
                  f'amovie=bgm.wav:loop=0,asetpts=N/SR/TB,volume={bgm_volume}[bg];'
                  '[0:a][bg]amix=inputs=2:duration=first:normalize=0[a]',
                  '-map', '0:v:0', '-map', '[a]', '-c:v', 'copy', '-c:a', 'aac', '-t', str(total),
                  '-movflags', '+faststart', 'final.mp4'], folder)
        else:
            _run(['-i', 'joined.mp4', '-c', 'copy', '-movflags', '+faststart', 'final.mp4'], folder)
        shutil.copyfile(tmp / 'final.mp4', out_path)
    return {"path": out_path, "url": f"/exports/{output_name}",
            "clips": len(urls), "has_bgm": bool(bgm),
            "subtitles": any(s.get('text') for s in subtitles or [])}


def _run(args, cwd):
    result = subprocess.run([find_ffmpeg(), '-nostdin', '-y', *args], cwd=cwd,
                            capture_output=True, encoding='utf-8', errors='replace', timeout=600,
                            creationflags=0x08000000 if os.name == 'nt' else 0)
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
