"""Offline migration verifies data before removing old files."""
from contextlib import closing
import json
from pathlib import Path
import sqlite3
import sys
import tempfile
import unittest
import uuid
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "desktop"))
import storage


class StorageTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.source = self.root / "old"
        self.target = self.root / "new"
        self.source.mkdir()
        self.target.mkdir()
        (self.source / "exports").mkdir()
        (self.source / "uploads").mkdir()
        (self.source / ".jwt-secret").write_text("secret", encoding="ascii")
        (self.source / ".engine-key").write_bytes(b"key")
        (self.source / ".env").write_text("PRIVATE_KEY=value", encoding="ascii")
        (self.source / "exports" / "video.mp4").write_bytes(b"video")
        (self.source / "uploads" / "input.png").write_bytes(b"image")
        with closing(sqlite3.connect(self.source / "dreamcraft.db")) as conn:
            conn.execute("CREATE TABLE projects(name TEXT)")
            conn.execute("INSERT INTO projects VALUES ('kept')")
            conn.commit()

    def test_all_data_is_moved_without_old_copy(self):
        (self.source / "output-settings.json").write_text(json.dumps({"directory": "obsolete"}))
        with patch.object(storage, "remember") as remember:
            storage.migrate(self.source, self.target, remember_location=True)
        remember.assert_called_once_with(self.target)
        self.assertFalse(self.source.exists())
        self.assertFalse((self.target / "output-settings.json").exists())
        self.assertEqual((self.target / "exports" / "video.mp4").read_bytes(), b"video")
        self.assertEqual((self.target / ".engine-key").read_bytes(), b"key")
        with closing(sqlite3.connect(self.target / "dreamcraft.db")) as conn:
            self.assertEqual(conn.execute("SELECT name FROM projects").fetchone()[0], "kept")

    def test_copy_failure_preserves_source_and_cleans_target(self):
        with patch.object(storage.shutil, "copy2", side_effect=OSError("full disk")):
            with self.assertRaises(OSError):
                storage.migrate(self.source, self.target)
        self.assertEqual((self.source / "exports" / "video.mp4").read_bytes(), b"video")
        self.assertFalse(list(self.target.iterdir()))

    def test_hash_mismatch_preserves_source(self):
        with patch.object(storage, "_hash", side_effect=["original", "corrupt"]):
            with self.assertRaises(ValueError):
                storage.migrate(self.source, self.target)
        self.assertTrue((self.source / "dreamcraft.db").exists())
        self.assertFalse(list(self.target.iterdir()))

    def test_registry_failure_rolls_back_target(self):
        with patch.object(storage, "remember", side_effect=OSError("registry denied")):
            with self.assertRaises(OSError):
                storage.migrate(self.source, self.target, remember_location=True)
        self.assertTrue((self.source / ".jwt-secret").exists())
        self.assertFalse(list(self.target.iterdir()))

    def test_destination_must_be_empty_and_separate(self):
        for target in (self.source, self.root):
            with self.assertRaises(ValueError):
                storage.validate_destination(self.source, target)
        nested = self.source / "nested"
        nested.mkdir()
        with self.assertRaises(ValueError):
            storage.validate_destination(self.source, nested)
        (self.target / "keep.txt").write_text("keep")
        with self.assertRaises(ValueError):
            storage.migrate(self.source, self.target)
        self.assertEqual((self.target / "keep.txt").read_text(), "keep")

    def test_running_source_cannot_be_migrated(self):
        with storage._lock(self.source):
            with self.assertRaises(ValueError):
                storage.migrate(self.source, self.target)
        self.assertFalse(list(self.target.iterdir()))

    def test_explicit_directory_is_isolated_from_registry(self):
        with patch.object(storage, "remembered_directory") as remembered:
            self.assertEqual(storage.data_directory(self.source), self.source)
        remembered.assert_not_called()

    def test_selected_missing_disk_does_not_create_new_database(self):
        with patch.object(storage, "remembered_directory", return_value=self.root / "missing"):
            with self.assertRaises(ValueError):
                storage.data_directory()
        self.assertFalse((self.root / "missing").exists())

    def test_selected_location_is_used_on_restart(self):
        with patch.object(storage, "remembered_directory", return_value=self.source):
            self.assertEqual(storage.data_directory(), self.source)

    def test_empty_selected_disk_does_not_initialize_new_accounts(self):
        with patch.object(storage, "remembered_directory", return_value=self.target):
            with self.assertRaises(ValueError):
                storage.data_directory()
        self.assertFalse(list(self.target.iterdir()))

    def test_registry_roundtrip_in_isolated_key(self):
        import winreg
        key_name = r"Software\DreamCraft-StorageTest-" + uuid.uuid4().hex
        try:
            with patch.object(storage, "REGISTRY_KEY", key_name):
                storage.remember(self.source)
                self.assertEqual(storage.data_directory(), self.source)
        finally:
            winreg.DeleteKey(winreg.HKEY_CURRENT_USER, key_name)

    def test_partial_install_failure_preserves_source(self):
        replace = Path.replace
        calls = 0
        def fail_second(path, target):
            nonlocal calls
            calls += 1
            if calls == 2:
                raise OSError("installation interrupted")
            return replace(path, target)
        with patch.object(Path, "replace", fail_second):
            with self.assertRaises(OSError):
                storage.migrate(self.source, self.target)
        self.assertTrue((self.source / "dreamcraft.db").exists())
        self.assertEqual((self.source / "exports" / "video.mp4").read_bytes(), b"video")
        self.assertFalse(list(self.target.iterdir()))

    def test_linked_entries_are_rejected(self):
        with patch.object(storage, "_linked", return_value=True):
            with self.assertRaises(ValueError):
                storage.migrate(self.source, self.target)
        self.assertTrue((self.source / "dreamcraft.db").exists())
        self.assertFalse(list(self.target.iterdir()))


if __name__ == "__main__":
    unittest.main()
