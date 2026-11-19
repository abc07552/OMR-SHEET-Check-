import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { LoaderCircle, ShieldCheck } from "lucide-react";
import { Logo } from "./components";
import { APIError, useSession } from "./session";
import { isAndroid } from "./native";
import {
  clearGoogle,
  googleError,
  googleTarget,
  nativeGoogleReturn,
  pendingGoogle,
} from "./googleAuth";

/** Never navigates arbitrary incoming deep links or calls Google from the WebView. */
export function GoogleNativeBridge() {
  const navigate = useNavigate();
  const navigateRef = useRef(navigate);
  useLayoutEffect(() => {
    navigateRef.current = navigate;
  }, [navigate]);
  const [error, setError] = useState("");
  useEffect(() => {
    const cancel = () => clearGoogle();
    window.addEventListener("omr-server-leaving", cancel);
    window.addEventListener("omr-google-cancelled", cancel);
    let alive = true;
    let remove: (() => Promise<void>) | undefined;
    if (isAndroid())
      void (async () => {
        const { App } = await import("@capacitor/app");
        const handle = ({ url }: { url: string }) => {
          const route = nativeGoogleReturn(url, pendingGoogle());
          if (alive && route) navigateRef.current(route, { replace: true });
        };
        const listener = await App.addListener("appUrlOpen", handle);
        if (!alive) {
          await listener.remove();
          return;
        }
        remove = () => listener.remove();
        const launch = await App.getLaunchUrl();
        if (launch && alive) handle(launch);
      })().catch(() => {
        if (alive)
          setError(
            "The Android Google return handler could not start. Close and reopen the installed app before signing in with Google. App-password login is still available; OAuth is never opened inside the WebView.",
          );
      });
    return () => {
      alive = false;
      if (remove) void remove();
      window.removeEventListener("omr-server-leaving", cancel);
      window.removeEventListener("omr-google-cancelled", cancel);
    };
  }, []);
  return error ? (
    <div className="v2-notice warning" role="alert">
      {error}
    </div>
  ) : null;
}
export default function GoogleReturn() {
  const route = useLocation(),
    navigate = useNavigate(),
    session = useSession();
  const [handoff] = useState(() => ({
    params: new URLSearchParams(route.search),
    pending: pendingGoogle(),
  }));
  const [error, setError] = useState("");
  const task = useRef<Promise<{ intent: string; schoolId?: string }> | null>(
    null,
  );
  const checking = session.phase === "checking";
  useLayoutEffect(() => {
    // Completion is proof-bound, short-lived and single-use; still remove the ticket from history immediately.
    window.history.replaceState(
      window.history.state,
      "",
      window.location.pathname + window.location.search + "#/oauth/return",
    );
  }, []);
  useEffect(() => {
    if (checking) return;
    let alive = true;
    const { params, pending } = handoff;
    const flow = params.get("flow"),
      ticket = params.get("ticket"),
      failure = params.get("error");
    if (
      !pending ||
      flow !== pending.flowId ||
      (isAndroid() ? !pending.verifier : !!pending.verifier)
    ) {
      setError(
        "This Google response does not match a sign-in started in this browser/device, or it expired. Start again here. No school records were changed.",
      );
      return;
    }
    if (failure || !ticket) {
      clearGoogle();
      setError(googleError(failure || "invalid_response"));
      return;
    }
    if (!task.current)
      task.current = session.completeGoogle({
        flowId: flow!,
        ticket,
        nativeVerifier: pending.verifier,
      });
    void task.current
      .then((result) => {
        if (!alive) return;
        clearGoogle();
        navigate(googleTarget(result.intent), { replace: true });
      })
      .catch((e) => {
        if (!alive) return;
        clearGoogle();
        setError(
          e instanceof APIError && e.code
            ? googleError(e.code)
            : e instanceof Error
              ? e.message
              : "Google sign-in failed.",
        );
      });
    return () => {
      alive = false;
    };
  }, [checking, handoff, navigate]);
  return (
    <div className="initial-loader reset-account">
      <Logo />
      <section className="card oauth-return" aria-live="polite">
        <ShieldCheck size={30} />
        <h1>
          {error
            ? "Let’s reconnect securely."
            : "Finishing Google authorization…"}
        </h1>
        {error ? (
          <>
            <p className="form-error" role="alert">
              {error}
            </p>
            <button
              className="button button-primary"
              onClick={() => {
                clearGoogle();
                navigate(googleTarget(handoff.pending?.intent), {
                  replace: true,
                });
              }}
            >
              Return to{" "}
              {handoff.pending?.intent === "drive"
                ? "backups"
                : handoff.pending?.intent === "link" ||
                    handoff.pending?.intent === "reauth"
                  ? "settings"
                  : "sign in"}
            </button>
          </>
        ) : (
          <>
            <LoaderCircle className="spinning" size={22} />
            <p>
              A verified Google identity, not an email match, is required. Keep
              this page open.
            </p>
          </>
        )}
      </section>
    </div>
  );
}
