"""Offline desktop data archives. Call only while holding the launcher lock."""
from contextlib import closing
import hashlib
import json
import os
from pathlib import Path
import shutil
import sqlite3
import stat
import tempfile
import time
import uuid
import zipfile

FILES = ('dreamcraft.db', '.jwt-secret', '.engine-key', '.env')
DIRECTORIES = ('uploads', 'exports')
MAX_BYTES = 20 * 1024 ** 3
MAX_FILES = 100000


def _linked(path):
    return path.is_symlink() or bool(getattr(path.lstat(), 'st_file_attributes', 0) & 0x400)


def _allowed(name):
    parts = name.split('/')
    if (not name or '\\' in name or any(not p or p in ('.', '..') or
            ':' in p or p.rstrip(' .') != p or
            p.split('.')[0].upper() in {'CON', 'PRN', 'AUX', 'NUL', *(
                f'{prefix}{n}' for prefix in ('COM', 'LPT') for n in range(1, 10))}
            for p in parts)):
        return False
    return name in FILES or (len(parts) > 1 and parts[0] in DIRECTORIES)


def _hash(path):
    with path.open('rb') as source:
        return hashlib.file_digest(source, 'sha256').hexdigest()


def _database(path):
    with closing(sqlite3.connect(path.as_uri() + '?mode=ro', uri=True)) as conn:
        if conn.execute('PRAGMA quick_check').fetchone()[0] != 'ok':
            raise ValueError('备份数据库损坏')


def create(data, destination, version):
    data, destination = Path(data).resolve(), Path(destination).resolve()
    if destination.is_relative_to(data):
        raise ValueError('请将备份保存到数据目录之外')
    destination.parent.mkdir(parents=True, exist_ok=True)
    paths = [data / name for name in FILES if (data / name).exists()]
    for name in DIRECTORIES:
        folder = data / name
        if folder.exists() and _linked(folder):
            raise ValueError('数据目录不能使用链接')
        if folder.exists():
            paths += list(folder.rglob('*'))
    paths = [p for p in paths if not p.is_dir() or _linked(p)]
    if len(paths) > MAX_FILES or sum(p.stat().st_size for p in paths) > MAX_BYTES:
        raise ValueError('备份超过 100000 个文件或 20GB')
    with tempfile.TemporaryDirectory(prefix='dreamcraft-backup-', dir=destination.parent) as folder:
        staging = Path(folder)
        entries = {}
        for source in paths:
            name = source.relative_to(data).as_posix()
            if (not _allowed(name) or _linked(source)
                    or not source.resolve().is_relative_to(data)):
                raise ValueError('数据目录包含无效路径或链接')
            target = staging / name
            target.parent.mkdir(parents=True, exist_ok=True)
            if name == 'dreamcraft.db':
                with closing(sqlite3.connect(source.as_uri() + '?mode=ro', uri=True)) as src, closing(sqlite3.connect(target)) as dst:
                    src.backup(dst)
                _database(target)
            else:
                shutil.copyfile(source, target)
            entries[name] = {'size': target.stat().st_size, 'sha256': _hash(target)}
        if 'dreamcraft.db' not in entries or '.jwt-secret' not in entries:
            raise ValueError('数据尚未初始化，无法备份')
        _validate_data(staging)
        manifest = {'format': 'dreamcraft-backup', 'schema': 1, 'version': version,
                    'created_at': int(time.time()), 'files': entries}
        temporary = destination.with_name(destination.name + '.' + uuid.uuid4().hex + '.tmp')
        try:
            with zipfile.ZipFile(temporary, 'w', zipfile.ZIP_DEFLATED, allowZip64=True) as archive:
                archive.writestr('manifest.json', json.dumps(manifest))
                for name in entries:
                    archive.write(staging / name, name)
            os.replace(temporary, destination)
        finally:
            temporary.unlink(missing_ok=True)
    return destination


def _extract(archive_path, target, version):
    with zipfile.ZipFile(archive_path) as archive:
        infos = archive.infolist()
        names = [i.filename for i in infos]
        if (len(infos) > MAX_FILES + 1 or len({n.casefold() for n in names}) != len(names)
                or 'manifest.json' not in names
                or sum(i.file_size for i in infos) > MAX_BYTES
                or archive.getinfo('manifest.json').file_size > 32 * 1024 * 1024):
            raise ValueError('备份清单无效或超过大小上限')
        manifest = json.loads(archive.read('manifest.json'))
        if (manifest.get('format') != 'dreamcraft-backup' or manifest.get('schema') != 1
                or not isinstance(manifest.get('files'), dict)):
            raise ValueError('不是支持的 DreamCraft 备份')
        try:
            if tuple(map(int, manifest['version'].split('.'))) > tuple(map(int, version.split('.'))):
                raise ValueError('备份来自更高版本，请先升级 DreamCraft')
        except (KeyError, AttributeError):
            raise ValueError('备份版本无效')
        entries = manifest['files']
        if set(names) != {'manifest.json', *entries} or not {'dreamcraft.db', '.jwt-secret'} <= set(entries):
            raise ValueError('备份文件不完整')
        for info in infos:
            if info.filename == 'manifest.json':
                continue
            name = info.filename
            if (not _allowed(name) or info.is_dir() or
                    stat.S_IFMT(info.external_attr >> 16) not in (0, stat.S_IFREG)):
                raise ValueError('备份包含不安全路径或链接')
            path = target / name
            path.parent.mkdir(parents=True, exist_ok=True)
            with archive.open(info) as src, path.open('wb') as dst:
                shutil.copyfileobj(src, dst)
            expected = entries[name]
            if path.stat().st_size != expected['size'] or _hash(path) != expected['sha256']:
                raise ValueError('备份文件校验失败：' + name)
    _validate_data(target)
    return manifest


def _validate_data(target):
    _database(target / 'dreamcraft.db')
    if not (target / '.jwt-secret').read_text('ascii').strip():
        raise ValueError('登录密钥无效')
    with closing(sqlite3.connect(target / 'dreamcraft.db')) as conn:
        tables = {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        if 'user_engine_config' in tables:
            from cryptography.fernet import Fernet
            rows = conn.execute('SELECT * FROM user_engine_config')
            fields = [c[0] for c in rows.description]
            encrypted = [v for row in rows for key, v in zip(fields, row)
                         if key in ('agnes_key', 'video_key') and v and v.startswith('fernet:')]
            if encrypted:
                cipher = Fernet((target / '.engine-key').read_bytes().strip())
                for value in encrypted:
                    cipher.decrypt(value[7:].encode())


def restore(data, archive_path, version):
    data, archive_path = Path(data).resolve(), Path(archive_path).resolve()
    if archive_path.is_relative_to(data):
        raise ValueError('请先将备份文件移到数据目录之外')
    # Stage and verify everything before touching current data.
    with tempfile.TemporaryDirectory(prefix='dreamcraft-restore-', dir=data.parent) as folder:
        staging = Path(folder) / 'new'
        staging.mkdir()
        _extract(archive_path, staging, version)
        recovery = data.parent / ('DreamCraft-before-restore-' + time.strftime('%Y%m%d-%H%M%S') + '-' + uuid.uuid4().hex[:6] + '.zip')
        create(data, recovery, version)
        old = Path(folder) / 'old'
        old.mkdir()
        moved, installed = [], []
        names = (*FILES, *DIRECTORIES, 'dreamcraft.db-wal', 'dreamcraft.db-shm')
        try:
            for name in names:
                source = data / name
                if source.exists():
                    source.replace(old / name)
                    moved.append(name)
            for name in (*FILES, *DIRECTORIES):
                source = staging / name
                if source.exists():
                    source.replace(data / name)
                    installed.append(name)
        except Exception:
            for name in installed:
                path = data / name
                if path.is_dir():
                    shutil.rmtree(path)
                else:
                    path.unlink()
            for name in moved:
                (old / name).replace(data / name)
            raise
    return recovery
