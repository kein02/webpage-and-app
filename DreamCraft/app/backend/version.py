"""Read the release version in source, containers and frozen Windows builds."""
from pathlib import Path
import sys

_root = Path(getattr(sys, '_MEIPASS', Path(__file__).resolve().parent))
_file = _root / 'VERSION'
if not _file.is_file():
    _file = _root.parent.parent / 'VERSION'
VERSION = _file.read_text(encoding='utf-8').strip()
