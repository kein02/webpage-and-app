"""GitHub release checks and verified Windows update handoff."""
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.parse
import urllib.request
import uuid
import zipfile

REPOSITORY = 'kein02/webpage-and-app'
API = 'https://api.github.com/repos/' + REPOSITORY
MAX_PACKAGE = 512 * 1024 * 1024


def version_tuple(value):
    if not isinstance(value, str) or not re.fullmatch(r'(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)', value):
        raise ValueError('Invalid stable version')
    return tuple(int(part) for part in value.split('.'))


def asset_for(release, kind):
    version = release['tag_name'].removeprefix('dreamcraft-v')
    version_tuple(version)
    name = f'DreamCraft-{"Setup" if kind == "installed" else "Windows"}-{version}-x64'
    name += '.exe' if kind == 'installed' else '.zip'
    matches = [a for a in release.get('assets', []) if a.get('name') == name]
    if len(matches) != 1:
        raise ValueError('Release package is missing or duplicated')
    asset = matches[0]
    url = urllib.parse.urlsplit(asset.get('browser_download_url', ''))
    expected = f'/{REPOSITORY}/releases/download/dreamcraft-v{version}/{name}'
    if url.scheme != 'https' or url.netloc != 'github.com' or url.path != expected or url.query or url.fragment:
        raise ValueError('Unexpected release download URL')
    if not re.fullmatch(r'sha256:[a-f0-9]{64}', asset.get('digest') or ''):
        raise ValueError('Release has no SHA256 digest')
    size = asset.get('size')
    if not isinstance(size, int) or not 0 < size <= MAX_PACKAGE:
        raise ValueError('Release package size is invalid')
    return asset


def select_release(releases, current, kind):
    current = version_tuple(current)
    candidates = []
    for release in releases:
        tag = release.get('tag_name', '')
        if release.get('draft') or release.get('prerelease') or not tag.startswith('dreamcraft-v'):
            continue
        try:
            version = version_tuple(tag.removeprefix('dreamcraft-v'))
        except ValueError:
            continue
        if version > current:
            candidates.append((version, release))
    if not candidates:
        return None
    newest = max(candidates, key=lambda item: item[0])[1]
    asset_for(newest, kind)
    return newest


class GitHubRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        target = urllib.parse.urlsplit(newurl)
        if target.scheme != 'https' or target.hostname not in (
                'github.com', 'api.github.com', 'release-assets.githubusercontent.com',
                'objects.githubusercontent.com'):
            raise ValueError('Untrusted update redirect')
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def open_github(url):
    request = urllib.request.Request(url, headers={
        'User-Agent': 'DreamCraft-Updater', 'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28'})
    return urllib.request.build_opener(GitHubRedirect()).open(request, timeout=20)


def check(current, kind):
    releases = []
    # Other applications share this repository. Never use /releases/latest.
    for page in range(1, 11):
        with open_github(API + f'/releases?per_page=100&page={page}') as response:
            payload = response.read(4 * 1024 * 1024 + 1)
        if len(payload) > 4 * 1024 * 1024:
            raise ValueError('Release metadata too large')
        batch = json.loads(payload)
        if not isinstance(batch, list):
            raise ValueError('Invalid release metadata')
        releases.extend(batch)
        if len(batch) < 100:
            return select_release(releases, current, kind)
    raise ValueError('Release history exceeds update lookup limit')


def installed(app_dir):
    if sys.platform != 'win32':
        return False
    import winreg
    key = r'Software\Microsoft\Windows\CurrentVersion\Uninstall\{7B50A372-A404-4B9C-9D99-73DECF6F9058}_is1'
    try:
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, key) as registry:
            location = winreg.QueryValueEx(registry, 'InstallLocation')[0]
        return Path(location).resolve() == app_dir.resolve()
    except OSError:
        return False


def download(asset, destination, progress):
    partial = destination.with_suffix(destination.suffix + '.part')
    digest = hashlib.sha256()
    received = 0
    deadline = time.monotonic() + 600
    try:
        with open_github(asset['browser_download_url']) as response, partial.open('wb') as output:
            while True:
                if time.monotonic() > deadline:
                    raise TimeoutError('Update download timed out')
                block = response.read(256 * 1024)
                if not block:
                    break
                received += len(block)
                if received > asset['size']:
                    raise ValueError('Update package exceeds declared size')
                digest.update(block)
                output.write(block)
                progress(received, asset['size'])
        if received != asset['size'] or 'sha256:' + digest.hexdigest() != asset['digest']:
            raise ValueError('Update SHA256 or size mismatch')
        partial.replace(destination)
    finally:
        partial.unlink(missing_ok=True)


def extract_portable(archive, destination):
    with zipfile.ZipFile(archive) as package:
        if len(package.infolist()) > 50000:
            raise ValueError('Too many archive entries')
        size = 0
        paths = set()
        for item in package.infolist():
            raw_name = item.orig_filename
            path = PurePosixPath(raw_name)
            if ('\\' in raw_name or ':' in raw_name or '\x00' in raw_name or path.is_absolute()
                    or '..' in path.parts or not path.parts or path.parts[0] != 'DreamCraft'
                    or (item.external_attr >> 16) & 0o170000 == 0o120000):
                raise ValueError('Unsafe update archive path')
            normalized = str(path).casefold()
            if normalized in paths or any(part.endswith((' ', '.')) for part in path.parts):
                raise ValueError('Ambiguous update archive path')
            if any(part.split('.')[0].upper() in
                   {'CON', 'PRN', 'AUX', 'NUL', *(f'COM{i}' for i in range(1, 10)),
                    *(f'LPT{i}' for i in range(1, 10))} for part in path.parts):
                raise ValueError('Reserved Windows archive filename')
            paths.add(normalized)
            size += item.file_size
            if size > 2 * 1024 * 1024 * 1024:
                raise ValueError('Expanded update exceeds size limit')
        package.extractall(destination)
    app = destination / 'DreamCraft'
    if not (app / 'DreamCraft.exe').is_file() or not (app / '_internal').is_dir():
        raise ValueError('Incomplete portable package')
    return app


def prepare(release, current, app_dir, data_dir, helper, progress, *, no_browser=False):
    if version_tuple(release['tag_name'].removeprefix('dreamcraft-v')) <= version_tuple(current):
        raise ValueError('Updates must be newer than this application')
    kind = 'installed' if installed(app_dir) else 'portable'
    if data_dir.resolve().is_relative_to(app_dir.resolve()):
        raise ValueError('Move custom runtime data outside the application before updating')
    asset = asset_for(release, kind)
    # Portable replacement must stay on the application's volume for directory renames.
    cache = Path(tempfile.mkdtemp(prefix='.dreamcraft-update-', dir=app_dir.parent))
    try:
        payload = cache / asset['name']
        download(asset, payload, progress)
        staged = extract_portable(payload, cache / 'unpacked') if kind == 'portable' else None
        if staged:
            ffmpeg = app_dir / 'ffmpeg.exe'
            if ffmpeg.is_file() and not (staged / ffmpeg.name).exists():
                shutil.copy2(ffmpeg, staged / ffmpeg.name)
        script = cache / 'apply-update.ps1'
        shutil.copy2(helper, script)
        plan = {
            'kind': kind, 'pid': os.getpid(), 'app': str(app_dir.resolve()),
            'data': str(data_dir.resolve()), 'payload': str(payload),
            'sha256': asset['digest'].removeprefix('sha256:'),
            'staged': str(staged) if staged else None,
            'version': release['tag_name'].removeprefix('dreamcraft-v'),
            'noBrowser': no_browser,
            'backup': str(app_dir.with_name(app_dir.name + '.previous-' + uuid.uuid4().hex[:8])),
        }
        plan_path = cache / 'plan.json'
        plan_path.write_text(json.dumps(plan), encoding='utf-8')
        return plan_path
    except BaseException:
        shutil.rmtree(cache)
        raise


def launch(plan_path):
    powershell = Path(os.environ['SystemRoot']) / 'System32/WindowsPowerShell/v1.0/powershell.exe'
    environment = dict(os.environ)
    # PowerShell 7's module search path can hide Windows PowerShell's built-ins.
    environment['PSModulePath'] = str(powershell.parent / 'Modules')
    environment['PYINSTALLER_RESET_ENVIRONMENT'] = '1'
    frozen = bool(getattr(sys, 'frozen', False))
    if frozen:
        import ctypes
        ctypes.windll.kernel32.SetDllDirectoryW(None)
    try:
        return subprocess.Popen([str(powershell), '-NoProfile', '-NonInteractive',
            '-ExecutionPolicy', 'Bypass', '-File', str(plan_path.parent / 'apply-update.ps1'),
            '-Plan', str(plan_path)], cwd=plan_path.parent,
            env=environment, creationflags=subprocess.CREATE_NO_WINDOW)
    finally:
        if frozen:
            ctypes.windll.kernel32.SetDllDirectoryW(str(sys._MEIPASS))
