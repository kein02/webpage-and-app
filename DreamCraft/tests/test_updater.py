"""Updater trust boundaries without network access or installed application changes."""
import copy
import hashlib
import io
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch
import zipfile

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'desktop'))
import updater


def release(version='1.2.0', kind='portable', content=b'package'):
    name = f'DreamCraft-{"Setup" if kind == "installed" else "Windows"}-{version}-x64'
    name += '.exe' if kind == 'installed' else '.zip'
    return {'tag_name': 'dreamcraft-v' + version, 'draft': False, 'prerelease': False,
            'assets': [{'name': name, 'size': len(content),
                        'digest': 'sha256:' + hashlib.sha256(content).hexdigest(),
                        'browser_download_url': f'https://github.com/{updater.REPOSITORY}/releases/download/dreamcraft-v{version}/{name}'}]}


class UpdateTests(unittest.TestCase):
    def test_versions_and_monorepo(self):
        entries = [release('1.9.0'), release('1.10.0'), release('1.8.0'),
                   {'tag_name': 'dreamforge-v99.0.0'},
                   dict(release('9.0.0'), prerelease=True),
                   dict(release('8.0.0'), draft=True),
                   {'tag_name': 'dreamcraft-v2.0.0-beta'}]
        self.assertEqual(updater.select_release(entries, '1.8.0', 'portable')['tag_name'], 'dreamcraft-v1.10.0')
        self.assertIsNone(updater.select_release(entries, '2.0.0', 'portable'))
        for value in ('1.0', '01.0.0', 'v1.0.0', '1.0.0-rc', '1.0.0\n'):
            with self.assertRaises(ValueError):
                updater.version_tuple(value)

    def test_reject_bad_metadata(self):
        good = release()
        for field, value in [('digest', None), ('digest', 'sha1:123'), ('size', 0),
                             ('size', updater.MAX_PACKAGE + 1),
                             ('browser_download_url', 'http://github.com/file'),
                             ('browser_download_url', 'https://github.com.evil.test/file')]:
            bad = copy.deepcopy(good)
            bad['assets'][0][field] = value
            with self.assertRaises(ValueError):
                updater.select_release([bad], '1.0.0', 'portable')
        with self.assertRaises(ValueError):
            updater.asset_for(good, 'installed')
        bad = copy.deepcopy(good)
        bad['assets'] *= 2
        with self.assertRaises(ValueError):
            updater.asset_for(bad, 'portable')

    def test_newest_incomplete_does_not_offer_older_release(self):
        bad = release('2.0.0')
        bad['assets'] = []
        with self.assertRaises(ValueError):
            updater.select_release([bad, release()], '1.0.0', 'portable')

    def test_pages_do_not_use_global_latest(self):
        page = [{'tag_name': 'other-v1.0.0'}] * 100
        with patch.object(updater, 'open_github', side_effect=[
                io.BytesIO(json.dumps(page).encode()),
                io.BytesIO(json.dumps([release()]).encode())]) as fetch:
            self.assertEqual(updater.check('1.0.0', 'portable')['tag_name'], 'dreamcraft-v1.2.0')
            self.assertIn('page=2', fetch.call_args.args[0])

    def test_redirect_restriction(self):
        handler = updater.GitHubRedirect()
        for url in ('http://github.com/file', 'https://evil.test/file', 'https://github.com.evil.test/file'):
            with self.assertRaises(ValueError):
                handler.redirect_request(None, None, 302, '', {}, url)

    def test_download_integrity_and_atomic_cleanup(self):
        asset = release()['assets'][0]
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / asset['name']
            path.write_bytes(b'previous')
            with patch.object(updater, 'open_github', return_value=io.BytesIO(b'corrupt')):
                with self.assertRaises(ValueError):
                    updater.download(asset, path, lambda *_: None)
            self.assertEqual(path.read_bytes(), b'previous')
            self.assertFalse(path.with_suffix('.zip.part').exists())
            events = []
            with patch.object(updater, 'open_github', return_value=io.BytesIO(b'package')):
                updater.download(asset, path, lambda *args: events.append(args))
            self.assertEqual(path.read_bytes(), b'package')
            self.assertEqual(events[-1], (7, 7))

    def test_archive_traversal(self):
        for name in ('../outside', '/DreamCraft/evil', 'DreamCraft/../../escape',
                     'DreamCraft/evil:stream', 'DreamCraft\\evil', 'other/file'):
            with tempfile.TemporaryDirectory() as folder:
                path = Path(folder) / 'app.zip'
                with zipfile.ZipFile(path, 'w') as archive:
                    entry = zipfile.ZipInfo('entry')
                    entry.filename = name
                    archive.writestr(entry, b'x')
                with self.assertRaises(ValueError):
                    updater.extract_portable(path, Path(folder) / 'unpacked')
                self.assertFalse((Path(folder) / 'unpacked').exists())

    def test_prepare_preserves_data_and_ffmpeg(self):
        content = io.BytesIO()
        with zipfile.ZipFile(content, 'w') as archive:
            archive.writestr('DreamCraft/DreamCraft.exe', b'new exe')
            archive.writestr('DreamCraft/_internal/runtime', b'new runtime')
        with tempfile.TemporaryDirectory() as folder:
            folder = Path(folder)
            app, data = folder / 'app', folder / 'data'
            app.mkdir()
            data.mkdir()
            (app / 'DreamCraft.exe').write_bytes(b'old exe')
            (app / 'ffmpeg.exe').write_bytes(b'ffmpeg')
            (data / '.engine-key').write_text('keep')
            helper = folder / 'helper.ps1'
            helper.write_text('helper')
            with patch.object(updater, 'open_github', return_value=io.BytesIO(content.getvalue())):
                plan_path = updater.prepare(release(content=content.getvalue()), '1.0.0',
                                            app, data, helper, lambda *_: None)
            plan = json.loads(plan_path.read_text())
            self.assertEqual(plan['kind'], 'portable')
            self.assertEqual((Path(plan['staged']) / 'ffmpeg.exe').read_bytes(), b'ffmpeg')
            self.assertEqual((app / 'DreamCraft.exe').read_bytes(), b'old exe')
            self.assertEqual((data / '.engine-key').read_text(), 'keep')
            with self.assertRaises(ValueError):
                updater.prepare(release('1.0.0'), '1.0.0', app, data, helper, lambda *_: None)
            with self.assertRaises(ValueError):
                updater.prepare(release(), '1.0.0', app, app / 'data', helper, lambda *_: None)

    @unittest.skipUnless(sys.platform == 'win32', 'Windows process launch')
    def test_helper_environment(self):
        with patch.dict(os.environ, {'PSModulePath': 'incompatible modules'}):
            with patch.object(updater.subprocess, 'Popen') as spawn:
                updater.launch(Path('C:/App/.dreamcraft-update-test/plan.json'))
        environment = spawn.call_args.kwargs['env']
        self.assertNotIn('incompatible', environment['PSModulePath'])
        self.assertEqual(environment['PYINSTALLER_RESET_ENVIRONMENT'], '1')
        self.assertIn('-NonInteractive', spawn.call_args.args[0])


if __name__ == '__main__':
    unittest.main()
