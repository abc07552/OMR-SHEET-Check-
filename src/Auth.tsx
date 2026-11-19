import { useEffect, useState } from "react";
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
import { api, useSession } from "./session";
import { startGoogle } from "./googleAuth";
import type { AuthOptions } from "./googleAuth";
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
    [signup, setSignup] = useState(false),
    [confirmPassword, setConfirmPassword] = useState(""),
    [showPassword, setShowPassword] = useState(false),
    [options, setOptions] = useState<AuthOptions | null>(null),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [access, setAccess] = useState<"offline" | "recovery" | null>(null);
  useEffect(() => {
    if (session.backend !== "fastapi") return;
    let alive = true;
    void api<AuthOptions>("/auth/options")
      .then((value) => {
        if (alive) setOptions(value);
      })
      .catch((e) => {
        if (alive) setError(e.message);
      });
    return () => {
      alive = false;
    };
  }, [session.backend]);
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
              setMessage("");
              try {
                if ((signup || setup) && password !== confirmPassword)
                  throw new Error("Passwords must match.");
                if (signup && !setup) {
                  const result = await session.signup({
                    name,
                    schoolName: school,
                    email,
                    password,
                  });
                  setMessage(result.message);
                  setPassword("");
                  setConfirmPassword("");
                } else if (setup)
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
                  : signup
                    ? "YOUR NEW INSTITUTION, YOUR OWN WORKSPACE"
                    : "WELCOME BACK TO YOUR WORKSPACE"}
            </span>
            <h2>
              {setup
                ? "Make it your own."
                : signup
                  ? "Start something brilliant."
                  : "A little more insight awaits."}
            </h2>
            <p>
              {setup
                ? "Create the first school and administrator. No default passwords, no shared accounts."
                : signup
                  ? "Create a new, isolated school workspace. Joining an existing school? Ask its administrator for an account instead."
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
            {!setup && session.backend === "fastapi" && (
              <div className="auth-tabs" aria-label="Account portal">
                <button
                  type="button"
                  aria-pressed={!signup}
                  className={!signup ? "active" : ""}
                  onClick={() => {
                    setSignup(false);
                    setError("");
                    setMessage("");
                  }}
                >
                  Sign in
                </button>
                <button
                  type="button"
                  aria-pressed={signup}
                  className={signup ? "active" : ""}
                  onClick={() => {
                    setSignup(true);
                    setError("");
                    setMessage("");
                  }}
                >
                  Create institution
                </button>
              </div>
            )}
            {signup && !options?.signupEnabled && (
              <p className="v2-notice warning">
                Public institution registration is disabled on this server. Ask
                the hosting operator to enable it; existing teachers and
                students should request access from their school administrator.
              </p>
            )}
            {signup &&
              options?.signupEnabled &&
              !options.emailVerificationRequired && (
                <p className="v2-notice warning">
                  Development server: password signup does not verify email. Use
                  test data only, not a live school deployment.
                </p>
              )}
            {signup &&
              options?.emailVerificationRequired &&
              !options.passwordSignupEnabled && (
                <p className="v2-notice warning">
                  Email verification delivery is not configured. Use Google
                  signup if available, or ask the hosting operator to configure
                  SMTP.
                </p>
              )}
            {message && (
              <p className="v2-notice" role="status">
                {message}
              </p>
            )}
            <div className="form-fields no-padding">
              {(setup || signup) && (
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
                  maxLength={200}
                  autoComplete="username"
                  placeholder="you@school.edu"
                />
              </label>
              <label>
                {setup || signup ? "Create an app password" : "App password"}
                <input
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  minLength={12}
                  maxLength={128}
                  required
                  autoComplete={
                    setup || signup ? "new-password" : "current-password"
                  }
                  placeholder="At least 12 characters"
                />
              </label>
              {(setup || signup) && (
                <label>
                  Confirm app password
                  <input
                    type={showPassword ? "text" : "password"}
                    autoComplete="new-password"
                    minLength={12}
                    maxLength={128}
                    required
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                  />
                </label>
              )}
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={showPassword}
                  onChange={(e) => setShowPassword(e.target.checked)}
                />
                Show password
              </label>
              <small className="muted">
                Use a unique 12–128 character passphrase. Never enter your
                Google password here.
              </small>
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
              disabled={
                busy ||
                session.offline ||
                (signup && !setup && !options?.passwordSignupEnabled)
              }
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
                  : signup
                    ? "Create account with email"
                    : "Sign in to your workspace"}
            </button>
            {!setup && session.backend === "fastapi" && (
              <>
                <div className="auth-divider">
                  <span>or continue securely</span>
                </div>
                <button
                  type="button"
                  className="button button-secondary full-width google-button"
                  disabled={
                    busy ||
                    session.offline ||
                    !options?.googleEnabled ||
                    (signup && !options.signupEnabled)
                  }
                  onClick={async () => {
                    setError("");
                    setMessage("");
                    if (signup && !school.trim()) {
                      setError(
                        "Enter your new institution’s name before Google signup.",
                      );
                      return;
                    }
                    setBusy(true);
                    try {
                      await startGoogle(
                        signup ? "signup" : "login",
                        signup ? { schoolName: school.trim() } : {},
                      );
                    } catch (e) {
                      setError(
                        e instanceof Error
                          ? e.message
                          : "Google authorization could not start.",
                      );
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  <span className="google-mark" aria-hidden="true">
                    G
                  </span>
                  {signup ? "Sign up with Google" : "Sign in with Google"}
                </button>
                <p className="auth-privacy">
                  {options?.googleEnabled
                    ? "Google confirms your identity only. Drive backups require separate permission. Existing password users must link Google from Settings first."
                    : "Google sign-in needs the server’s Google Cloud OAuth configuration and canonical HTTPS address. Your app password still works."}
                </p>
              </>
            )}
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
