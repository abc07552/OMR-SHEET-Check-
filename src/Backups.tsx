import { useEffect, useRef, useState } from "react";
import DriveBackups from "./DriveBackups";
import {
  ArrowDownToLine,
  Check,
  Cloud,
  Database,
  HardDrive,
  History,
  LockKeyhole,
  Plus,
  RotateCcw,
  ShieldCheck,
  Trash2,
  Upload,
} from "lucide-react";
import type { Workspace } from "./data";
import { downloadFile, enrichWorkspace, scopeWorkspace } from "./data";
import {
  decodeBackup,
  deleteSnapshot,
  encodeBackup,
  listSnapshots,
  saveSnapshot,
} from "./storage";
import type { Snapshot } from "./storage";
import { API_BASE, api, useSession } from "./session";
import { EmptyState, Modal, PageHeading } from "./components";
interface ServerBackup {
  id: string;
  name: string;
  createdAt: string;
  automatic: boolean;
}
export default function Backups({
  workspace,
  onRestore,
  reload,
  toast,
  revision,
}: {
  workspace: Workspace;
  onRestore: (w: Workspace) => void;
  reload: () => Promise<void>;
  toast: (s: string) => void;
  revision?: number;
}) {
  const session = useSession(),
    cloud = session.phase === "authenticated",
    schoolId = workspace.activeSchoolId!,
    admin =
      !cloud ||
      session.user?.memberships.find((m) => m.schoolId === schoolId)?.role ===
        "admin";
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]),
    [server, setServer] = useState<ServerBackup[]>([]),
    [password, setPassword] = useState(""),
    [encrypt, setEncrypt] = useState(false),
    [busy, setBusy] = useState(""),
    [error, setError] = useState(""),
    [pending, setPending] = useState<Workspace | null>(null),
    [restoreServer, setRestoreServer] = useState<ServerBackup | null>(null),
    [currentPassword, setCurrentPassword] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const refresh = async () => {
    try {
      setSnapshots(await listSnapshots(schoolId));
      if (cloud && admin)
        setServer(
          (
            await api<{ backups: ServerBackup[] }>(
              `/schools/${schoolId}/backups`,
            )
          ).backups,
        );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Backups are unavailable.");
    }
  };
  useEffect(() => {
    void refresh();
  }, [schoolId, cloud]);
  const action = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "The backup operation failed.");
    } finally {
      setBusy("");
    }
  };
  return (
    <>
      <PageHeading
        eyebrow="YOUR PROGRESS, PROTECTED"
        title="A little peace of mind."
        description="Recovery points, portable backups, and optional AES-GCM encryption. Always keep an off-device copy."
        actions={
          <button
            className="button button-primary"
            disabled={!!busy}
            onClick={() => {
              void action("snapshot", async () => {
                await saveSnapshot(
                  workspace,
                  "Manual device recovery point",
                  false,
                );
                await refresh();
                toast("Device recovery point created.");
              });
            }}
          >
            <Plus size={16} />
            Create recovery point
          </button>
        }
      />
      <div className="backup-status-grid">
        <div className="card">
          <span className="stat-icon green">
            {cloud ? <Cloud size={20} /> : <HardDrive size={20} />}
          </span>
          <div>
            <strong>
              {cloud ? "Shared server workspace" : "Device-only workspace"}
            </strong>
            <p>
              {cloud
                ? "Encrypted recovery · server-enforced access"
                : "Browser storage · no account authentication"}
            </p>
          </div>
        </div>
        <div className="card">
          <span className="stat-icon lavender">
            <History size={20} />
          </span>
          <div>
            <strong>{snapshots.length} device recovery points</strong>
            <p>Up to 10 automatic points; manual points retained.</p>
          </div>
        </div>
        <div className="card">
          <span className="stat-icon peach">
            <ShieldCheck size={20} />
          </span>
          <div>
            <strong>
              {cloud
                ? "Server backup retention: 14 automatic"
                : "Keep an independent backup"}
            </strong>
            <p>
              {cloud
                ? "Daily plus pre-save recovery points"
                : "Clearing browser data also removes recovery points."}
            </p>
          </div>
        </div>
      </div>
      {error && (
        <div className="v2-notice warning" role="alert">
          {error}
        </div>
      )}
      {cloud && admin && session.backend === "fastapi" && (
        <DriveBackups
          key={`${session.user?.id}-${schoolId}`}
          schoolId={schoolId}
          onImported={async (point) => {
            await refresh();
            setRestoreServer(point);
          }}
        />
      )}
      <div className="backup-transfer-grid">
        <section className="card">
          <div className="card-heading">
            <div>
              <h2>Take your workspace with you.</h2>
              <p>
                Portable JSON includes students, classes, keys, layouts, and
                results.
              </p>
            </div>
            <LockKeyhole size={19} className="muted" />
          </div>
          <div className="form-fields">
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={encrypt}
                onChange={(e) => setEncrypt(e.target.checked)}
              />
              Encrypt exported backups with a passphrase
            </label>
            <label>
              {encrypt
                ? "Backup passphrase · at least 10 characters"
                : "Passphrase for restoring an encrypted file (optional)"}
              <input
                type="password"
                autoComplete="off"
                minLength={encrypt ? 10 : undefined}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Keep your passphrase somewhere safe"
              />
            </label>
            <p className="small muted">
              Encrypted files use AES-256-GCM and PBKDF2. A lost passphrase
              cannot be recovered. Unencrypted exports contain personal
              information.
            </p>
            <div className="row-actions">
              <button
                className="button button-primary"
                disabled={!!busy || (encrypt && password.length < 10)}
                onClick={() => {
                  void action("export", async () => {
                    const blob = await encodeBackup(
                      workspace,
                      encrypt ? password : undefined,
                    );
                    await downloadFile(
                      `markly-${encrypt ? "encrypted-" : ""}backup-${new Date().toISOString().slice(0, 10)}.json`,
                      blob,
                    );
                    toast(
                      "Backup downloaded. Store a copy on a separate device.",
                    );
                  });
                }}
              >
                <ArrowDownToLine size={15} />
                {busy === "export" ? "Encrypting…" : "Download backup"}
              </button>
              <button
                className="button button-secondary"
                disabled={!!busy || !admin}
                onClick={() => input.current?.click()}
              >
                <Upload size={15} />
                Restore file
              </button>
            </div>
            <input
              ref={input}
              type="file"
              accept="application/json,.json"
              className="sr-only"
              aria-label="Restore workspace backup"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f)
                  void action("import", async () => {
                    const data = await decodeBackup(f, password);
                    setPending(data);
                  });
                e.target.value = "";
              }}
            />
            {!admin && (
              <p className="small muted">
                Only administrators can replace a shared workspace with a
                backup.
              </p>
            )}
          </div>
        </section>
        <section className="card">
          <div className="card-heading">
            <div>
              <h2>Server recovery points</h2>
              <p>
                {cloud
                  ? "Backups live on your server’s persistent volume."
                  : "Available when connected to a Markly backend."}
              </p>
            </div>
            <Database size={19} className="muted" />
          </div>
          {cloud && admin ? (
            <div className="form-fields">
              <p className="muted">
                FastAPI creates an automatic recovery point before the first
                workspace write each day. These are not automatic Google Drive
                uploads. Replicate the server volume to separate storage for
                disaster recovery.
              </p>
              <button
                className="button button-secondary"
                disabled={!!busy}
                onClick={() => {
                  void action("server", async () => {
                    await api(`/schools/${schoolId}/backups`, {
                      method: "POST",
                      body: JSON.stringify({
                        name: "Manual server recovery point",
                      }),
                    });
                    await refresh();
                    toast("Server backup created.");
                  });
                }}
              >
                <Plus size={15} />
                Create server backup
              </button>
              <div className="backup-list server-backup-list">
                {server.slice(0, 10).map((s) => (
                  <div key={s.id}>
                    <span>
                      <strong>{s.name}</strong>
                      <small>{new Date(s.createdAt).toLocaleString()}</small>
                    </span>
                    <button
                      className="icon-button"
                      aria-label={`Download server backup ${s.name}`}
                      onClick={() => {
                        void action("download-server", async () => {
                          const r = await fetch(
                            `${API_BASE}/schools/${schoolId}/backups/${s.id}`,
                            { credentials: "include" },
                          );
                          if (!r.ok) throw new Error("Backup download failed.");
                          await downloadFile(
                            `markly-server-${s.id}.json`,
                            await r.blob(),
                          );
                        });
                      }}
                    >
                      <ArrowDownToLine size={15} />
                    </button>
                    <button
                      className="icon-button"
                      aria-label={`Restore server backup ${s.name}`}
                      onClick={() => setRestoreServer(s)}
                    >
                      <RotateCcw size={15} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <EmptyState
              icon={<Cloud size={28} />}
              title={
                cloud
                  ? "Protected by your administrator."
                  : "A shared home for your data."
              }
              description={
                cloud
                  ? "Ask your school administrator to create or restore server backups."
                  : "GitHub Pages hosts the offline app only. Deploy the included FastAPI server with persistent storage to enable accounts, shared data, and server backups."
              }
            />
          )}
        </section>
      </div>
      <section className="card">
        <div className="card-heading">
          <div>
            <h2>Device recovery history</h2>
            <p>Stored in this browser’s IndexedDB. Not a cloud backup.</p>
          </div>
          <History size={19} className="muted" />
        </div>
        {snapshots.length ? (
          <div className="backup-list">
            {snapshots.map((s) => (
              <div key={s.id}>
                <span className="backup-point-icon">
                  <History size={18} />
                </span>
                <span>
                  <strong>{s.name}</strong>
                  <small>
                    {new Date(s.createdAt).toLocaleString()} · {s.students}{" "}
                    students · {s.results} results ·{" "}
                    {(s.bytes / 1024).toFixed(0)} KB
                  </small>
                </span>
                <span className="soft-tag">
                  {s.automatic ? "Automatic" : "Manual"}
                </span>
                <button
                  className="icon-button"
                  title="Download recovery point"
                  aria-label={`Download recovery point ${s.id}`}
                  onClick={() => {
                    void action("export", async () => {
                      await downloadFile(
                        `markly-recovery-${s.id}.json`,
                        await encodeBackup(
                          s.workspace,
                          encrypt ? password : undefined,
                        ),
                      );
                    });
                  }}
                >
                  <ArrowDownToLine size={16} />
                </button>
                <button
                  className="icon-button"
                  disabled={!admin}
                  title="Restore recovery point"
                  aria-label={`Restore recovery point ${s.id}`}
                  onClick={() => setPending(s.workspace)}
                >
                  <RotateCcw size={16} />
                </button>
                <button
                  className="icon-button danger-text"
                  title="Delete recovery point"
                  aria-label={`Delete recovery point ${s.id}`}
                  onClick={() => {
                    if (
                      confirm(
                        "Delete this recovery point? This does not delete your current workspace.",
                      )
                    )
                      void action("delete", async () => {
                        await deleteSnapshot(s.id);
                        await refresh();
                      });
                  }}
                >
                  <Trash2 size={15} />
                </button>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState
            icon={<History size={25} />}
            title="Your safety net starts here."
            description="Create a recovery point before making big changes."
          />
        )}
      </section>
      {pending && (
        <Modal
          title="Restore this workspace backup?"
          onClose={() => setPending(null)}
        >
          <div className="modal-body">
            <p>
              This will replace{" "}
              {cloud
                ? "the current school’s shared data"
                : "your current device workspace"}{" "}
              with <strong>{pending.school}</strong>:{" "}
              {pending.students?.length || 0} students, {pending.exams.length}{" "}
              exams, and {pending.results.length} results.
            </p>
            <p className="muted">
              A device recovery point of your current workspace will be saved
              first.{" "}
              {cloud
                ? "Imported records will be assigned to the current school; no accounts or permissions are imported."
                : ""}
            </p>
          </div>
          <div className="modal-footer">
            <button
              className="button button-secondary"
              onClick={() => setPending(null)}
            >
              Keep current data
            </button>
            <button
              className="button button-danger"
              disabled={!!busy}
              onClick={() => {
                void action("restore", async () => {
                  await saveSnapshot(workspace, "Before file restore", false);
                  let data = enrichWorkspace(pending);
                  if (cloud) {
                    data = scopeWorkspace(data, data.activeSchoolId!);
                    const school = workspace.schools![0];
                    data = {
                      ...data,
                      school: workspace.school,
                      schools: [school],
                      activeSchoolId: schoolId,
                      exams: data.exams.map((e) => ({ ...e, schoolId })),
                      students: data.students!.map((s) => ({ ...s, schoolId })),
                      classes: data.classes!.map((c) => ({ ...c, schoolId })),
                    };
                  }
                  onRestore(data);
                  setPending(null);
                  await refresh();
                  toast(
                    "Backup restored. Check your workspace before continuing.",
                  );
                });
              }}
            >
              <RotateCcw size={15} />
              Restore backup
            </button>
          </div>
        </Modal>
      )}
      {restoreServer && (
        <Modal
          title="Restore a shared server recovery point?"
          onClose={() => setRestoreServer(null)}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void action("restore-server", async () => {
                await api(
                  `/schools/${schoolId}/backups/${restoreServer.id}/restore`,
                  {
                    method: "POST",
                    body: JSON.stringify({
                      password: currentPassword,
                      revision,
                    }),
                  },
                );
                setRestoreServer(null);
                setCurrentPassword("");
                await reload();
                await refresh();
                toast("Server recovery point restored.");
              });
            }}
          >
            <div className="modal-body form-fields">
              <p>
                This replaces the school’s shared workspace for all teachers. A
                pre-restore server backup will be kept. Google-only accounts
                must first set an app password in Settings. Your Google password
                is never accepted here.
              </p>
              <label>
                Your current app password
                <input
                  type="password"
                  required
                  autoComplete="current-password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                />
              </label>
              {error && <p className="form-error">{error}</p>}
            </div>
            <div className="modal-footer">
              <button
                type="button"
                className="button button-secondary"
                onClick={() => setRestoreServer(null)}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="button button-danger"
                disabled={!!busy}
              >
                Restore shared data
              </button>
            </div>
          </form>
        </Modal>
      )}
      <p className="page-bottom-note">
        <Check size={13} />
        Backups contain assessment data, not passwords or user accounts. Protect
        the PostgreSQL database, encryption key and original-image storage
        separately.
      </p>
    </>
  );
}
