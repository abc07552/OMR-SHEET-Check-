// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { GoogleNativeBridge } from "./GoogleReturn";
import { GOOGLE_PENDING_KEY } from "./googleAuth";
import { App } from "@capacitor/app";
const { handlers, remove } = vi.hoisted(() => ({
  handlers: [] as Array<(event: { url: string }) => void>,
  remove: vi.fn(async () => {}),
}));
vi.mock("./session", () => ({
  API_BASE: "/api",
  api: vi.fn(),
  APIError: Error,
  useSession: vi.fn(),
}));
vi.mock("./native", () => ({ isAndroid: () => true }));
vi.mock("@capacitor/app", () => ({
  App: {
    addListener: vi.fn(async (_name, callback) => {
      handlers.push(callback);
      return { remove };
    }),
    getLaunchUrl: vi.fn(async () => undefined),
  },
}));
const ticket = "T".repeat(54),
  callback = `com.markly.omrpro.debug://oauth/callback?flow=qa-native&ticket=${ticket}`;
beforeEach(() => {
  vi.clearAllMocks();
  handlers.length = 0;
  vi.mocked(App.getLaunchUrl).mockResolvedValue(undefined);
  sessionStorage.clear();
  sessionStorage.setItem(
    GOOGLE_PENDING_KEY,
    JSON.stringify({
      flowId: "qa-native",
      appId: "com.markly.omrpro.debug",
      verifier: "A".repeat(43),
      origin: location.origin,
      createdAt: Date.now(),
      intent: "login",
    }),
  );
});
afterEach(() => {
  cleanup();
  sessionStorage.clear();
});
function Screen() {
  const route = useLocation();
  return (
    <>
      <GoogleNativeBridge />
      <output aria-label="Current route">
        {route.pathname + route.search}
      </output>
    </>
  );
}
function page() {
  return (
    <MemoryRouter initialEntries={["/overview"]}>
      <Screen />
    </MemoryRouter>
  );
}
it("recovers a cold-launch callback only when the same origin's native proof survived", async () => {
  vi.mocked(App.getLaunchUrl).mockResolvedValue({ url: callback });
  const view = render(page());
  await waitFor(() =>
    expect(screen.getByLabelText("Current route").textContent).toBe(
      `/oauth/return?flow=qa-native&ticket=${ticket}`,
    ),
  );
  expect(App.addListener).toHaveBeenCalledWith(
    "appUrlOpen",
    expect.any(Function),
  );
  view.unmount();
  expect(remove).toHaveBeenCalledTimes(1);
});
it("handles warm appUrlOpen without trusting an arbitrary deep-link or switching school servers", async () => {
  render(page());
  await waitFor(() => expect(handlers).toHaveLength(1));
  act(() => handlers[0]({ url: "https://unapproved.example/#/overview" }));
  expect(screen.getByLabelText("Current route").textContent).toBe("/overview");
  act(() => handlers[0]({ url: callback }));
  await waitFor(() =>
    expect(screen.getByLabelText("Current route").textContent).toContain(
      "/oauth/return?flow=qa-native",
    ),
  );
});
it("fails closed after process-death storage loss, sign-out or approved-server departure", async () => {
  sessionStorage.clear();
  vi.mocked(App.getLaunchUrl).mockResolvedValue({ url: callback });
  render(page());
  await waitFor(() => expect(App.getLaunchUrl).toHaveBeenCalled());
  expect(screen.getByLabelText("Current route").textContent).toBe("/overview");
  for (const name of ["omr-server-leaving", "omr-google-cancelled"]) {
    sessionStorage.setItem(
      GOOGLE_PENDING_KEY,
      JSON.stringify({
        flowId: "qa-native",
        appId: "com.markly.omrpro.debug",
        verifier: "A".repeat(43),
        origin: location.origin,
        createdAt: Date.now(),
        intent: "login",
      }),
    );
    act(() => window.dispatchEvent(new Event(name)));
    expect(sessionStorage.getItem(GOOGLE_PENDING_KEY)).toBeNull();
    act(() => handlers[0]({ url: callback }));
    expect(screen.getByLabelText("Current route").textContent).toBe(
      "/overview",
    );
  }
});
it("shows native-plugin failure rather than navigating OAuth inside the WebView", async () => {
  vi.mocked(App.getLaunchUrl).mockRejectedValueOnce(
    new Error("Synthetic native bridge failure"),
  );
  render(page());
  expect((await screen.findByRole("alert")).textContent).toContain(
    "never opened inside the WebView",
  );
  expect(screen.getByLabelText("Current route").textContent).toBe("/overview");
});
