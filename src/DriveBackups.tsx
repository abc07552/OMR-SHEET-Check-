import { useEffect, useRef, useState } from "react";
import {
  ArrowDownToLine,
  Cloud,
  LoaderCircle,
  RefreshCw,
  ShieldCheck,
  Unplug,
  Upload,
} from "lucide-react";
import { api, apiDownload, useSession } from "./session";
import { startGoogle } from "./googleAuth";

interface DriveBackup {
  id: string;
  operationId: string;
  revision: number;
  status: string;
  bytes: number;
  error: string;
  createdAt: string;
  uploadedAt?: string;
  available: boolean;
  recoveryId?: string;
}
interface DriveStatus {
  configured: boolean;
  connected: boolean;
  email?: string;
  backups: DriveBackup[];
  mode: string;
}
interface Recovery {
  id: string;
  name: string;
  createdAt: string;
  automatic: boolean;
}
export default function DriveBackups({
  schoolId,
  onImported,
}: {
  schoolId: string;
  onImported: (point: Recovery) => Promise<void>;
}) {
  const session = useSession(),
    root = `/schools/${schoolId}/drive`;
  const [state, setState] = useState<DriveStatus | null>(null),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState("");
  const alive = useRef(true),
    pendingOperation = useRef<string | null>(null);
  useEffect(() => {
    alive.current = true;
    void api<DriveStatus>(root)
      .then((value) => {
        if (alive.current) setState(value);
      })
      .catch((e) => {
        if (alive.current) setError(e.message);
      });
    return () => {
      alive.current = false;
    };
  }, [root]);
  const refresh = async () => {
    const value = await api<DriveStatus>(root);
    if (alive.current) setState(value);
  };
  const action = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    setError("");
    setMessage("");
    try {
      await fn();
    } catch (e) {
      if (alive.current)
        setError(
          e instanceof Error ? e.message : "Google Drive operation failed.",
        );
    } finally {
      if (alive.current) {
        setBusy("");
        void refresh().catch((e) => {
          if (alive.current) setError(e.message);
        });
      }
    }
  };
  const upload = async (operationId: string) => {
    await api(`${root}/backups`, {
      method: "POST",
      body: JSON.stringify({ operationId }),
    });
    pendingOperation.current = null;
    if (alive.current)
      setMessage(
        "Encrypted school workspace uploaded and confirmed by Google Drive.",
      );
  };
  return (
    <section className="card drive-backups" aria-label="Google Drive backups">
      <div className="card-heading">
        <div>
          <h2>
            <Cloud size={20} /> Google Drive backups
          </h2>
          <p>
            Your Drive, this institution only. A separate permission from Google
            sign-in.
          </p>
        </div>
        <ShieldCheck size={20} className="muted" />
      </div>
      <div className="form-fields">
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        {message && (
          <p className="v2-notice" role="status">
            {message}
          </p>
        )}
        {!state && error && (
          <button
            className="button button-secondary"
            disabled={!!busy || session.offline}
            onClick={() => void action("refresh", refresh)}
          >
            Retry Drive status
          </button>
        )}
        {!state && !error && (
          <p>
            <LoaderCircle className="spinning" size={18} /> Loading Drive
            connection…
          </p>
        )}
        {state && (
          <>
            <div className="security-summary">
              <strong>
                {state.connected ? state.email : "No Google Drive connected"}
              </strong>
              <span className="soft-tag">Manual · encrypted before upload</span>
            </div>
            <p className="small muted">
              Backs up saved server records: institution settings, students,
              classes, exams, layouts, answer keys and results. Unsynchronized
              device edits, original scan images, attachments, login accounts
              and the server encryption key are not included. Keep a full
              PostgreSQL/object-storage backup too.
            </p>
            <p className="small muted">
              Files are stored in this app’s private Drive app-data folder, not
              your ordinary My Drive list. Only this app’s folder is requested,
              not access to your other files. Keep BACKUP_KEY securely outside
              Drive; it is required to decrypt these archives.
            </p>
            {!state.configured && (
              <p className="v2-notice warning">
                The hosting operator must configure Google Cloud OAuth, enable
                Google Drive API, and set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET
                and the canonical HTTPS PUBLIC_APP_URL. No keys belong in the
                APK or browser.
              </p>
            )}
            <div className="row-actions drive-actions">
              <button
                className="button button-secondary"
                disabled={!!busy || session.offline || !state.configured}
                onClick={() =>
                  void action("connect", () =>
                    startGoogle("drive", { schoolId }),
                  )
                }
              >
                <Cloud size={16} />
                {state.connected
                  ? "Reconnect / change Drive account"
                  : "Connect Google Drive"}
              </button>
              <button
                className="button button-primary"
                disabled={!!busy || session.offline || !state.connected}
                onClick={() => {
                  pendingOperation.current ||= crypto.randomUUID();
                  const id = pendingOperation.current;
                  void action("upload", () => upload(id));
                }}
              >
                <Upload size={16} />
                {busy === "upload"
                  ? "Uploading encrypted workspace…"
                  : pendingOperation.current
                    ? "Retry current backup"
                    : "Back up saved workspace now"}
              </button>
              <button
                className="button button-secondary"
                disabled={!!busy || session.offline}
                onClick={() => void action("refresh", refresh)}
              >
                <RefreshCw size={16} />
                Refresh status
              </button>
              {state.connected && (
                <button
                  className="text-button danger-text"
                  disabled={!!busy || session.offline}
                  onClick={() => {
                    if (
                      !window.confirm(
                        "Disconnect this institution’s Drive backup connection? Server tokens will be removed and Google revocation requested. Uploaded files are not deleted. This may revoke other Drive connections using the same Google account and OAuth app; reconnect those if needed. Google sign-in is managed separately.",
                      )
                    )
                      return;
                    void action("disconnect", async () => {
                      const result = await api<{ message: string }>(
                        `${root}/disconnect`,
                        { method: "POST" },
                      );
                      if (alive.current) setMessage(result.message);
                    });
                  }}
                >
                  <Unplug size={15} />
                  Disconnect Drive
                </button>
              )}
            </div>
            {!!busy && (
              <p className="small muted" role="status">
                <LoaderCircle className="spinning" size={14} />{" "}
                {busy === "upload"
                  ? "Keep this page open. A retry reuses the same immutable snapshot and Drive file ID."
                  : "Working securely…"}
              </p>
            )}
            <div
              className="drive-history"
              role="list"
              aria-label="Drive backup history"
            >
              {state.backups.length === 0 ? (
                <p className="muted">
                  No Drive backups yet. Connect an account, save your edits to
                  the server, then create your first encrypted backup.
                </p>
              ) : (
                state.backups.map((row) => (
                  <div
                    className="drive-history-row"
                    key={row.id}
                    role="listitem"
                  >
                    <div>
                      <strong>Workspace revision {row.revision}</strong>
                      <small>
                        {new Date(row.createdAt).toLocaleString()} ·{" "}
                        {(row.bytes / 1024).toFixed(0)} KB · {row.status}
                      </small>
                      {row.error && (
                        <small className="danger-text">
                          Not confirmed: {row.error.replaceAll("_", " ")}
                        </small>
                      )}
                      {!row.available && (
                        <small>
                          Reconnect the original Google account to access this
                          archive.
                        </small>
                      )}
                    </div>
                    <div className="row-actions">
                      {row.status !== "uploaded" ? (
                        <button
                          className="button button-secondary"
                          disabled={!!busy || session.offline || !row.available}
                          onClick={() =>
                            void action("retry", () => upload(row.operationId))
                          }
                        >
                          Retry same backup
                        </button>
                      ) : (
                        <>
                          <button
                            className="button button-secondary"
                            disabled={
                              !!busy || session.offline || !row.available
                            }
                            onClick={() =>
                              void action("download", () =>
                                apiDownload(
                                  `${root}/backups/${row.id}/download`,
                                  `markly-${row.id}.omr.enc`,
                                ),
                              )
                            }
                          >
                            <ArrowDownToLine size={14} />
                            Download encrypted
                          </button>
                          <button
                            className="button button-secondary"
                            disabled={
                              !!busy || session.offline || !row.available
                            }
                            onClick={() =>
                              void action("import", async () => {
                                const result = await api<{ backup: Recovery }>(
                                  `${root}/backups/${row.id}/import`,
                                  { method: "POST" },
                                );
                                if (!alive.current) return;
                                await onImported(result.backup);
                                if (alive.current)
                                  setMessage(
                                    "Drive archive imported as a server recovery point. Live data is unchanged until you confirm Restore with your app password and current revision.",
                                  );
                              })
                            }
                          >
                            {row.recoveryId
                              ? "Open restore confirmation"
                              : "Import for restore"}
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </>
        )}
      </div>
    </section>
  );
}
