import gzip
import json
from pathlib import Path
import tempfile
import unittest
from unittest import mock

import groupbuk_backup as backup


class BackupTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.env_path = self.root / ".env"
        self.env_path.write_text(
            "DB_NAME=groupbuk_test\nDB_USER=backup_user\nDB_PASSWORD=secret-for-test\n"
            "DB_HOST=127.0.0.1\nDB_PORT=3306\nBACKUP_RETENTION_DAYS=1\n",
            encoding="utf-8",
        )
        self.values = backup.read_env(self.env_path)
        self.backup_dir = self.root / "backups"

    def tearDown(self):
        self.temp.cleanup()

    def fake_dump(self, command, **kwargs):
        self.assertIn("--single-transaction", command)
        self.assertTrue(command[1].startswith("--defaults-extra-file="))
        self.assertNotIn("secret-for-test", " ".join(command))
        defaults_path = Path(command[1].split("=", 1)[1])
        self.assertEqual(defaults_path.stat().st_mode & 0o777, 0o600)
        kwargs["stdout"].write(
            b"-- MySQL dump\nCREATE TABLE `expenses` (`id` int);\n-- Dump completed on 2026-01-01\n"
        )

    def test_success_creates_verifiable_backup_and_rotates_expired_only_after_success(self):
        self.backup_dir.mkdir()
        expired = self.backup_dir / "groupbuk-20200101T000000Z"
        expired.mkdir()
        args = type("Args", (), {"backup_dir": str(self.backup_dir), "retention_days": 1, "files_path": None})()
        with mock.patch.object(backup, "run_checked", side_effect=self.fake_dump):
            backup.backup(args, self.values)
        backups = list(self.backup_dir.glob("groupbuk-????????T??????Z"))
        self.assertEqual(len(backups), 1)
        self.assertFalse(expired.exists())
        backup.verify(type("Args", (), {"backup": str(backups[0])})())
        manifest = json.loads((backups[0] / "manifest.json").read_text(encoding="utf-8"))
        self.assertEqual(manifest["database"], "groupbuk_test")

    def test_failed_dump_does_not_delete_expired_backup(self):
        self.backup_dir.mkdir()
        expired = self.backup_dir / "groupbuk-20200101T000000Z"
        expired.mkdir()
        args = type("Args", (), {"backup_dir": str(self.backup_dir), "retention_days": 1, "files_path": None})()
        with mock.patch.object(backup, "run_checked", side_effect=RuntimeError("mocked dump failure")):
            with self.assertRaisesRegex(RuntimeError, "mocked dump failure"):
                backup.backup(args, self.values)
        self.assertTrue(expired.is_dir())

    def test_corrupt_dump_is_rejected(self):
        path = self.root / "broken.sql.gz"
        with gzip.open(path, "wb") as stream:
            stream.write(b"partial content")
        with self.assertRaisesRegex(RuntimeError, "validation failed"):
            backup.validate_dump(path)

    def test_database_restore_requires_distinct_confirmed_target(self):
        args = type("Args", (), {"target": "groupbuk_test", "confirm_target": "groupbuk_test", "backup": "unused"})()
        with self.assertRaisesRegex(RuntimeError, "configured application database"):
            backup.restore(args, self.values)

    def test_file_filter_excludes_temporary_and_link_entries(self):
        member = type("Member", (), {"name": "uploads/cache/image.png", "isfile": lambda self: True,
                                      "isdir": lambda self: False})()
        self.assertIsNone(backup.persistent_file_filter(member))


if __name__ == "__main__":
    unittest.main()
