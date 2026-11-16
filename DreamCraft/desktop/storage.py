"""Desktop data location and offline, verified migration."""
from contextlib import contextmanager
import hashlib
import os
from pathlib import Path
import shutil
import tempfile

REGISTRY_KEY = r"Software\DreamCraft"


def default_directory():
    return Path(os.environ.get("LOCALAPPDATA", Path.home())) / "DreamCraft"


def remembered_directory():
    import winreg
    try:
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, REGISTRY_KEY) as key:
            value, _ = winreg.QueryValueEx(key, "DataDirectory")
    except FileNotFoundError:
        return None
    return Path(value).resolve()


def data_directory(explicit=None):
    if explicit is not None:
        return Path(explicit).resolve()
    selected = remembered_directory()
    if selected is not None:
        if not selected.is_dir() or not (selected / "dreamcraft.db").is_file() or not (selected / ".jwt-secret").is_file():
            raise ValueError("数据文件夹无法访问，请连接对应磁盘后再启动：" + str(selected))
        return selected
    return default_directory().resolve()


def remember(directory):
    import winreg
    with winreg.CreateKey(winreg.HKEY_CURRENT_USER, REGISTRY_KEY) as key:
        winreg.SetValueEx(key, "DataDirectory", 0, winreg.REG_SZ, str(directory))


@contextmanager
def _lock(directory, remove=False):
    import msvcrt
    acquired = False
    path = directory / "desktop.lock"
    try:
        with path.open("a+b") as handle:
            handle.seek(0)
            try:
                msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
                acquired = True
            except OSError:
                raise ValueError("请先关闭正在使用此数据文件夹的 DreamCraft")
            try:
                yield
            finally:
                handle.seek(0)
                msvcrt.locking(handle.fileno(), msvcrt.LK_UNLCK, 1)
    finally:
        if remove and acquired:
            path.unlink(missing_ok=True)


def validate_destination(source, destination):
    source = Path(source).resolve(strict=True)
    destination = Path(destination).resolve(strict=True)
    if (source == destination or destination.is_relative_to(source)
            or source.is_relative_to(destination)):
        raise ValueError("请选择原数据目录之外的空文件夹")
    if not destination.is_dir() or any(destination.iterdir()):
        raise ValueError("请选择一个空文件夹，避免覆盖已有文件")
    with tempfile.TemporaryFile(dir=destination):
        pass
    return source, destination


def _linked(path):
    return path.is_symlink() or bool(getattr(path.lstat(), "st_file_attributes", 0) & 0x400)


def _hash(path):
    with path.open("rb") as handle:
        return hashlib.file_digest(handle, "sha256").hexdigest()


def migrate(source, destination, remember_location=False):
    source, destination = validate_destination(source, destination)
    installed = []
    committed = False
    warnings = []
    with _lock(source), _lock(destination, remove=True):
        if any(p.name != "desktop.lock" for p in destination.iterdir()):
            raise ValueError("目标文件夹已被占用，请选择一个空文件夹")
        # Check keys and SQLite before touching existing data.
        import backup
        backup._validate_data(source)
        children = [p for p in source.iterdir() if p.name != "desktop.lock"]
        entries = []
        for child in children:
            paths = [child, *child.rglob("*")] if child.is_dir() else [child]
            for path in paths:
                if _linked(path) or not path.resolve().is_relative_to(source):
                    raise ValueError("数据目录包含链接，无法安全迁移：" + str(path))
            entries.extend(paths)
        try:
            with tempfile.TemporaryDirectory(prefix=".migration-", dir=destination) as folder:
                staging = Path(folder)
                for path in entries:
                    if path.name == "output-settings.json" and path.parent == source:
                        continue
                    target = staging / path.relative_to(source)
                    if path.is_dir():
                        target.mkdir(parents=True, exist_ok=True)
                    else:
                        target.parent.mkdir(parents=True, exist_ok=True)
                        shutil.copy2(path, target)
                        if _hash(path) != _hash(target):
                            raise ValueError("文件校验失败：" + str(path))
                backup._validate_data(staging)
                for path in list(staging.iterdir()):
                    target = destination / path.name
                    path.replace(target)
                    installed.append(target)
                if remember_location:
                    remember(destination)
                committed = True
            # Only remove the old data after every copy and database check passed.
            for child in children:
                try:
                    if child.is_dir():
                        shutil.rmtree(child)
                    else:
                        child.unlink()
                except OSError as error:
                    warnings.append(str(error))
        finally:
            if not committed:
                for path in installed:
                    if path.parent != destination:
                        raise ValueError("Invalid migration cleanup path")
                    if path.is_dir():
                        shutil.rmtree(path)
                    else:
                        path.unlink()
    for path in (source / "desktop.lock", source):
        try:
            path.rmdir() if path.is_dir() else path.unlink()
        except OSError as error:
            warnings.append(str(error))
    if warnings:
        (destination / "migration-warning.txt").write_text(
            "新目录已启用，但以下旧文件未能移除：\n" + "\n".join(warnings), encoding="utf-8")
    return destination
