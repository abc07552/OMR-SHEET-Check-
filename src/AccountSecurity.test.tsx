// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import AccountSecurity from "./AccountSecurity";
import { APIError, api } from "./session";
import { startGoogle } from "./googleAuth";
const { logout } = vi.hoisted(() => ({ logout: vi.fn(async () => {}) }));
vi.mock("./session", () => ({
  APIError: class extends Error {
    constructor(
      message: string,
      public status: number,
    ) {
      super(message);
    }
  },
  api: vi.fn(),
  useSession: () => ({
    user: { id: "qa", email: "qa@school.edu" },
    offline: false,
    logout,
  }),
}));
vi.mock("./googleAuth", () => ({ startGoogle: vi.fn(async () => {}) }));
let account: {
  hasPassword: boolean;
  googleLinked: boolean;
  googleEnabled: boolean;
  recentGoogleLogin: boolean;
  emailVerified: boolean;
};
beforeEach(() => {
  vi.clearAllMocks();
  account = {
    hasPassword: true,
    googleLinked: false,
    googleEnabled: true,
    recentGoogleLogin: false,
    emailVerified: true,
  };
  vi.mocked(api).mockImplementation(async (path) =>
    path === "/auth/account" ? account : { ok: true },
  );
});
afterEach(cleanup);
it("requires matching confirmed app passwords and reports failures instead of a fake success", async () => {
  render(<AccountSecurity />);
  await screen.findByText("App password set");
  fireEvent.change(screen.getByLabelText("Current app password"), {
    target: { value: "original-app-password" },
  });
  fireEvent.change(screen.getByLabelText("New app password"), {
    target: { value: "new-app-password" },
  });
  fireEvent.change(screen.getByLabelText("Confirm new app password"), {
    target: { value: "mismatched-new-password" },
  });
  fireEvent.submit(
    screen
      .getByRole("button", { name: "Change password & sign out" })
      .closest("form")!,
  );
  expect((await screen.findByRole("alert")).textContent).toContain("match");
  expect(api).toHaveBeenCalledTimes(1);
  fireEvent.change(screen.getByLabelText("Confirm new app password"), {
    target: { value: "new-app-password" },
  });
  vi.mocked(api).mockRejectedValueOnce(
    new Error("Synthetic server password refusal"),
  );
  fireEvent.submit(
    screen
      .getByRole("button", { name: "Change password & sign out" })
      .closest("form")!,
  );
  expect((await screen.findByRole("alert")).textContent).toContain(
    "Synthetic server password refusal",
  );
  expect(logout).not.toHaveBeenCalled();
});
it("only enables first-password creation after recent Google verification", async () => {
  account = { ...account, hasPassword: false, googleLinked: true };
  render(<AccountSecurity />);
  const button = await screen.findByRole("button", {
    name: "Set app password",
  });
  expect((button as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(
    screen.getByRole("button", { name: "Verify with Google again" }),
  );
  await waitFor(() => expect(startGoogle).toHaveBeenCalledWith("reauth"));
  expect(
    (
      screen.getByRole("button", {
        name: "Remove Google sign-in",
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(true);
});
it("sets the first app password without collecting a Google password and refreshes account metadata", async () => {
  account = {
    ...account,
    hasPassword: false,
    googleLinked: true,
    recentGoogleLogin: true,
  };
  render(<AccountSecurity />);
  await screen.findByText("Google-only sign-in");
  expect(screen.queryByLabelText("Current app password")).toBeNull();
  fireEvent.change(screen.getByLabelText("Create app password"), {
    target: { value: "first-app-password" },
  });
  fireEvent.change(screen.getByLabelText("Confirm new app password"), {
    target: { value: "first-app-password" },
  });
  vi.mocked(api).mockImplementation(async (path) => {
    if (path === "/auth/password/set") {
      account = { ...account, hasPassword: true };
      return { ok: true };
    }
    return account;
  });
  fireEvent.submit(
    screen.getByRole("button", { name: "Set app password" }).closest("form")!,
  );
  expect((await screen.findByRole("status")).textContent).toContain(
    "App password set",
  );
  expect(api).toHaveBeenCalledWith("/auth/password/set", {
    method: "POST",
    body: JSON.stringify({ password: "first-app-password" }),
  });
  expect(logout).not.toHaveBeenCalled();
});

it("exposes Google reauthentication when a first-password form's five-minute proof has expired on the server", async () => {
  account = {
    ...account,
    hasPassword: false,
    googleLinked: true,
    recentGoogleLogin: true,
  };
  render(<AccountSecurity />);
  await screen.findByText("Google-only sign-in");
  fireEvent.change(screen.getByLabelText("Create app password"), {
    target: { value: "first-app-password" },
  });
  fireEvent.change(screen.getByLabelText("Confirm new app password"), {
    target: { value: "first-app-password" },
  });
  vi.mocked(api).mockRejectedValueOnce(
    new APIError("Verify with Google again", 403),
  );
  fireEvent.submit(
    screen.getByRole("button", { name: "Set app password" }).closest("form")!,
  );
  expect((await screen.findByRole("alert")).textContent).toContain(
    "Verify with Google",
  );
  expect(
    (
      screen.getByRole("button", {
        name: "Set app password",
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(true);
  expect(
    screen.getByRole("button", { name: "Verify with Google again" }),
  ).toBeTruthy();
});
