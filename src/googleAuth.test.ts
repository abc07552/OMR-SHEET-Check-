// @vitest-environment jsdom
import { webcrypto, createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  GOOGLE_PENDING_KEY,
  googleAuthorizationUrl,
  googleError,
  googleTarget,
  makeNativeProof,
  nativeGoogleReturn,
  pendingGoogle,
  startGoogle,
} from "./googleAuth";
import type { GooglePending } from "./googleAuth";
import { api } from "./session";
import { isAndroid } from "./native";
import { App } from "@capacitor/app";
import { Browser } from "@capacitor/browser";
vi.mock("./session", () => ({ API_BASE: "/api", api: vi.fn() }));
vi.mock("./native", () => ({ isAndroid: vi.fn(() => true) }));
vi.mock("@capacitor/app", () => ({
  App: { getInfo: vi.fn(async () => ({ id: "com.markly.omrpro.debug" })) },
}));
vi.mock("@capacitor/browser", () => ({
  Browser: { open: vi.fn(async () => {}) },
}));
const pending: GooglePending = {
  flowId: "qa-flow-123",
  origin: location.origin,
  intent: "login",
  createdAt: Date.now(),
  verifier: "A".repeat(43),
  appId: "com.markly.omrpro.debug",
};
beforeEach(() => {
  sessionStorage.clear();
  vi.clearAllMocks();
  vi.stubGlobal("crypto", webcrypto);
  vi.mocked(isAndroid).mockReturnValue(true);
  vi.mocked(api).mockResolvedValue({
    flowId: pending.flowId,
    authorizationUrl:
      "https://accounts.google.com/o/oauth2/v2/auth?state=synthetic",
  });
  vi.mocked(App.getInfo).mockResolvedValue({
    id: "com.markly.omrpro.debug",
    name: "QA",
    version: "0",
    build: "0",
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
});
describe("Google browser/native proof-bound authorization", () => {
  it("generates fresh high-entropy PKCE proof material and the real SHA-256 challenge", async () => {
    const proof = await makeNativeProof(),
      other = await makeNativeProof();
    expect(proof.verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(proof.challenge).toBe(
      createHash("sha256").update(proof.verifier).digest("base64url"),
    );
    expect(proof.verifier).not.toBe(other.verifier);
  });
  it("opens Android's external browser with no frontend secret and stores only this origin's handoff proof", async () => {
    await startGoogle("drive", { schoolId: "school-a" });
    expect(Browser.open).toHaveBeenCalledWith({
      url: "https://accounts.google.com/o/oauth2/v2/auth?state=synthetic",
    });
    const sent = JSON.parse(vi.mocked(api).mock.calls[0][1]!.body as string);
    expect(sent).toMatchObject({
      intent: "drive",
      schoolId: "school-a",
      clientMode: "android",
      appId: "com.markly.omrpro.debug",
    });
    expect(sent.nativeChallenge).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(JSON.stringify(sent)).not.toContain("client_secret");
    const stored = pendingGoogle()!;
    expect(stored.origin).toBe(location.origin);
    expect(
      createHash("sha256").update(stored.verifier!).digest("base64url"),
    ).toBe(sent.nativeChallenge);
    expect(sessionStorage.getItem(GOOGLE_PENDING_KEY)).not.toContain(
      "currentPassword",
    );
  });
  it("never falls back to embedded-WebView Google when the browser plugin fails", async () => {
    vi.mocked(Browser.open).mockRejectedValueOnce(
      new Error("Synthetic browser unavailable"),
    );
    await expect(startGoogle("login")).rejects.toThrow(
      "Synthetic browser unavailable",
    );
    expect(isAndroid()).toBe(true);
  });
  it("rejects unsupported native package names before an API request", async () => {
    vi.mocked(App.getInfo).mockResolvedValueOnce({
      id: "attacker.app",
      name: "QA",
      version: "0",
      build: "0",
    });
    await expect(startGoogle("login")).rejects.toThrow("not an approved");
    expect(api).not.toHaveBeenCalled();
  });
  it("accepts only the matching package, exact callback and pending flow; never arbitrary deep-link navigation", () => {
    const url = `com.markly.omrpro.debug://oauth/callback?flow=${pending.flowId}&ticket=${"T".repeat(54)}`;
    expect(nativeGoogleReturn(url, pending)).toBe(
      `/oauth/return?flow=${pending.flowId}&ticket=${"T".repeat(54)}`,
    );
    for (const bad of [
      url.replace(".debug:", ":"),
      url.replace("oauth/callback", "evil/callback"),
      url.replace("callback?", "callback/extra?"),
      url.replace("qa-flow-123", "other-flow"),
      url + "&flow=other",
      url + "&redirect=https://evil.example",
      url + "#leak",
      url.replace("ticket=", "error="),
      "https://evil.example/",
    ])
      expect(nativeGoogleReturn(bad, pending)).toBeNull();
    expect(nativeGoogleReturn(url, null)).toBeNull();
    expect(
      nativeGoogleReturn(
        `com.markly.omrpro.debug://oauth/callback?flow=${pending.flowId}&error=consent_cancelled`,
        pending,
      ),
    ).toContain("error=consent_cancelled");
  });
  it("expires pending handoffs and isolates origins / malformed local records", () => {
    sessionStorage.setItem(
      GOOGLE_PENDING_KEY,
      JSON.stringify({ ...pending, createdAt: Date.now() }),
    );
    expect(pendingGoogle()?.flowId).toBe(pending.flowId);
    for (const patch of [
      { origin: "https://other-school.example" },
      { createdAt: Date.now() - 13 * 60_000 },
      { createdAt: Date.now() + 60_000 },
      { appId: "evil" },
      { verifier: "short" },
      { intent: "admin" },
    ]) {
      sessionStorage.setItem(
        GOOGLE_PENDING_KEY,
        JSON.stringify({ ...pending, ...patch }),
      );
      expect(pendingGoogle()).toBeNull();
    }
    sessionStorage.setItem(GOOGLE_PENDING_KEY, "not JSON");
    expect(pendingGoogle()).toBeNull();
  });
  it("only accepts Google's fixed HTTPS authorization endpoint and safe local return routes", () => {
    expect(
      googleAuthorizationUrl(
        "https://accounts.google.com/o/oauth2/v2/auth?state=synthetic",
      ),
    ).toContain("https://accounts.google.com/");
    for (const url of [
      "http://accounts.google.com/o/oauth2/v2/auth",
      "https://accounts.google.com@evil.example/o/oauth2/v2/auth",
      "https://accounts.google.com.evil.example/o/oauth2/v2/auth",
      "https://accounts.google.com/o/oauth2/v2/auth#leak",
      "https://accounts.google.com/other",
    ])
      expect(() => googleAuthorizationUrl(url)).toThrow();
    expect(googleTarget("https://evil.example")).toBe("/overview");
    expect(googleTarget("drive")).toBe("/backups");
    expect(googleTarget("link")).toBe("/settings");
    expect(googleError("link_required")).toContain("never grants access");
  });
});

it("ignores a late authorization-start response after sign-out or school departure", async () => {
  let resolve!: (value: { flowId: string; authorizationUrl: string }) => void;
  vi.mocked(api).mockImplementationOnce(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  const attempt = startGoogle("login");
  await vi.waitFor(() => expect(api).toHaveBeenCalled());
  window.dispatchEvent(new Event("omr-server-leaving"));
  resolve({
    flowId: "late",
    authorizationUrl:
      "https://accounts.google.com/o/oauth2/v2/auth?state=synthetic",
  });
  await expect(attempt).rejects.toThrow("school server changed");
  expect(Browser.open).not.toHaveBeenCalled();
  expect(sessionStorage.getItem(GOOGLE_PENDING_KEY)).toBeNull();
});
