"""Private appDataFolder backups, encrypted before upload; manual, explicit restore.

A durable operation and preallocated Drive file ID make ambiguous retries safe.
OAuth credentials are encrypted using the server BACKUP_KEY, never sent to clients.
Workspace archives exclude login accounts, raw scans, binary attachments and keys.
"""

from __future__ import annotations

import json
import secrets
import time
from datetime import timedelta

from cryptography.fernet import InvalidToken
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, Field, ValidationError
from sqlalchemy import or_, select, update
from sqlalchemy.orm import Session

from .. import models as m
from ..google_provider import GoogleError, decrypted_json, encrypted_json, google_ready
from ..schemas import Workspace
from ..security import audit, current_user, db_session, digest, membership
from ..workspaces import load_workspace
from .auth import throttle
from .workspace import backup_info

router = APIRouter(prefix="/api/schools/{school_id}/drive")
FORMAT = "markly-drive-workspace-v1"


def connection_for(db, user, school_id):
    membership(db, user, school_id, "admin")
    connection = db.scalar(
        select(m.GoogleDriveConnection).where(
            m.GoogleDriveConnection.user_id == user.id,
            m.GoogleDriveConnection.school_id == school_id,
            m.GoogleDriveConnection.active.is_(True),
        )
    )
    if not connection or not connection.credentials_encrypted:
        raise HTTPException(409, "Connect your Google Drive for this institution first.")
    return connection


def backup_for(db, user, school_id, backup_id):
    connection = connection_for(db, user, school_id)
    row = db.get(m.GoogleDriveBackup, backup_id)
    if not row or row.connection_id != connection.id:
        raise HTTPException(404, "Backup not found in your connected institution Drive.")
    return connection, row


def info(row, active_id):
    return {
        "id": row.id,
        "operationId": row.operation_id,
        "revision": row.revision,
        "status": row.status,
        "error": row.error,
        "bytes": row.size,
        "createdAt": row.created_at.isoformat() + "Z",
        "uploadedAt": row.uploaded_at.isoformat() + "Z" if row.uploaded_at else None,
        "available": row.connection_id == active_id,
        "recoveryId": row.recovery_id,
    }


@router.get("")
def status(school_id: str, request: Request, user=Depends(current_user), db: Session = Depends(db_session)):
    membership(db, user, school_id, "admin")
    connection = db.scalar(
        select(m.GoogleDriveConnection).where(
            m.GoogleDriveConnection.user_id == user.id,
            m.GoogleDriveConnection.school_id == school_id,
            m.GoogleDriveConnection.active.is_(True),
        )
    )
    rows = db.scalars(
        select(m.GoogleDriveBackup)
        .join(m.GoogleDriveConnection)
        .where(m.GoogleDriveConnection.user_id == user.id, m.GoogleDriveConnection.school_id == school_id)
        .order_by(m.GoogleDriveBackup.created_at.desc())
        .limit(100)
    ).all()
    return {
        "configured": google_ready(request.app.state.settings),
        "connected": bool(connection and connection.credentials_encrypted),
        "email": connection.email if connection else None,
        "backups": [info(row, connection.id if connection else None) for row in rows],
        "mode": "manual",
        "scope": "drive.appdata",
        "format": FORMAT,
    }


def access_token(db, request, connection):
    # Serialise refreshes to avoid racing a rotated credential into the database.
    # SQLite ignores FOR UPDATE; its local/test deployment needs a write lock.
    if db.get_bind().dialect.name == "sqlite":
        db.execute(
            update(m.GoogleDriveConnection)
            .where(m.GoogleDriveConnection.id == connection.id)
            .values(updated_at=m.GoogleDriveConnection.updated_at)
        )
    connection = db.scalar(
        select(m.GoogleDriveConnection)
        .where(m.GoogleDriveConnection.id == connection.id)
        .execution_options(populate_existing=True)
        .with_for_update()
    )
    if not connection.active or not connection.credentials_encrypted:
        raise HTTPException(409, "This Drive connection was disconnected. Connect it again before retrying.")
    credentials = decrypted_json(request.app.state.store, connection.credentials_encrypted)
    if credentials.get("expires_at", 0) <= time.time() + 60:
        tokens = request.app.state.google.refresh(credentials["refresh_token"])
        token, expiry = tokens.get("access_token"), tokens.get("expires_in", 3600)
        if (
            not isinstance(token, str)
            or not 1 <= len(token) <= 8192
            or not isinstance(expiry, (int, float))
            or not 0 < expiry <= 86400
            or not isinstance(tokens.get("token_type", "Bearer"), str)
            or tokens.get("token_type", "Bearer").lower() != "bearer"
        ):
            raise GoogleError("invalid_provider_response")
        credentials.update(access_token=token, expires_at=time.time() + expiry)
        refresh = tokens.get("refresh_token")
        if refresh:
            if not isinstance(refresh, str) or len(refresh) > 8192:
                raise GoogleError("invalid_provider_response")
            credentials["refresh_token"] = refresh
        connection.credentials_encrypted = encrypted_json(request.app.state.store, credentials)
        connection.updated_at = m.now()
    db.commit()
    return credentials["access_token"]


def properties(row, school_id):
    return {"format": FORMAT, "school": digest(school_id), "backup": row.id, "sha256": row.sha256}


def check_metadata(value, row, school_id):
    try:
        valid = (
            value.get("id") == row.file_id
            and not value.get("trashed", False)
            and int(value.get("size", -1)) == row.size
            and value.get("appProperties") == properties(row, school_id)
        )
    except (ValueError, TypeError, AttributeError):
        valid = False
    if not valid:
        raise GoogleError("drive_backup_integrity_failed", 409)


def download_checked(db, request, connection, row, school_id):
    if row.status != "uploaded" or not row.file_id:
        raise HTTPException(409, "Only a confirmed uploaded backup can be downloaded or imported.")
    access = access_token(db, request, connection)
    provider = request.app.state.google
    check_metadata(provider.file_metadata(access, row.file_id), row, school_id)
    encrypted = provider.download(access, row.file_id)
    if len(encrypted) != row.size or digest(encrypted) != row.sha256:
        raise GoogleError("drive_backup_integrity_failed", 409)
    return encrypted


class BackupInput(BaseModel):
    operationId: str = Field(min_length=16, max_length=120, pattern=r"^[A-Za-z0-9_-]+$")


@router.post("/backups")
def upload_backup(
    school_id: str, data: BackupInput, request: Request, user=Depends(current_user), db: Session = Depends(db_session)
):
    connection = connection_for(db, user, school_id)
    throttle(db, f"drive-backup:{user.id}:{school_id}", 30)
    row = db.scalar(
        select(m.GoogleDriveBackup).where(
            m.GoogleDriveBackup.connection_id == connection.id, m.GoogleDriveBackup.operation_id == data.operationId
        )
    )
    if row and row.status == "uploaded":
        return {"backup": info(row, connection.id), "replayed": True}
    if not row:
        # Hold the school's write lock while reading a coherent snapshot. Do not advance its revision.
        db.execute(update(m.School).where(m.School.id == school_id).values(revision=m.School.revision))
        school = db.get(m.School, school_id, populate_existing=True)
        archive = {
            "format": FORMAT,
            "schoolId": school_id,
            "revision": school.revision,
            "createdAt": m.now().isoformat() + "Z",
            "workspace": load_workspace(db, school_id),
        }
        raw = json.dumps(archive, separators=(",", ":"), ensure_ascii=False, allow_nan=False).encode()
        if len(raw) > 29 * 1024 * 1024:
            raise HTTPException(
                413, "The workspace exceeds the 29 MiB Drive archive limit. Export large records separately."
            )
        encrypted = request.app.state.store.cipher.encrypt(raw)
        bid = m.uid()
        key = f"drive/{school_id}/{bid}.omr.enc"
        request.app.state.store.put(key, encrypted)
        row = m.GoogleDriveBackup(
            id=bid,
            connection_id=connection.id,
            operation_id=data.operationId,
            revision=school.revision,
            key=key,
            sha256=digest(encrypted),
            size=len(encrypted),
        )
        db.add(row)
        db.commit()
    lease = secrets.token_hex(24)
    claimed = db.execute(
        update(m.GoogleDriveBackup)
        .where(
            m.GoogleDriveBackup.id == row.id,
            m.GoogleDriveBackup.status != "uploaded",
            or_(m.GoogleDriveBackup.lease_until.is_(None), m.GoogleDriveBackup.lease_until < m.now()),
        )
        .values(lease_token=lease, lease_until=m.now() + timedelta(minutes=3), status="uploading", error="")
    )
    if claimed.rowcount != 1:
        raise HTTPException(
            409,
            "This backup is already uploading. Refresh its status; retry the same operation after the lease expires if interrupted.",
        )
    db.commit()
    try:
        access = access_token(db, request, connection)
        provider = request.app.state.google
        if not row.file_id:
            allocated = provider.generate_file_id(access)
            persisted = db.execute(
                update(m.GoogleDriveBackup)
                .where(
                    m.GoogleDriveBackup.id == row.id,
                    m.GoogleDriveBackup.lease_token == lease,
                    m.GoogleDriveBackup.file_id.is_(None),
                )
                .values(file_id=allocated)
            )
            if persisted.rowcount != 1:
                raise HTTPException(
                    409, "The backup lease changed during Drive ID allocation. Refresh before retrying."
                )
            db.commit()  # Durable preallocated ID, before any bytes are sent to Drive.
            db.refresh(row)
        try:
            metadata = provider.file_metadata(access, row.file_id)
        except GoogleError as exc:
            if exc.code != "drive_file_missing":
                raise
            encrypted = request.app.state.store.get(row.key)
            if len(encrypted) != row.size or digest(encrypted) != row.sha256:
                raise GoogleError("local_backup_integrity_failed", 409)
            metadata = {
                "name": f"Markly-{row.created_at.strftime('%Y%m%d-%H%M%S')}-r{row.revision}.omr.enc",
                "appProperties": properties(row, school_id),
            }
            try:
                metadata = provider.upload(access, row.file_id, metadata, encrypted)
            except GoogleError as duplicate:
                if duplicate.code != "drive_file_exists":
                    raise
                metadata = provider.file_metadata(access, row.file_id)
        check_metadata(metadata, row, school_id)
        updated = db.execute(
            update(m.GoogleDriveBackup)
            .where(m.GoogleDriveBackup.id == row.id, m.GoogleDriveBackup.lease_token == lease)
            .values(status="uploaded", error="", uploaded_at=m.now(), lease_token=None, lease_until=None)
        )
        if updated.rowcount != 1:
            raise HTTPException(409, "Upload acknowledgment arrived after its lease changed. Refresh before retrying.")
        audit(
            db,
            school_id,
            user.id,
            "Uploaded encrypted Google Drive workspace backup",
            backupId=row.id,
            revision=row.revision,
        )
        db.commit()
        db.refresh(row)
        return {"backup": info(row, connection.id), "replayed": False}
    except (GoogleError, HTTPException) as exc:
        db.rollback()
        code = exc.code if isinstance(exc, GoogleError) else "authorization_changed"
        db.execute(
            update(m.GoogleDriveBackup)
            .where(m.GoogleDriveBackup.id == row.id, m.GoogleDriveBackup.lease_token == lease)
            .values(status="failed", error=code, lease_token=None, lease_until=None)
        )
        db.commit()
        if isinstance(exc, HTTPException):
            raise
        raise HTTPException(
            exc.status,
            {
                "message": "Drive backup was not confirmed. "
                + code.replace("_", " ")
                + ". Retry the same backup; reconnect Google if access was revoked.",
                "code": code,
            },
        ) from None


@router.get("/backups/{backup_id}/download")
def download_backup(
    school_id: str, backup_id: str, request: Request, user=Depends(current_user), db: Session = Depends(db_session)
):
    connection, row = backup_for(db, user, school_id, backup_id)
    try:
        encrypted = download_checked(db, request, connection, row, school_id)
    except GoogleError as exc:
        raise HTTPException(exc.status, "Drive download failed: " + exc.code.replace("_", " ") + ".") from None
    audit(db, school_id, user.id, "Downloaded encrypted Google Drive backup", backupId=row.id)
    db.commit()
    return Response(
        encrypted,
        media_type="application/octet-stream",
        headers={"Content-Disposition": f'attachment; filename="markly-{row.id}.omr.enc"'},
    )


@router.post("/backups/{backup_id}/import")
def import_backup(
    school_id: str, backup_id: str, request: Request, user=Depends(current_user), db: Session = Depends(db_session)
):
    connection, row = backup_for(db, user, school_id, backup_id)
    throttle(db, f"drive-import:{user.id}", 12)
    if row.recovery_id:
        point = db.get(m.RecoveryPoint, row.recovery_id)
        return {"backup": backup_info(point), "replayed": True}
    try:
        encrypted = download_checked(db, request, connection, row, school_id)
        archive = json.loads(request.app.state.store.cipher.decrypt(encrypted))
        if (
            not isinstance(archive, dict)
            or archive.get("format") != FORMAT
            or archive.get("schoolId") != school_id
            or archive.get("revision") != row.revision
        ):
            raise ValueError()
        workspace = Workspace.model_validate(archive.get("workspace"))
        if (
            workspace.activeSchoolId != school_id
            or len(workspace.schools or []) != 1
            or workspace.schools[0].id != school_id
        ):
            raise ValueError()
    except GoogleError as exc:
        raise HTTPException(exc.status, "Drive import failed: " + exc.code.replace("_", " ") + ".") from None
    except (ValueError, KeyError, TypeError, InvalidToken, ValidationError):
        raise HTTPException(
            409,
            "The archive could not be authenticated for this institution with this server's BACKUP_KEY. Nothing was restored.",
        ) from None
    # Import is non-destructive. Actual restore uses existing password + revision CAS + pre-restore snapshot.
    rid = m.uid()
    key = f"backups/{school_id}/{rid}.json.enc"
    raw = workspace.model_dump_json(by_alias=True, exclude_none=True).encode()
    request.app.state.store.put(key, raw, encrypt=True)
    point = m.RecoveryPoint(
        id=rid, school_id=school_id, key=key, name=f"Google Drive · revision {row.revision}", automatic=False
    )
    # Insert the FK target before claiming; a concurrent loser rolls both changes back.
    db.add(point)
    db.flush()
    claimed = db.execute(
        update(m.GoogleDriveBackup)
        .where(m.GoogleDriveBackup.id == row.id, m.GoogleDriveBackup.recovery_id.is_(None))
        .values(recovery_id=rid)
    )
    if claimed.rowcount != 1:
        raise HTTPException(409, "This archive was imported in another tab. Refresh the server recovery history.")
    audit(
        db,
        school_id,
        user.id,
        "Imported Drive archive as a non-destructive server recovery point",
        backupId=row.id,
        recoveryId=rid,
    )
    db.commit()
    return {"backup": backup_info(point), "replayed": False}


@router.post("/disconnect")
def disconnect(school_id: str, request: Request, user=Depends(current_user), db: Session = Depends(db_session)):
    connection = connection_for(db, user, school_id)
    throttle(db, f"drive-disconnect:{user.id}", 6)
    try:
        credentials = decrypted_json(request.app.state.store, connection.credentials_encrypted)
    except GoogleError:
        credentials = {}  # Local disconnect must still work if an operator lost/changed BACKUP_KEY.
    connection.active, connection.credentials_encrypted = False, None
    connection.updated_at = m.now()
    audit(db, school_id, user.id, "Disconnected Google Drive; server refresh/access credentials removed")
    db.commit()  # Disconnect locally even if Google is unreachable.
    revoked = False
    try:
        if credentials.get("refresh_token"):
            revoked = request.app.state.google.revoke(credentials["refresh_token"])
    except GoogleError:
        pass
    return {
        "disconnected": True,
        "revokedAtGoogle": revoked,
        "message": "Drive disconnected. Existing uploaded backups were not deleted."
        + (
            ""
            if revoked
            else " Google could not confirm revocation; remove this app's access in your Google account security settings."
        ),
    }
