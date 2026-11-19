import type { CapacitorConfig } from "@capacitor/cli";
import { normalizeServerOrigin } from "./src/serverOrigin";

/** An optional, trusted deployment of the complete app + same-origin /api. */
export function androidConfig(
  serverUrl = process.env.OMR_ANDROID_SERVER_URL || "",
): CapacitorConfig {
  const value = serverUrl.trim();
  let origin: string | undefined;
  if (value) {
    try {
      origin = normalizeServerOrigin(value);
    } catch (error) {
      throw new Error(
        `OMR_ANDROID_SERVER_URL: ${error instanceof Error ? error.message : "Use a trusted HTTPS origin."}`,
      );
    }
  }
  return {
    appId: "com.markly.omrpro",
    appName: "OMR Checker AI Pro",
    webDir: "dist-android",
    // Bridge debug logs can otherwise include base64 report/backup contents.
    loggingBehavior: "none",
    server: {
      hostname: "localhost",
      androidScheme: "https",
      cleartext: false,
      ...(origin ? { url: origin } : {}),
      // Other origins open outside the privileged application WebView.
      allowNavigation: [],
    },
    android: {
      allowMixedContent: false,
      webContentsDebuggingEnabled: false,
      backgroundColor: "#0b1220",
    },
  };
}

export default androidConfig();
