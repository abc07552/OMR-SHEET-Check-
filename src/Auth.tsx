import { useState } from "react";
import {
  Activity,
  ArrowRight,
  Check,
  Cpu,
  Database,
  LoaderCircle,
  ScanLine,
  ShieldCheck,
} from "lucide-react";
import { Logo } from "./components";
import { useSession } from "./session";
import { OfflineUnlock, RecoveryRequest } from "./AccountAccess";
import { isAndroid } from "./native";
export default function Auth() {
  const session = useSession(),
    setup = session.phase === "setup";
  const [name, setName] = useState(""),
    [school, setSchool] = useState(""),
    [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [token, setToken] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [access, setAccess] = useState<"offline" | "recovery" | null>(null);
  return (
    <>
      <div className="auth-screen">
        <div className="auth-story">
          <Logo />
          <div className="auth-orbit">
            <div />
            <ScanLine size={62} />
            <span className="orbit-node node-one">
              <Cpu size={19} />
            </span>
            <span className="orbit-node node-two">
              <Activity size={19} />
            </span>
            <span className="orbit-node node-three">
              <Check size={19} />
            </span>
          </div>
          <span className="eyebrow">THE NEXT CHAPTER OF ASSESSMENT</span>
          <h1>
            Less marking.
            <br />
            <em>More possibility.</em>
          </h1>
          <p>
            From a single answer sheet to your entire institution. One
            intelligent workspace for every learner.
          </p>
          <div className="auth-features">
            <span>
              <ScanLine size={15} /> OpenCV + OCR scanning
            </span>
            <span>
              <Database size={15} />{" "}
              {session.backend === "node"
                ? "Preserved Node · SQLite"
                : "FastAPI · PostgreSQL ready"}
            </span>
            <span>
              <ShieldCheck size={15} /> Role-based access
            </span>
          </div>
          <small>ULTIMATE OMR CHECKER / AI PRO</small>
        </div>
        <section className="auth-form-wrap">
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setError("");
              try {
                if (setup)
                  await session.setup({
                    name,
                    email,
                    password,
                    setupToken: token,
                    school: {
                      name: school,
                      code:
                        school
                          .replace(/[^a-z]/gi, "")
                          .slice(0, 5)
                          .toUpperCase() || "SCH",
                    },
                  });
                else await session.login(email, password);
              } catch (e) {
                setError(e instanceof Error ? e.message : "Sign-in failed.");
              } finally {
                setBusy(false);
              }
            }}
          >
            <span className="auth-kicker">
              <i />
              {setup
                ? "YOUR SECURE WORKSPACE STARTS HERE"
                : session.offline
                  ? "OFFLINE · YOUR WORK STAYS PRIVATE"
                  : "WELCOME BACK TO YOUR WORKSPACE"}
            </span>
            <h2>
              {setup ? "Make it your own." : "A little more insight awaits."}
            </h2>
            <p>
              {setup
                ? "Create the first school and administrator. No default passwords, no shared accounts."
                : "Sign in to your school’s shared workspace."}
            </p>
            <p className="server-origin" aria-label="Current school server">
              <ShieldCheck size={14} /> {location.origin}
            </p>
            {session.warning && (
              <p className="v2-notice warning" role="alert">
                {session.warning}
              </p>
            )}
            <div className="form-fields no-padding">
              {setup && (
                <>
                  <label>
                    Your name
                    <input
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      required
                      maxLength={120}
                      autoComplete="name"
                    />
                  </label>
                  <label>
                    School or institution
                    <input
                      value={school}
                      onChange={(e) => setSchool(e.target.value)}
                      required
                      maxLength={120}
                    />
                  </label>
                </>
              )}
              <label>
                Email address
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoComplete="username"
                  placeholder="you@school.edu"
                />
              </label>
              <label>
                {setup ? "Create a password" : "Password"}
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  minLength={12}
                  maxLength={128}
                  required
                  autoComplete={setup ? "new-password" : "current-password"}
                  placeholder="At least 12 characters"
                />
              </label>
              {setup && session.tokenRequired && (
                <label>
                  Server setup token
                  <input
                    type="password"
                    value={token}
                    onChange={(e) => setToken(e.target.value)}
                    required
                    autoComplete="off"
                  />
                  <small className="muted">
                    Provided by the person hosting your server.
                  </small>
                </label>
              )}
            </div>
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
            <button
              className="button button-primary full-width auth-submit"
              disabled={busy}
            >
              {busy ? (
                <LoaderCircle className="spinning" size={17} />
              ) : (
                <ArrowRight size={17} />
              )}{" "}
              {busy
                ? "Please wait…"
                : setup
                  ? "Create secure workspace"
                  : "Sign in to your workspace"}
            </button>
            <div className="row-actions auth-access-actions">
              {!setup && session.backend === "fastapi" && (
                <button
                  type="button"
                  className="text-button"
                  onClick={() => setAccess("recovery")}
                >
                  Forgot password?
                </button>
              )}
              <button
                type="button"
                className="text-button"
                onClick={() => setAccess("offline")}
              >
                Unlock offline workspace
              </button>
            </div>
            <button
              type="button"
              className="text-button server-demo-link"
              onClick={session.openConnection}
            >
              {isAndroid()
                ? "School server connection"
                : "Open another school server"}
            </button>
            <div className="auth-divider">
              <span>or take a look around</span>
            </div>
            <button
              type="button"
              className="button button-secondary full-width"
              onClick={session.explore}
            >
              Explore the device demo <ArrowRight size={15} />
            </button>
            <p className="auth-privacy">
              <ShieldCheck size={13} /> The device demo is separate from your
              school’s shared data. Ask an administrator if you need an account
              or password reset.
            </p>
          </form>
        </section>
      </div>
      {access === "offline" && (
        <OfflineUnlock onClose={() => setAccess(null)} />
      )}
      {access === "recovery" && (
        <RecoveryRequest onClose={() => setAccess(null)} />
      )}
    </>
  );
}
