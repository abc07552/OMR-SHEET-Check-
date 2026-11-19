// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ServerConnection from "./ServerConnection";

const test = vi.hoisted(() => ({
  android: true,
  bundled: true,
  check: vi.fn(),
  connect: vi.fn(),
  disconnect: vi.fn(),
  status: vi.fn(),
  open: vi.fn(),
  session: { explore: vi.fn(), closeConnection: vi.fn(), logout: vi.fn() },
}));
vi.mock("./native", () => ({
  isAndroid: () => test.android,
  isBundledAndroid: () => test.bundled,
}));
vi.mock("./serverConnection", () => ({
  checkSchoolServer: test.check,
  connectSchoolServer: test.connect,
  disconnectSchoolServer: test.disconnect,
  schoolConnectionStatus: test.status,
  openSchoolServer: test.open,
}));
vi.mock("./session", () => ({ useSession: () => test.session }));
const origin = "https://school.example";
const info = { origin, deploymentMode: "production", database: "postgresql" };
const address = () => screen.getByLabelText("School server address");
const check = () => screen.getByRole("button", { name: "Check server" });
beforeEach(() => {
  vi.resetAllMocks();
  test.android = true;
  test.bundled = true;
  test.status.mockResolvedValue({ origin: "", lastOrigin: "" });
  test.check.mockResolvedValue(info);
  test.connect.mockResolvedValue(undefined);
  test.session.logout.mockResolvedValue(undefined);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
describe("school connection onboarding, not fake account administration", () => {
  it("requires explicit server entry and check before offering secure connection", async () => {
    render(<ServerConnection standalone />);
    expect(
      screen.getByRole("heading", { name: "Connect your school." }),
    ).toBeTruthy();
    expect(check().matches(":disabled")).toBe(true);
    expect(test.check).not.toHaveBeenCalled();
    expect(
      screen.queryByRole("button", { name: "Connect & continue securely" }),
    ).toBeNull();
    fireEvent.change(address(), { target: { value: origin } });
    fireEvent.click(check());
    await screen.findByText("FastAPI system is reachable");
    expect(test.check).toHaveBeenCalledWith(origin);
    expect(screen.getByText("PostgreSQL · Production mode")).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: "Connect & continue securely" }),
    );
    await waitFor(() => expect(test.connect).toHaveBeenCalledWith(origin));
    expect(test.session.explore).not.toHaveBeenCalled();
    expect(test.session.logout).not.toHaveBeenCalled();
  });
  it("invalidates a previous check when the address changes and prevents unsafe URLs reaching the bridge", async () => {
    render(<ServerConnection standalone />);
    fireEvent.change(address(), { target: { value: origin } });
    fireEvent.click(check());
    await screen.findByText("FastAPI system is reachable");
    fireEvent.change(address(), {
      target: { value: "http://insecure.example" },
    });
    expect(screen.queryByText("FastAPI system is reachable")).toBeNull();
    fireEvent.click(check());
    await screen.findByRole("alert");
    expect(test.check).toHaveBeenCalledOnce();
    expect(test.connect).not.toHaveBeenCalled();
  });
  it("surfaces real connection failure and native cancellation without navigating to a false signed-in state", async () => {
    test.check.mockRejectedValueOnce(
      new Error("Certificate could not be verified"),
    );
    render(<ServerConnection standalone />);
    fireEvent.change(address(), { target: { value: origin } });
    fireEvent.click(check());
    expect((await screen.findByRole("alert")).textContent).toContain(
      "Certificate",
    );
    test.connect.mockRejectedValueOnce(
      new Error("Connection cancelled. Nothing was changed."),
    );
    fireEvent.click(check());
    await screen.findByText("FastAPI system is reachable");
    fireEvent.click(
      screen.getByRole("button", { name: "Connect & continue securely" }),
    );
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain("cancelled"),
    );
    expect(test.session.explore).not.toHaveBeenCalled();
  });
  it("warns clearly about development SQLite rather than presenting it as a production database", async () => {
    test.check.mockResolvedValueOnce({
      ...info,
      deploymentMode: "development",
      database: "sqlite",
    });
    render(<ServerConnection standalone />);
    fireEvent.change(address(), { target: { value: origin } });
    fireEvent.click(check());
    await screen.findByText("FastAPI system is reachable");
    expect(
      screen.getByText(/Do not use it for real student records/),
    ).toBeTruthy();
    expect(screen.getByText("SQLite · Development / test mode")).toBeTruthy();
  });
  it("never lets a late saved-address lookup replace the address being typed", async () => {
    let finish!: (value: { origin: string; lastOrigin: string }) => void;
    test.status.mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    render(<ServerConnection standalone />);
    fireEvent.change(address(), { target: { value: origin } });
    await act(async () =>
      finish({ origin: "", lastOrigin: "https://old.example" }),
    );
    expect((address() as HTMLInputElement).value).toBe(origin);
  });
  it("retains the explicit separate-demo choice and never checks/uploads without approval", () => {
    render(<ServerConnection standalone />);
    fireEvent.click(
      screen.getByRole("button", { name: /Explore the separate device demo/ }),
    );
    expect(test.session.explore).toHaveBeenCalledOnce();
    expect(test.check).not.toHaveBeenCalled();
    expect(test.connect).not.toHaveBeenCalled();
  });
  it("ordinary browsers open the complete school origin without cross-origin credential probes", async () => {
    test.android = false;
    test.bundled = false;
    render(<ServerConnection />);
    fireEvent.change(address(), { target: { value: origin } });
    fireEvent.click(
      screen.getByRole("button", { name: "Open school sign-in" }),
    );
    await waitFor(() => expect(test.open).toHaveBeenCalledWith(origin));
    expect(test.check).not.toHaveBeenCalled();
    expect(test.connect).not.toHaveBeenCalled();
  });
  it("requires deliberate sign-out and native confirmation before leaving a hosted school", async () => {
    test.bundled = false;
    vi.spyOn(window, "confirm").mockReturnValue(true);
    test.disconnect.mockRejectedValueOnce(
      new Error("Disconnection cancelled."),
    );
    render(<ServerConnection />);
    expect(screen.getByLabelText("Current school server")).toBeTruthy();
    expect(screen.queryByLabelText("School server address")).toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: "Sign out & disconnect" }),
    );
    await waitFor(() => expect(test.disconnect).toHaveBeenCalledOnce());
    expect(test.session.logout).toHaveBeenCalledOnce();
    expect((await screen.findByRole("alert")).textContent).toContain(
      "cancelled",
    );
    expect(test.connect).not.toHaveBeenCalled();
  });
});
