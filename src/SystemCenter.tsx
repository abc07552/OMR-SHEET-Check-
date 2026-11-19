import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  ArrowDownToLine,
  Cloud,
  HardDrive,
  History,
  LockKeyhole,
  RefreshCw,
  ShieldCheck,
  SunMoon,
  Trash2,
  WifiOff,
} from "lucide-react";
import { PageHeading, Select } from "./components";
import { api, useSession } from "./session";
import type { SaveStatus } from "./session";
import type { Workspace } from "./data";
import { downloadFile } from "./data";
import {
  cachedSchool,
  enableVault,
  forgetVault,
  vaultEnabled,
} from "./offline";
import { OfflineUnlock } from "./AccountAccess";
import InstitutionDefaults from "./InstitutionDefaults";
import { applyTheme } from "./theme";
interface Health {
  database: string;
  databaseConnected: boolean;
  objectStorage: string;
  imageBytes: number;
  pendingJobs: number;
  serverOCR: boolean;
  emailConfigured: boolean;
  environment: string;
  permanentCloudDeployment: boolean;
}
export default function SystemCenter({
  workspace,
  revision,
  reload,
  status,
  toast,
}: {
  workspace: Workspace;
  revision: number;
  reload: () => Promise<void>;
  status: SaveStatus;
  toast: (s: string) => void;
}) {
  const session = useSession(),
    school = workspace.activeSchoolId!,
    cloud = session.phase === "authenticated",
    member = session.user?.memberships.find((m) => m.schoolId === school),
    admin = member?.role === "admin",
    connected = cloud && session.backend === "fastapi" && !session.offline;
  const [phrase, setPhrase] = useState(""),
    [confirmation, setConfirmation] = useState(""),
    [busy, setBusy] = useState(false),
    [unlocking, setUnlocking] = useState(false),
    [enabled, setEnabled] = useState(vaultEnabled(session.user?.id)),
    [theme, setTheme] = useState(localStorage.getItem("omr-theme") || "dark");
  const health = useQuery<Health>({
    queryKey: ["system-health", session.user?.id],
    queryFn: () => api("/system/health"),
    enabled: connected && !!session.user?.owner,
    refetchInterval: 60_000,
  });
  const operations = useQuery<{
    operations: { id: string; createdAt: string; revision?: number }[];
  }>({
    queryKey: ["sync-operations", session.user?.id, school, revision],
    queryFn: () => api(`/schools/${school}/sync/log`),
    enabled: connected,
  });
  const cache = cachedSchool(school);
  return (
    <>
      <PageHeading
        eyebrow="CONTROL WITHOUT COMPROMISE"
        title="Your institution. Your infrastructure."
        description="Real service health, encrypted offline work and explicit synchronization controls."
        actions={
          <button
            className="button button-secondary"
            onClick={() => {
              void health.refetch();
              void operations.refetch();
            }}
            disabled={!connected}
          >
            <RefreshCw size={15} />
            Refresh service status
          </button>
        }
      />
      <div className="enterprise-two-columns">
        <section className="card">
          <div className="card-heading">
            <div>
              <h2>
                <Activity size={18} />
                Service health
              </h2>
              <p>No deployment status is inferred from a dashboard mockup.</p>
            </div>
          </div>
          <dl className="health-list">
            <div>
              <dt>Application</dt>
              <dd>
                {cloud
                  ? session.backend === "fastapi"
                    ? "Python FastAPI"
                    : "Preserved Node service"
                  : "Device workspace"}
              </dd>
            </div>
            <div>
              <dt>Offline application shell</dt>
              <dd>
                {document.documentElement.dataset.offlineShell === "native"
                  ? "Bundled APK assets · no service worker required"
                  : document.documentElement.dataset.offlineShell === "ready" ||
                      navigator.serviceWorker?.controller
                    ? "Cached public app assets · private APIs excluded"
                    : "Not cached yet / unavailable in development"}
              </dd>
            </div>
            <div>
              <dt>Connection</dt>
              <dd>
                {session.offline
                  ? "Offline / reconnect required"
                  : cloud
                    ? "Authenticated server"
                    : "Local browser"}
              </dd>
            </div>
            {health.data && (
              <>
                <div>
                  <dt>Database</dt>
                  <dd>
                    {health.data.database} ·{" "}
                    {health.data.databaseConnected
                      ? "connected"
                      : "unavailable"}
                  </dd>
                </div>
                <div>
                  <dt>Original image storage</dt>
                  <dd>
                    {health.data.objectStorage} ·{" "}
                    {(health.data.imageBytes / 1024 / 1024).toFixed(2)} MB
                  </dd>
                </div>
                <div>
                  <dt>Pending scan jobs</dt>
                  <dd>{health.data.pendingJobs}</dd>
                </div>
                <div>
                  <dt>Server OCR executable</dt>
                  <dd>
                    {health.data.serverOCR
                      ? "Available"
                      : "Not installed · browser OCR available"}
                  </dd>
                </div>
                <div>
                  <dt>Recovery email</dt>
                  <dd>
                    {health.data.emailConfigured
                      ? "Configured · delivery must be monitored"
                      : "Not configured"}
                  </dd>
                </div>
                <div>
                  <dt>Runtime</dt>
                  <dd>{health.data.environment}</dd>
                </div>
              </>
            )}
          </dl>
          {health.error && <p className="form-error">{health.error.message}</p>}
          {!session.user?.owner && (
            <p className="small muted">
              Only a super administrator can inspect database/storage
              configuration. School permissions remain enforced on every
              endpoint.
            </p>
          )}
          <div className="v2-notice">
            <Cloud size={18} />
            <p>
              {health.data?.environment === "production"
                ? "Production configuration is enabled. Verify external HTTPS, database backups, object retention and monitoring independently."
                : "This is a local preview, not a permanently deployed cloud service. PostgreSQL, S3-compatible storage and SMTP can be configured on your own host."}
            </p>
          </div>
        </section>
        <section className="card">
          <div className="card-heading">
            <div>
              <h2>
                <LockKeyhole size={18} />
                Encrypted offline workspace
              </h2>
              <p>
                Opt in on trusted devices only. Access expires after 24 hours
                without server verification.
              </p>
            </div>
            <span className="soft-tag">
              {enabled ? "Unlocked" : "Not enabled / locked"}
            </span>
          </div>
          {cloud && session.backend === "fastapi" ? (
            <form
              className="form-fields"
              onSubmit={async (e) => {
                e.preventDefault();
                if (!enabled && phrase !== confirmation) {
                  toast("Offline passphrases do not match.");
                  return;
                }
                setBusy(true);
                try {
                  await enableVault(
                    session.user!,
                    school,
                    workspace,
                    revision,
                    phrase,
                  );
                  setEnabled(true);
                  setPhrase("");
                  setConfirmation("");
                  toast(
                    "This authorized workspace is encrypted in IndexedDB. Offline changes use stable operation IDs and never overwrite newer server revisions.",
                  );
                } catch (e) {
                  toast(
                    e instanceof Error
                      ? e.message
                      : "Could not enable offline access.",
                  );
                } finally {
                  setBusy(false);
                }
              }}
            >
              <label>
                Separate offline passphrase
                <input
                  type="password"
                  autoComplete="off"
                  minLength={12}
                  value={phrase}
                  onChange={(e) => setPhrase(e.target.value)}
                  required={!enabled}
                />
              </label>
              {!enabled && (
                <label>
                  Confirm offline passphrase
                  <input
                    type="password"
                    autoComplete="off"
                    minLength={12}
                    value={confirmation}
                    onChange={(e) => setConfirmation(e.target.value)}
                    required
                  />
                </label>
              )}
              <div className="row-actions">
                <button
                  className="button button-primary"
                  disabled={busy || session.offline || status !== "saved"}
                >
                  <HardDrive size={15} />
                  {enabled
                    ? "Refresh authorized offline copy"
                    : "Enable encrypted offline work"}
                </button>
                <button
                  className="text-button"
                  type="button"
                  onClick={() => setUnlocking(true)}
                >
                  Unlock existing vault
                </button>
              </div>
              <p className="small muted">
                The account password is not cached. A local passphrase protects
                authorized records and originals with AES-GCM / PBKDF2. API
                responses are never put in the PWA HTTP cache. A lost passphrase
                cannot be recovered.
              </p>
              <button
                type="button"
                className="text-button danger-text"
                disabled={busy || status !== "saved"}
                onClick={async () => {
                  if (
                    !confirm(
                      "Permanently remove this account’s encrypted device cache? Confirm all work is synchronized first. The server and other accounts are unaffected.",
                    )
                  )
                    return;
                  try {
                    await forgetVault(session.user!.email);
                    setEnabled(false);
                    toast(
                      "This account's encrypted offline cache was removed from this device.",
                    );
                  } catch (e) {
                    toast(String(e));
                  }
                }}
              >
                <Trash2 size={14} />
                Forget this account’s offline cache
              </button>
            </form>
          ) : (
            <div className="form-fields">
              <p className="muted">
                Secure per-account offline vaults require the FastAPI backend.
                The device demo remains separate and stores its own records
                locally.
              </p>
              <ShieldCheck size={24} />
            </div>
          )}
        </section>
        <section className="card">
          <div className="card-heading">
            <div>
              <h2>
                <History size={18} />
                Synchronization journal
              </h2>
              <p>
                Retries replay the same operation; stale revisions require
                deliberate conflict resolution.
              </p>
            </div>
          </div>
          <dl className="health-list">
            <div>
              <dt>Workspace revision</dt>
              <dd>{cloud ? revision : "Device-only"}</dd>
            </div>
            <div>
              <dt>Save state</dt>
              <dd>{status}</dd>
            </div>
            <div>
              <dt>Persisted pending operation</dt>
              <dd>
                {cache?.inflight?.id ||
                  (cache?.pending ? "Queued encrypted workspace" : "None")}
              </dd>
            </div>
          </dl>
          <div className="form-fields">
            <div className="row-actions">
              <button
                className="button button-secondary"
                disabled={!cloud || !session.offline}
                onClick={async () => {
                  try {
                    await session.reconnect();
                    toast(
                      "Server session verified. Queued work will synchronize using its saved revision and operation ID.",
                    );
                  } catch (e) {
                    toast(
                      e instanceof Error
                        ? e.message
                        : "Reconnect failed. Sign in again to renew your session.",
                    );
                  }
                }}
              >
                <WifiOff size={15} />
                Reconnect & synchronize
              </button>
              <button
                className="text-button"
                onClick={() =>
                  downloadFile(
                    "omr-unsaved-workspace.json",
                    JSON.stringify(workspace),
                    "application/json",
                  ).catch((error) =>
                    toast(
                      error instanceof Error ? error.message : "Export failed.",
                    ),
                  )
                }
              >
                <ArrowDownToLine size={14} />
                Export a manual safety copy
              </button>
            </div>
            {operations.error && (
              <p className="form-error">{operations.error.message}</p>
            )}
            <div className="sync-journal">
              {operations.data?.operations.length ? (
                operations.data.operations.slice(0, 10).map((op) => (
                  <div key={op.id}>
                    <span className="live-dot" />
                    <code>{op.id.slice(0, 18)}…</code>
                    <span>
                      {op.revision ? `revision ${op.revision}` : "completed"}
                    </span>
                    <time>{new Date(op.createdAt).toLocaleString()}</time>
                  </div>
                ))
              ) : (
                <p className="muted">
                  No online operation receipts loaded. Offline data is kept
                  separate until server authorization succeeds.
                </p>
              )}
            </div>
          </div>
        </section>
        <section className="card">
          <div className="card-heading">
            <div>
              <h2>
                <SunMoon size={18} />
                Your display
              </h2>
              <p>
                Stored on this device; no personal assessment data is written to
                theme storage.
              </p>
            </div>
          </div>
          <div className="form-fields">
            <label>
              Color theme
              <Select
                value={theme}
                onChange={(e) => {
                  setTheme(e.target.value);
                  applyTheme(e.target.value);
                }}
              >
                <option value="dark">Midnight navy</option>
                <option value="light">Clear daylight</option>
                <option value="system">Follow device</option>
              </Select>
            </label>
            <div className="theme-preview">
              <div />
              <div />
              <div />
              <span>NAVY / ELECTRIC BLUE</span>
            </div>
            <p className="small muted">
              The sidebar becomes a mobile navigation bar on smaller screens.
              Charts, report generation and optical scanning remain
              local-capable after the application shell is cached.
            </p>
          </div>
        </section>
      </div>
      {admin && connected && (
        <InstitutionDefaults
          key={JSON.stringify([session.user!.id, school])}
          actorId={session.user!.id}
          schoolId={school}
          status={status}
          reload={reload}
          onThemeSaved={setTheme}
          toast={toast}
        />
      )}
      {unlocking && (
        <OfflineUnlock
          onClose={() => {
            setUnlocking(false);
            setEnabled(vaultEnabled(session.user?.id));
          }}
        />
      )}
    </>
  );
}
