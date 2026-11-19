import { useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  CheckCircle2,
  Database,
  Globe,
  LoaderCircle,
  LockKeyhole,
  Server,
  ShieldCheck,
  Unplug,
} from "lucide-react";
import { Logo, Modal } from "./components";
import { isAndroid, isBundledAndroid } from "./native";
import {
  checkSchoolServer,
  connectSchoolServer,
  disconnectSchoolServer,
  openSchoolServer,
  schoolConnectionStatus,
} from "./serverConnection";
import type { SchoolConnectionInfo } from "./serverConnection";
import { normalizeServerOrigin } from "./serverOrigin";
import { useSession } from "./session";
import "./serverConnection.css";

export default function ServerConnection({
  standalone = false,
}: {
  standalone?: boolean;
}) {
  const session = useSession(),
    native = isAndroid(),
    bundled = isBundledAndroid(),
    hosted = native && !bundled;
  const [address, setAddress] = useState(""),
    [checked, setChecked] = useState<SchoolConnectionInfo | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const alive = useRef(true),
    dirty = useRef(false);
  useEffect(() => {
    alive.current = true;
    if (native)
      void schoolConnectionStatus()
        .then((state) => {
          if (alive.current && !dirty.current)
            setAddress(state.origin || state.lastOrigin || "");
        })
        .catch(() => {
          // Prefill is optional; connection/check failures are surfaced below.
        });
    return () => {
      alive.current = false;
    };
  }, [native]);
  const close = () => {
    if (busy) return;
    if (standalone) session.explore();
    else session.closeConnection();
  };
  const contents = (
    <div className="server-connection-content">
      <span className="server-connection-icon">
        <Server size={26} />
      </span>
      <span className="eyebrow">A REAL WORKSPACE, TOGETHER</span>
      <h1>{hosted ? "Your school server." : "Connect your school."}</h1>
      <p className="server-connection-intro">
        {hosted
          ? "Accounts and shared records belong to the server below, not to the device demo."
          : "Use the FastAPI system for secure accounts, a shared institution and team access. Your administrator provides the HTTPS address."}
      </p>
      {hosted ? (
        <>
          <p className="server-origin" aria-label="Current school server">
            <LockKeyhole size={16} /> {location.origin}
          </p>
          <div className="v2-notice warning">
            Save or export unsaved work before switching. Encrypted offline
            queues stay at their original server address; reconnect there to
            recover them. Disconnecting never moves private records to the demo.
          </div>
          <button
            className="button button-secondary full-width"
            disabled={busy}
            onClick={async () => {
              if (
                !confirm(
                  "Save or export any unsaved work first. Sign out and disconnect this device? Encrypted pending work will be retained at this server address.",
                )
              )
                return;
              setBusy(true);
              setError("");
              try {
                await session.logout();
                await disconnectSchoolServer();
              } catch (e) {
                if (alive.current)
                  setError(
                    e instanceof Error ? e.message : "Disconnection failed.",
                  );
              } finally {
                if (alive.current) setBusy(false);
              }
            }}
          >
            <Unplug size={17} /> Sign out & disconnect
          </button>
          <p className="small muted">
            If the app cannot load, the native Connection button above the
            school app still works without JavaScript or network access.
          </p>
        </>
      ) : (
        <form
          onSubmit={async (event) => {
            event.preventDefault();
            setError("");
            setBusy(true);
            try {
              const origin = normalizeServerOrigin(address);
              if (!native) {
                openSchoolServer(origin);
                return;
              }
              const info = await checkSchoolServer(origin);
              if (alive.current) {
                setAddress(info.origin);
                setChecked(info);
              }
            } catch (e) {
              if (alive.current) {
                setChecked(null);
                setError(
                  e instanceof Error ? e.message : "The check failed. Retry.",
                );
              }
            } finally {
              if (alive.current) setBusy(false);
            }
          }}
        >
          <label className="server-address-label">
            School server address
            <input
              type="url"
              inputMode="url"
              placeholder="https://omr.your-school.edu"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              autoComplete="url"
              required
              maxLength={2048}
              disabled={busy}
              value={address}
              onChange={(event) => {
                dirty.current = true;
                setAddress(event.target.value);
                setChecked(null);
                setError("");
              }}
            />
          </label>
          <p className="small muted">
            Enter the complete app address, not /api, GitHub Pages or localhost.
            No passwords or setup tokens belong in this address.
          </p>
          <button
            className="button button-secondary full-width"
            disabled={busy || !address.trim()}
          >
            {busy ? (
              <LoaderCircle size={17} className="spinning" />
            ) : (
              <Globe size={17} />
            )}
            {busy
              ? "Please wait…"
              : native
                ? "Check server"
                : "Open school sign-in"}
          </button>
          {checked && (
            <section className="server-check-result" role="status">
              <strong>
                <CheckCircle2 size={18} /> FastAPI system is reachable
              </strong>
              <p className="server-origin">{checked.origin}</p>
              <p>
                <Database size={15} />{" "}
                {checked.database === "postgresql" ? "PostgreSQL" : "SQLite"}
                {" · "}
                {checked.deploymentMode === "production"
                  ? "Production mode"
                  : "Development / test mode"}
              </p>
              {checked.deploymentMode !== "production" && (
                <p className="v2-notice warning">
                  This is a development server. Do not use it for real student
                  records; production needs persistent PostgreSQL, storage,
                  backups and HTTPS.
                </p>
              )}
              <p>
                Only trust the address supplied by your institution. The next
                screen creates the first administrator or signs in to an
                existing account. Demo records will not be uploaded.
              </p>
              <button
                type="button"
                className="button button-primary full-width"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  setError("");
                  try {
                    await connectSchoolServer(checked.origin);
                  } catch (e) {
                    if (alive.current)
                      setError(
                        e instanceof Error ? e.message : "Connection failed.",
                      );
                  } finally {
                    if (alive.current) setBusy(false);
                  }
                }}
              >
                <ArrowRight size={17} /> Connect & continue securely
              </button>
            </section>
          )}
        </form>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {!hosted && (
        <>
          <div className="server-connection-assurance">
            <ShieldCheck size={20} />
            <p>
              {native
                ? "The check sends no account credentials. Android verifies TLS and compatibility before you approve this server."
                : "Your browser opens the school app at its own address. Sign in there; this page does not proxy credentials or check another origin’s private API."}
            </p>
          </div>
          <details className="server-hosting-help">
            <summary>Don’t have a school server yet?</summary>
            <p>
              The repository includes FastAPI, PostgreSQL migrations and a
              Docker Compose deployment with Caddy HTTPS. A server and domain
              still need to be provided by your institution. The Android APK
              does not run Python or PostgreSQL.
            </p>
            <p>
              Follow documentation/DEPLOYMENT.md, deploy the web app and /api at
              the same HTTPS origin, then enter that address here. After signing
              in as administrator, Team & access manages real teacher and
              student accounts.
            </p>
            <a
              href="https://github.com/abc07552/OMR-SHEET-Check-/blob/main/documentation/DEPLOYMENT.md"
              target="_blank"
              rel="noreferrer"
            >
              Open server deployment instructions <ArrowRight size={12} />
            </a>
          </details>
        </>
      )}
      {standalone && (
        <>
          <button
            className="text-button server-demo-link"
            onClick={close}
            disabled={busy}
          >
            Explore the separate device demo <ArrowRight size={14} />
          </button>
          <p className="small muted">
            The demo is not account-protected. Do not enter private student
            data. Existing demo records stay on this device.
          </p>
        </>
      )}
    </div>
  );
  return standalone ? (
    <main className="server-connection-screen">
      <Logo />
      <section className="server-connection-card">{contents}</section>
      <footer>OMR CHECKER AI PRO · SECURE SCHOOL SYSTEM</footer>
    </main>
  ) : (
    <Modal title="School server connection" onClose={close}>
      {contents}
    </Modal>
  );
}
