import { beforeEach, describe, expect, it, vi } from "vitest";
import { normalizeServerOrigin } from "./serverOrigin";
import {
  checkSchoolServer,
  connectSchoolServer,
  connectionInfo,
  disconnectSchoolServer,
} from "./serverConnection";

const native = vi.hoisted(() => ({
  bundled: true,
  android: true,
  check: vi.fn(),
  connect: vi.fn(),
  disconnect: vi.fn(),
}));
vi.mock("./native", () => ({
  isAndroid: () => native.android,
  isBundledAndroid: () => native.bundled,
}));
vi.mock("@capacitor/core", () => ({ registerPlugin: () => native }));
const origin = "https://school.example";
const metadata = () => ({
  origin,
  service: "markly-api",
  backend: "fastapi",
  connectionVersion: 1,
  apiVersion: 3,
  authentication: "http-only-cookie",
  clientReady: true,
  deploymentMode: "production",
  database: "postgresql",
});
beforeEach(() => {
  vi.clearAllMocks();
  native.android = true;
  native.bundled = true;
  native.check.mockResolvedValue(metadata());
  native.connect.mockResolvedValue(undefined);
  native.disconnect.mockResolvedValue(undefined);
});
describe("explicit HTTPS school-server connection policy", () => {
  it.each([
    [" https://SCHOOL.example/ ", origin],
    ["https://school.example:443", origin],
    ["https://school.example.:8443/", "https://school.example:8443"],
    ["https://192.168.1.25", "https://192.168.1.25"],
  ])("normalizes one origin: %s", (input, expected) => {
    expect(normalizeServerOrigin(input)).toBe(expected);
  });
  it.each([
    "",
    "school.example",
    "http://school.example",
    "javascript:alert(1)",
    "https://user:private@school.example",
    "https://@school.example",
    "https://school.example/api",
    "https://school.example/?",
    "https://school.example/#",
    "https://school.example?token=secret",
    "https://school.example\\",
    "https://school.example:0",
    "https://school.example:65536",
    "https://school.example/\napi",
    "https://school.example/\u0000",
    "https://*.example",
    "https://éxample.edu",
    "https://localhost",
    "https://LOCALHOST.",
    "https://a.localhost",
    "https://127.0.0.1",
    "https://127.9.1.2",
    "https://127.1",
    "https://0.0.0.0",
    "https://[::1]",
    "https://[::]",
    "https://[::ffff:127.0.0.1]",
    "https://2130706433",
    "https://0x7f000001",
    "https://0177.0.0.1",
    "https://1.1.1.999",
    "https://a.example https://b.example",
    "https://a.example\r\nX-Test: injected",
    "x".repeat(2049),
  ])("rejects unsafe or incorrect addresses: %s", (input) => {
    expect(() => normalizeServerOrigin(input)).toThrow();
  });
  it("passes only an explicit normalized origin to the credential-free native probe", async () => {
    expect(await checkSchoolServer(" https://SCHOOL.example/ ")).toEqual({
      origin,
      deploymentMode: "production",
      database: "postgresql",
    });
    expect(native.check).toHaveBeenCalledWith({ origin });
    expect(native.connect).not.toHaveBeenCalled();
  });
  it.each([
    null,
    {},
    { ...metadata(), backend: "node" },
    { ...metadata(), service: "other-app" },
    { ...metadata(), apiVersion: 2 },
    { ...metadata(), connectionVersion: 2 },
    { ...metadata(), authentication: "local-demo" },
    { ...metadata(), clientReady: false },
    { ...metadata(), clientReady: "true" },
    { ...metadata(), origin: "https://other-school.example" },
    { ...metadata(), database: "sqlite" },
    { ...metadata(), deploymentMode: "unknown" },
  ])("does not accept incompatible or API-only endpoints: %j", (data) => {
    expect(() => connectionInfo(data, origin)).toThrow();
  });
  it("labels a real development SQLite deployment without claiming production", () => {
    expect(
      connectionInfo(
        { ...metadata(), deploymentMode: "development", database: "sqlite" },
        origin,
      ),
    ).toEqual({ origin, deploymentMode: "development", database: "sqlite" });
  });
  it("propagates certificate, network and cancellation failures without fake success", async () => {
    native.check.mockRejectedValueOnce(new Error("Certificate invalid"));
    await expect(checkSchoolServer(origin)).rejects.toThrow(
      "Certificate invalid",
    );
    native.connect.mockRejectedValueOnce(new Error("Connection cancelled"));
    await expect(connectSchoolServer(origin)).rejects.toThrow("cancelled");
  });
  it("never calls the bridge with invalid addresses or probes/repoints a different school from hosted content", async () => {
    await expect(checkSchoolServer("http://school.example")).rejects.toThrow();
    await expect(connectSchoolServer("https://localhost")).rejects.toThrow();
    expect(native.check).not.toHaveBeenCalled();
    expect(native.connect).not.toHaveBeenCalled();
    native.bundled = false;
    await expect(checkSchoolServer(origin)).rejects.toThrow(
      "connection screen",
    );
    await expect(connectSchoolServer(origin)).rejects.toThrow("Disconnect");
    expect(native.check).not.toHaveBeenCalled();
    expect(native.connect).not.toHaveBeenCalled();
  });
  it("awaits native approval and never stores a server credential in web storage", async () => {
    await connectSchoolServer(origin);
    expect(native.connect).toHaveBeenCalledWith({ origin });
    await disconnectSchoolServer();
    expect(native.disconnect).toHaveBeenCalledOnce();
    native.android = false;
    await expect(disconnectSchoolServer()).rejects.toThrow("Android");
  });
});

it("rejects raw surrounding control characters before URL whitespace normalization", () => {
  for (const input of [
    "\nhttps://school.example",
    "https://school.example\n",
    "\u0000https://school.example/",
  ]) {
    expect(() => normalizeServerOrigin(input)).toThrow();
  }
});
