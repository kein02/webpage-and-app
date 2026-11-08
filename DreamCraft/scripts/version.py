"""Synchronize package metadata and validate a DreamCraft release."""
import argparse
import json
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--set', dest='new_version')
    parser.add_argument('--tag')
    parser.add_argument('--resource', type=Path)
    args = parser.parse_args()
    version = args.new_version or (ROOT / 'VERSION').read_text(encoding='utf-8').strip()
    if not re.fullmatch(r'(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)', version):
        parser.error('Version must be MAJOR.MINOR.PATCH without leading zeroes')
    if any(int(part) > 65535 for part in version.split('.')):
        parser.error('Windows version components must be <= 65535')
    if args.tag and args.tag != 'dreamcraft-v' + version:
        parser.error('Tag must match VERSION: dreamcraft-v' + version)
    for name in ('package.json', 'package-lock.json'):
        path = ROOT / 'app' / 'frontend' / name
        package = json.loads(path.read_text(encoding='utf-8'))
        if args.new_version:
            package['version'] = version
            if name == 'package-lock.json':
                package['packages']['']['version'] = version
            path.write_text(json.dumps(package, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
        elif package['version'] != version or (name == 'package-lock.json' and package['packages']['']['version'] != version):
            parser.error('Package version differs; run python scripts/version.py --set ' + version)
    if args.new_version:
        (ROOT / 'VERSION').write_text(version + '\n', encoding='utf-8')
    else:
        notes = ROOT / 'docs' / 'releases' / (version + '.md')
        if not notes.is_file() or not notes.read_text(encoding='utf-8').strip():
            parser.error('Missing release notes: docs/releases/' + version + '.md')
    if args.resource:
        numbers = ','.join(version.split('.') + ['0'])
        resource = f"""VSVersionInfo(
  ffi=FixedFileInfo(filevers=({numbers}), prodvers=({numbers}), mask=0x3f, flags=0x0,
                   OS=0x40004, fileType=0x1, subtype=0x0, date=(0,0)),
  kids=[StringFileInfo([StringTable('040904B0', [
    StringStruct('CompanyName', 'DreamCraft'),
    StringStruct('FileDescription', 'DreamCraft Local Workspace'),
    StringStruct('FileVersion', '{version}.0'),
    StringStruct('InternalName', 'DreamCraft'),
    StringStruct('OriginalFilename', 'DreamCraft.exe'),
    StringStruct('ProductName', 'DreamCraft'),
    StringStruct('ProductVersion', '{version}')])]),
    VarFileInfo([VarStruct('Translation', [1033, 1200])])])
"""
        args.resource.write_text(resource, encoding='utf-8')
    print('DreamCraft ' + version)


if __name__ == '__main__':
    main()
