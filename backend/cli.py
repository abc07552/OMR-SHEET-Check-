"""Trusted-server maintenance. No credentials are accepted as CLI arguments."""

from __future__ import annotations

import argparse
import getpass
import json
import os
import sqlite3
from pathlib import Path

from sqlalchemy import delete, func, select

from . import models as m
from .config import Settings
from .db import engine_for, migrate, sessions_for
from .schemas import Workspace
from .security import audit, hash_password
from .workspaces import persist_workspace


def migrate_node(source: Path, settings: Settings):
    source = source.resolve()
    if not source.is_file():
        raise ValueError("The source Node SQLite database does not exist. Nothing was created or changed.")
    if (
        settings.database_url.startswith("sqlite:///")
        and Path(settings.database_url.removeprefix("sqlite:///")).resolve() == source
    ):
        raise ValueError(
            "Source and enterprise destination must be different databases. The source was not opened for writing."
        )
    engine = engine_for(settings)
    migrate(engine)
    with sessions_for(engine)() as db:
        if db.scalar(select(func.count()).select_from(m.User)) or db.scalar(select(func.count()).select_from(m.School)):
            raise ValueError("Import is allowed only into an empty enterprise database.")
        old = sqlite3.connect(f"file:{source}?mode=ro", uri=True)
        old.row_factory = sqlite3.Row
        # Consistent SQLite backup includes any WAL state, without modifying the source.
        safety = settings.data_dir / f"node-before-migration-{m.uid()}.sqlite"
        with sqlite3.connect(safety) as destination:
            old.backup(destination)
        safety.chmod(0o600)
        users = list(old.execute("SELECT * FROM users"))
        schools = list(old.execute("SELECT * FROM schools"))
        for row in schools:
            db.add(
                m.School(id=row["id"], name=row["name"], code=row["code"], address=row["address"], teacher="Educator")
            )
        for row in users:
            db.add(
                m.User(
                    id=row["id"],
                    name=row["name"],
                    email=row["email"].lower(),
                    password_hash="legacy$" + row["password_hash"],
                    super_admin=bool(row["owner"]),
                    active=True,
                )
            )
        db.flush()
        for row in old.execute("SELECT * FROM workspaces"):
            payload = json.loads(row["payload"])
            validated = Workspace.model_validate(payload)
            persist_workspace(db, row["school_id"], validated.model_dump(mode="json", by_alias=True, exclude_none=True))
            db.get(m.School, row["school_id"]).revision = row["revision"] + 1
        for row in old.execute("SELECT * FROM memberships"):
            # Legacy teacher accounts have NO class access until an admin explicitly assigns classes.
            db.add(
                m.Membership(
                    user_id=row["user_id"],
                    school_id=row["school_id"],
                    role=row["role"],
                    class_ids=[],
                    permissions={"createExams": True, "scan": True, "reports": True},
                )
            )
        if users:
            db.add(m.SystemState(key="setup", value="migrated"))
        for school in schools:
            audit(db, school["id"], None, "Migrated Node workspace; source retained; existing sessions revoked")
        db.commit()
        old.close()
        return {
            "users": len(users),
            "schools": len(schools),
            "sourceBackup": str(safety),
            "note": "Passwords upgrade to Argon2id on successful sign-in. Legacy teachers need explicit class assignments. Historical Node backup files remain in the original data directory.",
        }


def reset_password(email, settings):
    if (
        settings.database_url.startswith("sqlite")
        and not Path(settings.database_url.removeprefix("sqlite:///")).is_file()
    ):
        raise ValueError("The enterprise database does not exist. Verify DATA_DIR/DATABASE_URL first.")
    engine = engine_for(settings)
    with sessions_for(engine)() as db:
        user = db.scalar(select(m.User).where(m.User.email == email.strip().lower()))
        if not user:
            raise ValueError("No matching account. No data was changed.")
        password = getpass.getpass("New password (12–128 characters, hidden): ")
        confirmation = getpass.getpass("Confirm new password (hidden): ")
        if password != confirmation:
            raise ValueError("Passwords differ. No data was changed.")
        user.password_hash = hash_password(password)
        db.execute(delete(m.Session).where(m.Session.user_id == user.id))
        db.execute(delete(m.PasswordReset).where(m.PasswordReset.user_id == user.id))
        audit(db, None, user.id, "Trusted-server password recovery; all sessions revoked")
        db.commit()
        print("Password changed; existing sessions revoked. No password was printed or stored in shell history.")


def main():
    os.umask(0o077)
    parser = argparse.ArgumentParser(description="OMR enterprise maintenance")
    subs = parser.add_subparsers(dest="command", required=True)
    imp = subs.add_parser("migrate-node", help="Import existing Node SQLite data into an EMPTY enterprise database")
    imp.add_argument("source", type=Path)
    imp.add_argument("--confirm", action="store_true", help="Explicitly confirm the migration; source is retained")
    reset = subs.add_parser("reset-password", help="Trusted-server interactive account recovery")
    reset.add_argument("email")
    args = parser.parse_args()
    settings = Settings()
    try:
        if args.command == "migrate-node":
            if not args.confirm:
                parser.error("Read documentation/MIGRATION.md first, then pass --confirm. Source data is not deleted.")
            print(json.dumps(migrate_node(args.source, settings), indent=2))
        else:
            reset_password(args.email, settings)
    except ValueError as exc:
        parser.exit(1, str(exc) + "\n")


if __name__ == "__main__":
    main()
