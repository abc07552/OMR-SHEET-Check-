// @vitest-environment jsdom
import { StrictMode } from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import GoogleReturn from "./GoogleReturn";
import { GOOGLE_PENDING_KEY } from "./googleAuth";
import { APIError } from "./session";
const { complete, state } = vi.hoisted(() => ({
  complete: vi.fn(),
  state: { phase: "login" },
}));
vi.mock("./session", () => ({
  API_BASE: "/api",
  api: vi.fn(),
  useSession: () => ({ phase: state.phase, completeGoogle: complete }),
  APIError: class extends Error {
    constructor(
      message: string,
      public status: number,
      public code?: string,
    ) {
      super(message);
    }
  },
}));
vi.mock("./native", () => ({ isAndroid: () => false }));
beforeEach(() => {
  state.phase = "login";
  complete.mockReset();
  complete.mockResolvedValue({ intent: "login" });
  sessionStorage.clear();
  sessionStorage.setItem(
    GOOGLE_PENDING_KEY,
    JSON.stringify({
      flowId: "qa-flow",
      origin: location.origin,
      intent: "login",
      createdAt: Date.now(),
    }),
  );
});
afterEach(() => {
  cleanup();
  sessionStorage.clear();
});
function page(query = `flow=qa-flow&ticket=${"T".repeat(54)}`) {
  return (
    <StrictMode>
      <MemoryRouter initialEntries={[`/oauth/return?${query}`]}>
        <Routes>
          <Route path="/oauth/return" element={<GoogleReturn />} />
          <Route path="/overview" element={<div>Authorized workspace</div>} />
          <Route path="/backups" element={<div>Drive recovery</div>} />
        </Routes>
      </MemoryRouter>
    </StrictMode>
  );
}
it("completes a proof-bound browser response once even with React Strict Mode, then removes local proof", async () => {
  render(page());
  await screen.findByText("Authorized workspace");
  expect(complete).toHaveBeenCalledTimes(1);
  expect(complete).toHaveBeenCalledWith({
    flowId: "qa-flow",
    ticket: "T".repeat(54),
    nativeVerifier: undefined,
  });
  expect(sessionStorage.getItem(GOOGLE_PENDING_KEY)).toBeNull();
});
it("refuses unsolicited/mismatched flow responses without contacting the completion endpoint", async () => {
  render(page(`flow=other&ticket=${"T".repeat(54)}`));
  expect((await screen.findByRole("alert")).textContent).toContain(
    "does not match",
  );
  expect(complete).not.toHaveBeenCalled();
});
it("shows a useful cancellation message instead of a fake successful login", async () => {
  render(page("flow=qa-flow&error=consent_cancelled"));
  expect((await screen.findByRole("alert")).textContent).toContain("cancelled");
  expect(complete).not.toHaveBeenCalled();
});
it("explains the password-confirmed linking requirement from an actual API error code", async () => {
  complete.mockRejectedValue(
    new APIError("Synthetic provider conflict", 409, "link_required"),
  );
  render(page());
  expect((await screen.findByRole("alert")).textContent).toContain("Settings");
  expect(screen.queryByText("Authorized workspace")).toBeNull();
});
it("waits for session bootstrap and ignores a missing local proof", async () => {
  state.phase = "checking";
  sessionStorage.clear();
  const result = render(page());
  await waitFor(() => expect(complete).not.toHaveBeenCalled());
  state.phase = "login";
  result.rerender(page());
  expect((await screen.findByRole("alert")).textContent).toContain(
    "does not match",
  );
  expect(complete).not.toHaveBeenCalled();
});
