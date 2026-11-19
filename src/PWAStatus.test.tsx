// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import PWAStatus from "./PWAStatus";

const mocks = vi.hoisted(() => ({
  bundled: vi.fn(() => false),
  register: vi.fn<
    (options: {
      onNeedRefresh: () => void;
      onOfflineReady: () => void;
      onRegisterError: (error: unknown) => void;
    }) => (reload?: boolean) => Promise<void>
  >(() => async () => {}),
}));
vi.mock("./native", () => ({ isBundledAndroid: mocks.bundled }));
vi.mock("virtual:pwa-register", () => ({ registerSW: mocks.register }));
beforeEach(() => {
  vi.clearAllMocks();
  mocks.bundled.mockReturnValue(false);
  delete document.documentElement.dataset.offlineShell;
});
afterEach(() => cleanup());

describe("native versus hosted application shell", () => {
  it("does not register or offer a PWA over bundled APK assets", () => {
    mocks.bundled.mockReturnValue(true);
    render(<PWAStatus />);
    expect(mocks.register).not.toHaveBeenCalled();
    expect(document.documentElement.dataset.offlineShell).toBe("native");
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("preserves normal hosted PWA registration and reports actual cache readiness", () => {
    render(<PWAStatus />);
    expect(mocks.register).toHaveBeenCalledOnce();
    expect(document.documentElement.dataset.offlineShell).toBeUndefined();
    act(() => mocks.register.mock.calls[0][0].onOfflineReady());
    expect(document.documentElement.dataset.offlineShell).toBe("ready");
  });

  it("retains visible hosted registration failures rather than suppressing them", () => {
    render(<PWAStatus />);
    act(() =>
      mocks.register.mock.calls[0][0].onRegisterError(
        new Error("Storage unavailable"),
      ),
    );
    expect(screen.getByRole("status").textContent).toContain(
      "Storage unavailable",
    );
  });
});
