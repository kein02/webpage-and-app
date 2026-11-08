"""Exercise release metadata in an isolated project fixture."""
import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest


class VersionTests(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory(prefix='dreamcraft-version-')
        self.addCleanup(self.folder.cleanup)
        self.root = Path(self.folder.name)
        (self.root / 'scripts').mkdir()
        shutil.copyfile(Path(__file__).resolve().parents[1] / 'scripts' / 'version.py', self.root / 'scripts' / 'version.py')
        (self.root / 'app' / 'frontend').mkdir(parents=True)
        (self.root / 'VERSION').write_text('1.0.1\n', encoding='utf-8')
        self.package = self.root / 'app' / 'frontend' / 'package.json'
        self.package.write_text(json.dumps({'version': '1.0.1'}), encoding='utf-8')
        self.lock = self.package.with_name('package-lock.json')
        self.lock.write_text(json.dumps({'version': '1.0.1', 'packages': {'': {'version': '1.0.1'}}}), encoding='utf-8')
        (self.root / 'docs' / 'releases').mkdir(parents=True)
        (self.root / 'docs' / 'releases' / '1.0.1.md').write_text('Release notes', encoding='utf-8')

    def run_version(self, *args):
        return subprocess.run([sys.executable, str(self.root / 'scripts' / 'version.py'), *args], capture_output=True, text=True)

    def test_tag_and_generated_resource(self):
        resource = self.root / 'resource.txt'
        result = self.run_version('--tag', 'dreamcraft-v1.0.1', '--resource', str(resource))
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("StringStruct('ProductVersion', '1.0.1')", resource.read_text(encoding='utf-8'))
        self.assertIn('filevers=(1,0,1,0)', resource.read_text(encoding='utf-8'))
        self.assertNotEqual(self.run_version('--tag', 'dreamcraft-v1.0.0').returncode, 0)

    def test_update_syncs_packages_and_requires_notes(self):
        result = self.run_version('--set', '2.3.4')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual((self.root / 'VERSION').read_text(encoding='utf-8'), '2.3.4\n')
        self.assertEqual(json.loads(self.package.read_text(encoding='utf-8'))['version'], '2.3.4')
        self.assertEqual(json.loads(self.lock.read_text(encoding='utf-8'))['packages']['']['version'], '2.3.4')
        self.assertNotEqual(self.run_version().returncode, 0)
        (self.root / 'docs' / 'releases' / '2.3.4.md').write_text('Updated', encoding='utf-8')
        self.assertEqual(self.run_version().returncode, 0)

    def test_invalid_versions_do_not_modify_files(self):
        for value in ('1.0', '01.2.3', '1.2.3-beta', '65536.0.0'):
            self.assertNotEqual(self.run_version('--set', value).returncode, 0)
        self.assertEqual((self.root / 'VERSION').read_text(encoding='utf-8'), '1.0.1\n')

    def test_package_drift_blocks_release(self):
        self.package.write_text(json.dumps({'version': '9.9.9'}), encoding='utf-8')
        self.assertNotEqual(self.run_version().returncode, 0)


if __name__ == '__main__':
    unittest.main(verbosity=2)
