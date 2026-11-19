import { useEffect, useState } from "react";
import { KeyRound, LoaderCircle, ShieldCheck } from "lucide-react";
import { APIError, api, useSession } from "./session";
import { startGoogle } from "./googleAuth";

interface Account {
  hasPassword: boolean;
  emailVerified: boolean;
  googleLinked: boolean;
  googleEmail?: string;
  recentGoogleLogin: boolean;
  googleEnabled: boolean;
}
export default function AccountSecurity() {
  const session = useSession();
  const [account, setAccount] = useState<Account | null>(null),
    [error, setError] = useState(""),
    [current, setCurrent] = useState(""),
    [password, setPassword] = useState(""),
    [confirm, setConfirm] = useState(""),
    [busy, setBusy] = useState(""),
    [message, setMessage] = useState("");
  useEffect(() => {
    let alive = true;
    void api<Account>("/auth/account")
      .then((v) => {
        if (alive) setAccount(v);
      })
      .catch((e) => {
        if (alive) setError(e.message);
      });
    return () => {
      alive = false;
    };
  }, [session.user?.id]);
  const action = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    setError("");
    setMessage("");
    try {
      await fn();
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Account security could not be updated.",
      );
    } finally {
      setBusy("");
    }
  };
  return (
    <section className="card account-security">
      <div className="card-heading">
        <div>
          <h2>
            <ShieldCheck size={18} /> Sign-in & security
          </h2>
          <p>
            App passwords and Google sign-in are separate from Drive backup
            authorization.
          </p>
        </div>
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
        {!account && error && (
          <button
            className="button button-secondary"
            disabled={!!busy || session.offline}
            onClick={() =>
              void action("reload", async () =>
                setAccount(await api<Account>("/auth/account")),
              )
            }
          >
            Retry account security
          </button>
        )}
        {!account && !error && (
          <p>
            <LoaderCircle className="spinning" size={18} /> Loading account
            security…
          </p>
        )}
        {account && (
          <>
            <div className="security-summary">
              <strong>{session.user?.email}</strong>
              <span className="soft-tag">
                {account.hasPassword
                  ? "App password set"
                  : "Google-only sign-in"}
              </span>
            </div>
            {!account.hasPassword && (
              <p className="v2-notice">
                Set an app password to sign in without Google and confirm
                sensitive actions such as backup restoration. Your Google
                password is never requested by this app.
              </p>
            )}
            <form
              className="security-form"
              onSubmit={(e) => {
                e.preventDefault();
                if (password !== confirm) {
                  setError("Passwords must match.");
                  return;
                }
                void action("password", async () => {
                  if (account.hasPassword) {
                    await api("/auth/password", {
                      method: "POST",
                      body: JSON.stringify({
                        currentPassword: current,
                        password,
                      }),
                    });
                    setCurrent("");
                    setPassword("");
                    setConfirm("");
                    await session.logout();
                  } else {
                    try {
                      await api("/auth/password/set", {
                        method: "POST",
                        body: JSON.stringify({ password }),
                      });
                    } catch (error) {
                      if (error instanceof APIError && error.status === 403)
                        setAccount((previous) =>
                          previous
                            ? { ...previous, recentGoogleLogin: false }
                            : previous,
                        );
                      throw error;
                    }
                    setPassword("");
                    setConfirm("");
                    setAccount(await api<Account>("/auth/account"));
                    setMessage(
                      "App password set. Prior sessions were revoked; this device has a new session.",
                    );
                  }
                });
              }}
            >
              {account.hasPassword && (
                <label>
                  Current app password
                  <input
                    type="password"
                    autoComplete="current-password"
                    required
                    maxLength={128}
                    value={current}
                    onChange={(e) => setCurrent(e.target.value)}
                  />
                </label>
              )}
              <label>
                {account.hasPassword
                  ? "New app password"
                  : "Create app password"}
                <input
                  type="password"
                  autoComplete="new-password"
                  required
                  minLength={12}
                  maxLength={128}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </label>
              <label>
                Confirm new app password
                <input
                  type="password"
                  autoComplete="new-password"
                  required
                  minLength={12}
                  maxLength={128}
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                />
              </label>
              <small className="muted">
                12–128 characters. Use a unique passphrase. Changing it signs
                out all sessions, including this one.
              </small>
              {!account.hasPassword && !account.recentGoogleLogin && (
                <button
                  type="button"
                  className="button button-secondary"
                  disabled={!!busy || session.offline || !account.googleEnabled}
                  onClick={() =>
                    void action("reauth", () => startGoogle("reauth"))
                  }
                >
                  Verify with Google again
                </button>
              )}
              <button
                className="button button-primary"
                disabled={
                  !!busy ||
                  session.offline ||
                  (!account.hasPassword && !account.recentGoogleLogin)
                }
              >
                <KeyRound size={16} />
                {account.hasPassword
                  ? "Change password & sign out"
                  : "Set app password"}
              </button>
            </form>
            <div className="security-google">
              <h3>Google sign-in</h3>
              <p>
                {account.googleLinked
                  ? `Linked to ${account.googleEmail}.`
                  : "Not linked. Linking requires your current app password; matching email addresses never auto-link accounts."}
              </p>
              {!account.googleEnabled && (
                <p className="small muted">
                  The server operator must configure Google Cloud OAuth and the
                  canonical HTTPS app address first.
                </p>
              )}
              {account.googleLinked ? (
                <form
                  className="security-form"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void action("unlink", async () => {
                      if (!confirmRemove()) return;
                      await api("/oauth/google/unlink", {
                        method: "POST",
                        body: JSON.stringify({ currentPassword: current }),
                      });
                      setCurrent("");
                      setAccount(await api<Account>("/auth/account"));
                      setMessage(
                        "Google sign-in removed. Your Drive backup connection was not changed.",
                      );
                    });
                  }}
                >
                  {account.hasPassword && (
                    <label>
                      App password to remove Google
                      <input
                        type="password"
                        autoComplete="current-password"
                        minLength={12}
                        maxLength={128}
                        required
                        value={current}
                        onChange={(e) => setCurrent(e.target.value)}
                      />
                    </label>
                  )}
                  <button
                    className="button button-secondary"
                    disabled={!!busy || !account.hasPassword || session.offline}
                  >
                    Remove Google sign-in
                  </button>
                  {!account.hasPassword && (
                    <small className="muted">
                      Set an app password first so you cannot lock yourself out.
                    </small>
                  )}
                </form>
              ) : (
                <form
                  className="security-form"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void action("link", () =>
                      startGoogle("link", { currentPassword: current }),
                    );
                  }}
                >
                  <label>
                    App password to link Google
                    <input
                      type="password"
                      autoComplete="current-password"
                      minLength={12}
                      maxLength={128}
                      required
                      value={current}
                      onChange={(e) => setCurrent(e.target.value)}
                    />
                  </label>
                  <button
                    className="button button-secondary"
                    disabled={
                      !!busy || !account.googleEnabled || session.offline
                    }
                  >
                    Link Google sign-in
                  </button>
                </form>
              )}
            </div>
          </>
        )}
      </div>
    </section>
  );
}
function confirmRemove() {
  return window.confirm(
    "Remove Google sign-in? Your app password will still work. Prior sessions will be revoked; Drive backup access is separate.",
  );
}
