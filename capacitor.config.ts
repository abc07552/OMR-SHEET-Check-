import type { CapacitorConfig } from "@capacitor/cli";

/** An optional, trusted deployment of the complete app + same-origin /api. */
export function androidConfig(
  serverUrl = process.env.OMR_ANDROID_SERVER_URL || "",
): CapacitorConfig {
  const value = serverUrl.trim();
  let url: URL | undefined;
  if (value) {
    try {
      url = new URL(value);
    } catch {
      throw new Error("OMR_ANDROID_SERVER_URL must be an absolute HTTPS URL.");
    }
    const hostname = url.hostname.replace(/\.$/, "");
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash ||
      ["localhost", "127.0.0.1", "[::1]"].includes(hostname) ||
      hostname.endsWith(".localhost") ||
      hostname.includes("*")
    ) {
      throw new Error(
        "OMR_ANDROID_SERVER_URL must be a trusted HTTPS origin, without credentials, a path, query or fragment; not localhost.",
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
      ...(url ? { url: url.origin } : {}),
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
