"""Offline archive roundtrip, hostile archive and rollback verification."""
from contextlib import closing
import json
from pathlib import Path
import sqlite3
import sys
import tempfile
import unittest
from unittest.mock import patch
import zipfile
from cryptography.fernet import Fernet

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'desktop'))
import backup


class BackupTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='dreamcraft-backup-test-')
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.data = self.root / 'data'
        self.data.mkdir()
        key = Fernet.generate_key()
        (self.data / '.engine-key').write_bytes(key)
        (self.data / '.jwt-secret').write_text('a' * 64, 'ascii')
        (self.data / '.env').write_text('LOCAL_CONFIG=test', 'ascii')
        (self.data / 'desktop.json').write_text('{"pid":123}', 'ascii')
        (self.data / 'uploads').mkdir()
        (self.data / 'exports').mkdir()
        (self.data / 'uploads' / 'test.png').write_bytes(b'image')
        (self.data / 'exports' / 'test.mp4').write_bytes(b'video')
        with closing(sqlite3.connect(self.data / 'dreamcraft.db')) as conn:
            conn.execute('CREATE TABLE users (id TEXT)')
            conn.execute("INSERT INTO users VALUES ('original')")
            conn.execute('CREATE TABLE user_engine_config(owner TEXT, video_key TEXT)')
            conn.execute('INSERT INTO user_engine_config VALUES (?,?)',
                         ('u', 'fernet:' + Fernet(key).encrypt(b'offline-key').decode()))
            conn.commit()
        self.archive = self.root / 'saved.zip'
        backup.create(self.data, self.archive, '1.1.1')

    def contents(self):
        return {p.relative_to(self.data).as_posix(): p.read_bytes()
                for p in self.data.rglob('*') if p.is_file()}

    def rewrite(self, mutate):
        with zipfile.ZipFile(self.archive) as archive:
            entries = {i.filename: archive.read(i) for i in archive.infolist()}
        mutate(entries)
        bad = self.root / 'bad.zip'
        with zipfile.ZipFile(bad, 'w') as archive:
            for name, value in entries.items():
                archive.writestr(name, value)
        return bad

    def test_roundtrip_preserves_database_media_and_key_pair(self):
        original = self.contents()
        (self.data / '.jwt-secret').write_text('b' * 64)
        (self.data / 'uploads' / 'extra').write_bytes(b'new')
        recovery = backup.restore(self.data, self.archive, '1.1.1')
        restored = self.contents()
        restored.pop('dreamcraft.db')
        original.pop('dreamcraft.db')
        self.assertEqual(restored, original)
        with closing(sqlite3.connect(self.data / 'dreamcraft.db')) as conn:
            self.assertEqual(conn.execute('SELECT id FROM users').fetchall(), [('original',)])
        with zipfile.ZipFile(recovery) as archive:
            self.assertEqual(archive.read('.jwt-secret'), b'b' * 64)
            self.assertIn('uploads/extra', archive.namelist())
        with zipfile.ZipFile(self.archive) as archive:
            self.assertNotIn('desktop.json', archive.namelist())
            self.assertIn('.engine-key', archive.namelist())

    def test_sqlite_snapshot_includes_committed_wal(self):
        with closing(sqlite3.connect(self.data / 'dreamcraft.db')) as conn:
            conn.execute('PRAGMA journal_mode=WAL')
            conn.execute("INSERT INTO users VALUES ('wal')")
            conn.commit()
            backup.create(self.data, self.root / 'wal.zip', '1.1.1')
        staged = self.root / 'wal'
        staged.mkdir()
        backup._extract(self.root / 'wal.zip', staged, '1.1.1')
        with closing(sqlite3.connect(staged / 'dreamcraft.db')) as conn:
            self.assertEqual(conn.execute('SELECT COUNT(*) FROM users').fetchone()[0], 2)

    def test_reject_corruption_and_missing_key_without_modifying_data(self):
        for mutate in (
            lambda e: e.update({'uploads/test.png': b'corrupted'}),
            lambda e: e.pop('.engine-key'),
            lambda e: e.update({'manifest.json': b'{}'}),
        ):
            bad = self.rewrite(mutate)
            before = self.contents()
            with self.assertRaises(Exception):
                backup.restore(self.data, bad, '1.1.1')
            self.assertEqual(self.contents(), before)

    def test_reject_unsafe_names_even_with_matching_manifest(self):
        for name in ('../outside', '/absolute', 'uploads/../outside', 'uploads/x:stream',
                     'uploads/CON.png', 'uploads/x.', 'uploads\\outside', 'uploads//bad'):
            def mutate(entries):
                manifest = json.loads(entries['manifest.json'])
                manifest['files'][name] = {'size': 1, 'sha256': '0' * 64}
                entries['manifest.json'] = json.dumps(manifest).encode()
                entries[name] = b'x'
            before = self.contents()
            with self.assertRaises(ValueError):
                backup.restore(self.data, self.rewrite(mutate), '1.1.1')
            self.assertEqual(self.contents(), before)

    def test_reject_newer_version_and_limits(self):
        with self.assertRaises(ValueError):
            backup.restore(self.data, self.archive, '1.0.0')
        with patch.object(backup, 'MAX_BYTES', 16), self.assertRaises(ValueError):
            backup.restore(self.data, self.archive, '1.1.1')
        with self.assertRaises(ValueError):
            backup.create(self.data, self.data / 'nested.zip', '1.1.1')

    def test_backup_rejects_mismatched_encryption_key(self):
        (self.data / '.engine-key').write_bytes(Fernet.generate_key())
        with self.assertRaises(Exception):
            backup.create(self.data, self.root / 'unusable.zip', '1.1.1')
        self.assertFalse((self.root / 'unusable.zip').exists())

    def test_rollback_after_partial_install(self):
        (self.data / 'uploads' / 'new.txt').write_bytes(b'current')
        before = self.contents()
        original = Path.replace
        def replace(path, target):
            if path.name == 'uploads' and path.parent.name == 'new':
                raise OSError('Simulated disk failure')
            return original(path, target)
        with patch.object(Path, 'replace', replace), self.assertRaises(OSError):
            backup.restore(self.data, self.archive, '1.1.1')
        self.assertEqual(self.contents(), before)
        self.assertTrue(list(self.root.glob('DreamCraft-before-restore-*.zip')))


if __name__ == '__main__':
    unittest.main(verbosity=2)
