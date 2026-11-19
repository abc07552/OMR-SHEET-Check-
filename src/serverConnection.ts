import { registerPlugin } from "@capacitor/core";
import { isAndroid, isBundledAndroid } from "./native";
import { normalizeServerOrigin } from "./serverOrigin";

export interface SchoolConnectionInfo {
  origin: string;
  deploymentMode: "production" | "development";
  database: "postgresql" | "sqlite";
}
interface SchoolServerPlugin {
  status(): Promise<{ origin: string; lastOrigin: string }>;
  check(options: { origin: string }): Promise<unknown>;
  connect(options: { origin: string }): Promise<void>;
  disconnect(): Promise<void>;
}
const SchoolServer = registerPlugin<SchoolServerPlugin>("SchoolServer");

export function connectionInfo(
  value: unknown,
  origin: string,
): SchoolConnectionInfo {
  const data = value as Record<string, unknown> | null;
  if (
    !data ||
    data.service !== "markly-api" ||
    data.backend !== "fastapi" ||
    data.connectionVersion !== 1 ||
    data.apiVersion !== 3 ||
    data.authentication !== "http-only-cookie" ||
    data.origin !== origin
  )
    throw new Error("This is not a compatible OMR FastAPI school server.");
  if (data.clientReady !== true)
    throw new Error(
      "FastAPI is reachable, but its web app is missing. Deploy both at the same HTTPS address.",
    );
  if (
    (data.deploymentMode !== "production" &&
      data.deploymentMode !== "development") ||
    (data.database !== "postgresql" && data.database !== "sqlite") ||
    (data.deploymentMode === "production" && data.database !== "postgresql")
  )
    throw new Error("The server has an unsupported deployment configuration.");
  return {
    origin,
    deploymentMode: data.deploymentMode,
    database: data.database,
  };
}

export async function schoolConnectionStatus() {
  if (!isAndroid()) return { origin: location.origin, lastOrigin: "" };
  return SchoolServer.status();
}
export async function checkSchoolServer(input: string) {
  const origin = normalizeServerOrigin(input);
  if (!isBundledAndroid())
    throw new Error("Return to Android’s connection screen to check a server.");
  // Native HTTPS probe has bounded reads/timeouts, no credentials and no redirects.
  return connectionInfo(await SchoolServer.check({ origin }), origin);
}
export async function connectSchoolServer(input: string) {
  const origin = normalizeServerOrigin(input);
  if (!isBundledAndroid())
    throw new Error("Disconnect before changing the school server.");
  // Native code rechecks the endpoint, asks for trust, then restarts at that origin.
  await SchoolServer.connect({ origin });
}
export async function disconnectSchoolServer() {
  if (!isAndroid())
    throw new Error("This control is only available in Android.");
  await SchoolServer.disconnect();
}
export function openSchoolServer(input: string) {
  // Ordinary browser navigation, not an unverified cross-origin authentication API.
  window.location.assign(normalizeServerOrigin(input));
}
