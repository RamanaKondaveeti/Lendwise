#!/usr/bin/env python3
"""Host-side GroupBuk database and optional persistent-file backup utility."""

import argparse
import datetime as dt
import gzip
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tarfile
import tempfile
import zlib


def read_env(path):
    values = {}
    for raw in Path(path).read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("export "):
            line = line[7:].lstrip()
        if "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        if not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", key):
            continue
        value = value.strip()
        if value[:1] in ("'", '"') and value[-1:] == value[:1]:
            value = value[1:-1]
        elif " #" in value:
            value = value.split(" #", 1)[0].rstrip()
        values[key] = value
    return values


def mysql_defaults(values):
    handle = tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", delete=False)
    try:
        os.chmod(handle.name, 0o600)
        handle.write("[client]\n")
        for key, value in (("user", values["DB_USER"]), ("password", values["DB_PASSWORD"]),
                           ("host", values.get("DB_HOST", "127.0.0.1")),
                           ("port", values.get("DB_PORT", "3306"))):
            escaped = value.replace("\\", "\\\\").replace('"', '\\"').replace("\n", "\\n")
            handle.write(f'{key}="{escaped}"\n')
        handle.close()
        return Path(handle.name)
    except Exception:
        handle.close()
        Path(handle.name).unlink(missing_ok=True)
        raise


def run_checked(command, **kwargs):
    try:
        return subprocess.run(command, check=True, **kwargs)
    except FileNotFoundError as exc:
        raise RuntimeError(f"Required command not found: {command[0]}") from exc
    except subprocess.CalledProcessError as exc:
        raise RuntimeError(f"Command failed ({command[0]}, exit {exc.returncode})") from exc


def validate_dump(path):
    try:
        with gzip.open(path, "rt", encoding="utf-8", errors="replace") as stream:
            has_table = False
            completed = False
            for chunk in iter(lambda: stream.read(1024 * 1024), ""):
                has_table = has_table or "CREATE TABLE" in chunk
                completed = completed or "Dump completed on" in chunk
        if not has_table or not completed:
            raise RuntimeError("Dump validation failed: expected table definitions and mysqldump completion marker")
    except (OSError, EOFError, gzip.BadGzipFile, zlib.error) as exc:
        raise RuntimeError(f"Dump validation failed: {exc}") from exc


def sha256(path):
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def persistent_file_filter(member):
    parts = Path(member.name).parts
    excluded_dirs = {".cache", "cache", "tmp", "temp", "node_modules"}
    if any(part.lower() in excluded_dirs for part in parts):
        return None
    if member.name.endswith((".tmp", ".temp", "~")) or not (member.isfile() or member.isdir()):
        return None
    return member


def backup(args, values):
    required = ("DB_NAME", "DB_USER", "DB_PASSWORD")
    if any(not values.get(k) for k in required):
        raise RuntimeError("Env file must define DB_NAME, DB_USER, and DB_PASSWORD")
    backup_root = Path(args.backup_dir or values.get("BACKUP_DIR", "/var/backups/groupbuk")).expanduser().resolve()
    retention = int(args.retention_days if args.retention_days is not None else values.get("BACKUP_RETENTION_DAYS", "14"))
    if retention < 1:
        raise RuntimeError("BACKUP_RETENTION_DAYS must be at least 1")
    backup_root.mkdir(mode=0o700, parents=True, exist_ok=True)
    os.chmod(backup_root, 0o700)
    stamp = dt.datetime.now(dt.timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    final = backup_root / f"groupbuk-{stamp}"
    if final.exists():
        raise RuntimeError(f"Backup already exists: {final}")
    work = Path(tempfile.mkdtemp(prefix=".groupbuk-backup-", dir=backup_root))
    os.chmod(work, 0o700)
    defaults = mysql_defaults(values)
    try:
        sql_path = work / "database.sql"
        command = ["mysqldump", f"--defaults-extra-file={defaults}", "--single-transaction",
                   "--quick", "--routines", "--triggers", "--events", "--hex-blob",
                   "--no-tablespaces", "--skip-add-drop-table", values["DB_NAME"]]
        with sql_path.open("wb") as output:
            run_checked(command, stdout=output, stderr=subprocess.PIPE)
        if sql_path.stat().st_size == 0:
            raise RuntimeError("mysqldump produced an empty file")
        dump_path = work / "database.sql.gz"
        with sql_path.open("rb") as source, gzip.open(dump_path, "wb", compresslevel=6) as target:
            shutil.copyfileobj(source, target)
        sql_path.unlink()
        validate_dump(dump_path)

        files_path = None
        uploads = args.files_path or values.get("BACKUP_FILES_PATH")
        if uploads:
            source = Path(uploads).expanduser().resolve()
            if not source.is_dir():
                raise RuntimeError(f"Configured BACKUP_FILES_PATH is not a directory: {source}")
            files_path = work / "application-files.tar.gz"
            with tarfile.open(files_path, "w:gz") as archive:
                archive.add(source, arcname=source.name, recursive=True, filter=persistent_file_filter)
            with tarfile.open(files_path, "r:gz") as archive:
                if not archive.getmembers():
                    raise RuntimeError("Application files archive is empty")

        manifest = {"created_utc": stamp, "database": values["DB_NAME"],
                    "database_file": dump_path.name, "sha256": {dump_path.name: sha256(dump_path)},
                    "application_files_included": files_path is not None}
        if files_path:
            manifest["files_archive"] = files_path.name
            manifest["sha256"][files_path.name] = sha256(files_path)
        (work / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
        os.chmod(work / "manifest.json", 0o600)
        os.replace(work, final)
        work = None

        # Rotate only after the complete new backup passed validation and was published.
        cutoff = dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=retention)
        for candidate in backup_root.glob("groupbuk-????????T??????Z"):
            try:
                created = dt.datetime.strptime(candidate.name.removeprefix("groupbuk-"), "%Y%m%dT%H%M%SZ").replace(tzinfo=dt.timezone.utc)
            except ValueError:
                continue
            if candidate.is_dir() and created < cutoff:
                shutil.rmtree(candidate)
        print(f"Backup completed and validated: {final}")
    finally:
        defaults.unlink(missing_ok=True)
        if work and work.exists():
            shutil.rmtree(work)


def verify(args):
    directory = Path(args.backup).expanduser().resolve()
    manifest_path = directory / "manifest.json"
    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise RuntimeError(f"Cannot read backup manifest: {exc}") from exc
    checksums = manifest.get("sha256")
    dump_name = manifest.get("database_file")
    if not isinstance(checksums, dict) or not isinstance(dump_name, str) or dump_name not in checksums:
        raise RuntimeError("Backup manifest is missing the database checksum")
    for name, expected in checksums.items():
        if not isinstance(name, str) or Path(name).name != name or not isinstance(expected, str):
            raise RuntimeError("Backup manifest contains an invalid checksum entry")
        path = (directory / name).resolve()
        if path.parent != directory or not path.is_file() or sha256(path) != expected:
            raise RuntimeError(f"Backup checksum validation failed: {name}")
    dump = directory / dump_name
    validate_dump(dump)
    if manifest.get("files_archive"):
        if not isinstance(manifest["files_archive"], str) or manifest["files_archive"] not in checksums:
            raise RuntimeError("Backup manifest is missing the application-files checksum")
        archive_path = directory / manifest["files_archive"]
        try:
            with tarfile.open(archive_path, "r:gz") as archive:
                if not archive.getmembers():
                    raise RuntimeError("Application files archive is empty")
        except (OSError, tarfile.TarError) as exc:
            raise RuntimeError(f"Application files archive validation failed: {exc}") from exc
    print(f"Backup verified (checksums and archive structure): {directory}")


def restore(args, values):
    target = args.target
    if not re.fullmatch(r"[A-Za-z0-9_]{1,64}", target):
        raise RuntimeError("Target database name may contain only letters, digits, and underscores")
    if target == values.get("DB_NAME"):
        raise RuntimeError("Refusing to restore over the configured application database")
    if args.confirm_target != target:
        raise RuntimeError(f"Restore requires --confirm-target {target}")
    directory = Path(args.backup).expanduser().resolve()
    verify(argparse.Namespace(backup=str(directory)))
    defaults = mysql_defaults(values)
    try:
        dump = directory / "database.sql.gz"
        tables = run_checked(["mysql", f"--defaults-extra-file={defaults}", "--batch",
                              "--skip-column-names", "--execute=SHOW TABLES", target],
                             capture_output=True, text=True).stdout.strip()
        if tables:
            raise RuntimeError("Refusing to import into a database that already contains tables")
        # Stream the SQL into the explicitly named existing target; no DROP/CREATE is issued.
        with gzip.open(dump, "rb") as source:
            run_checked(["mysql", f"--defaults-extra-file={defaults}", target], stdin=source, stderr=subprocess.PIPE)
    finally:
        defaults.unlink(missing_ok=True)
    print(f"Database restore imported into {target}; run the documented consistency checks before use.")


def restore_files(args):
    directory = Path(args.backup).expanduser().resolve()
    verify(argparse.Namespace(backup=str(directory)))
    manifest = json.loads((directory / "manifest.json").read_text(encoding="utf-8"))
    archive_name = manifest.get("files_archive")
    if not archive_name:
        raise RuntimeError("This backup does not contain application files")
    target = Path(args.target).expanduser().resolve()
    if str(target) != args.confirm_target:
        raise RuntimeError(f"Restore requires --confirm-target {target}")
    if target.exists() and (not target.is_dir() or any(target.iterdir())):
        raise RuntimeError("File restore target must be a new or empty directory")
    target.mkdir(mode=0o700, parents=True, exist_ok=True)
    archive_path = directory / archive_name
    try:
        with tarfile.open(archive_path, "r:gz") as archive:
            root = target.resolve()
            for member in archive.getmembers():
                destination = (target / member.name).resolve()
                if destination != root and root not in destination.parents:
                    raise RuntimeError("Refusing unsafe path in application files archive")
                if member.issym() or member.islnk() or not (member.isfile() or member.isdir()):
                    raise RuntimeError("Refusing links or special files in application files archive")
            archive.extractall(target)
    except tarfile.TarError as exc:
        raise RuntimeError(f"Application files restore failed: {exc}") from exc
    print(f"Application files restored to {target}; verify ownership and application consistency before use.")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--env-file", default=".env", help="Deployment env file (default: .env)")
    sub = parser.add_subparsers(dest="command", required=True)
    b = sub.add_parser("backup", help="Create and validate a timestamped backup")
    b.add_argument("--backup-dir")
    b.add_argument("--retention-days", type=int)
    b.add_argument("--files-path", help="Optional persistent upload/document directory")
    v = sub.add_parser("verify", help="Validate checksums, gzip dump, and optional tar archive")
    v.add_argument("backup")
    r = sub.add_parser("restore-db", help="Import into a separate, already-created database")
    r.add_argument("backup")
    r.add_argument("target", help="Existing non-production target database")
    r.add_argument("--confirm-target", required=True, help="Must exactly match target database name")
    f = sub.add_parser("restore-files", help="Restore files into a new or empty directory")
    f.add_argument("backup")
    f.add_argument("target", help="New or empty destination directory")
    f.add_argument("--confirm-target", required=True, help="Must exactly match resolved target path")
    args = parser.parse_args()
    try:
        values = read_env(args.env_file) if args.command in ("backup", "restore-db") else {}
        if args.command == "backup":
            backup(args, values)
        elif args.command == "verify":
            verify(args)
        elif args.command == "restore-db":
            restore(args, values)
        else:
            restore_files(args)
    except (RuntimeError, OSError, ValueError) as exc:
        print(f"Backup operation failed: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
