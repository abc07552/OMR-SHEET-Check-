import { api, API_BASE } from "./session";
import { isAndroid } from "./native";

export type GoogleIntent = "login" | "signup" | "link" | "reauth" | "drive";
export const GOOGLE_PENDING_KEY = "omr-google-pending-v1";
export interface GooglePending {
  flowId: string;
  origin: string;
  intent: GoogleIntent;
  createdAt: number;
  verifier?: string;
  appId?: string;
  schoolId?: string;
}
export interface AuthOptions {
  signupEnabled: boolean;
  passwordSignupEnabled: boolean;
  emailVerificationRequired: boolean;
  googleEnabled: boolean;
  googleConfigured: boolean;
  driveEnabled: boolean;
  emailConfigured: boolean;
}
const APP_IDS = new Set(["com.markly.omrpro", "com.markly.omrpro.debug"]);
const base64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

export async function makeNativeProof() {
  const verifier = base64url(crypto.getRandomValues(new Uint8Array(32)));
  const hash = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(verifier),
  );
  return { verifier, challenge: base64url(new Uint8Array(hash)) };
}
export function pendingGoogle(): GooglePending | null {
  try {
    const value = JSON.parse(
      sessionStorage.getItem(GOOGLE_PENDING_KEY) || "null",
    );
    if (
      !value ||
      value.origin !== location.origin ||
      typeof value.flowId !== "string" ||
      !/^[a-zA-Z0-9-]{1,120}$/.test(value.flowId) ||
      !["login", "signup", "link", "reauth", "drive"].includes(value.intent) ||
      !Number.isFinite(value.createdAt) ||
      value.createdAt > Date.now() ||
      Date.now() - value.createdAt > 12 * 60_000 ||
      (value.appId &&
        (!APP_IDS.has(value.appId) ||
          !/^[A-Za-z0-9_-]{43}$/.test(value.verifier)))
    )
      return null;
    return value;
  } catch {
    return null;
  }
}
export function clearGoogle() {
  sessionStorage.removeItem(GOOGLE_PENDING_KEY);
}
export function googleTarget(intent?: string) {
  return intent === "drive"
    ? "/backups"
    : intent === "link" || intent === "reauth"
      ? "/settings"
      : "/overview";
}
export function googleError(code: string) {
  const errors: Record<string, string> = {
    consent_cancelled:
      "Google authorization was cancelled. Your app account and records were not changed.",
    link_required:
      "An account with this email already exists. Sign in with its app password, then link Google in Settings. Email matching alone never grants access.",
    signup_required:
      "This Google account is not linked yet. Create a new institution from Sign up, or ask your school administrator for an account and link it in Settings.",
    account_exists:
      "This Google account is already registered. Choose Sign in instead.",
    wrong_google_account:
      "Choose the Google account already linked to your app account.",
    google_already_linked:
      "This Google identity or app account is already linked. Remove the old sign-in only after setting an app password.",
    session_changed:
      "Your app session changed or expired during authorization. Sign in again and restart Google authorization.",
    account_suspended:
      "This account is suspended. Contact your institution administrator.",
    drive_consent_required:
      "Allow the private app-data backup permission to connect Drive. You can still use the app without it.",
    drive_offline_consent_required:
      "Google did not grant offline backup access. Restart Drive connection and approve the separate backup permission.",
    invalid_google_identity:
      "Google's identity could not be verified. Restart sign-in or contact the server operator.",
  };
  return (
    errors[code] ||
    "Google authorization could not be completed. Restart it from this device and contact your hosting operator if it persists."
  );
}
export function googleAuthorizationUrl(value: string) {
  const url = new URL(value);
  if (
    /[\u0000-\u0020\u007f]/.test(value) ||
    url.origin !== "https://accounts.google.com" ||
    url.pathname !== "/o/oauth2/v2/auth" ||
    url.username ||
    url.password ||
    url.hash
  )
    throw new Error(
      "The server returned an invalid Google authorization address.",
    );
  return url.href;
}
export function nativeGoogleReturn(
  value: string,
  pending: GooglePending | null,
) {
  if (
    !pending?.appId ||
    value.length > 2048 ||
    /[\u0000-\u0020\u007f]/.test(value)
  )
    return null;
  try {
    const url = new URL(value);
    if (
      url.protocol !== `${pending.appId}:` ||
      url.hostname !== "oauth" ||
      url.pathname !== "/callback" ||
      url.username ||
      url.password ||
      url.port ||
      url.hash ||
      url.searchParams.get("flow") !== pending.flowId ||
      [...url.searchParams.keys()].some(
        (k) =>
          !["flow", "ticket", "error"].includes(k) ||
          url.searchParams.getAll(k).length !== 1,
      )
    )
      return null;
    const ticket = url.searchParams.get("ticket"),
      error = url.searchParams.get("error");
    if (
      ticket
        ? !/^[A-Za-z0-9_-]{30,128}$/.test(ticket) || !!error
        : !error || !/^[a-z_]{1,80}$/.test(error)
    )
      return null;
    return "/oauth/return?" + url.searchParams.toString();
  } catch {
    return null;
  }
}
export async function startGoogle(
  intent: GoogleIntent,
  extra: {
    schoolId?: string;
    schoolName?: string;
    currentPassword?: string;
  } = {},
) {
  if (API_BASE !== "/api")
    throw new Error(
      "Google authorization requires the complete app and API at the same canonical HTTPS school-server origin.",
    );
  clearGoogle();
  const controller = new AbortController();
  const cancel = () => {
    controller.abort();
    clearGoogle();
  };
  const assertActive = () => {
    if (controller.signal.aborted)
      throw new Error(
        "Authentication or the school server changed. Start Google authorization again.",
      );
  };
  window.addEventListener("omr-server-leaving", cancel);
  window.addEventListener("omr-google-cancelled", cancel);
  try {
    const native = isAndroid();
    let appId: string | undefined;
    let proof: Awaited<ReturnType<typeof makeNativeProof>> | undefined;
    if (native) {
      const { App } = await import("@capacitor/app");
      appId = (await App.getInfo()).id;
      if (!APP_IDS.has(appId))
        throw new Error(
          "This Android application ID is not an approved Google callback target.",
        );
      proof = await makeNativeProof();
    }
    assertActive();
    const result = await api<{ flowId: string; authorizationUrl: string }>(
      "/oauth/google/start",
      {
        method: "POST",
        signal: controller.signal,
        body: JSON.stringify({
          intent,
          ...extra,
          clientMode: native ? "android" : "web",
          appId,
          nativeChallenge: proof?.challenge,
        }),
      },
    );
    assertActive();
    const url = googleAuthorizationUrl(result.authorizationUrl);
    sessionStorage.setItem(
      GOOGLE_PENDING_KEY,
      JSON.stringify({
        flowId: result.flowId,
        intent,
        origin: location.origin,
        createdAt: Date.now(),
        verifier: proof?.verifier,
        appId,
        schoolId: extra.schoolId,
      } satisfies GooglePending),
    );
    if (native) {
      // Google disallows OAuth in embedded WebViews. Browser opens an Android Custom Tab.
      const { Browser } = await import("@capacitor/browser");
      assertActive();
      await Browser.open({ url });
    } else window.location.assign(url);
  } catch (error) {
    clearGoogle();
    throw error;
  } finally {
    window.removeEventListener("omr-server-leaving", cancel);
    window.removeEventListener("omr-google-cancelled", cancel);
  }
}
