import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { androidConfig } from "../capacitor.config";

describe("safe Android deployment configuration", () => {
  it("bundles the client without inventing a school backend or weakening transport security", () => {
    const config = androidConfig("");
    expect(config.appId).toBe("com.markly.omrpro");
    expect(config.webDir).toBe("dist-android");
    expect(config.server?.url).toBeUndefined();
    expect(config.server?.androidScheme).toBe("https");
    expect(config.server?.cleartext).toBe(false);
    expect(config.server?.allowNavigation).toEqual([]);
    expect(config.android?.allowMixedContent).toBe(false);
    expect(config.android?.webContentsDebuggingEnabled).toBe(false);
    expect(config.loggingBehavior).toBe("none");
  });

  it("accepts only the configured same-origin HTTPS school deployment", () => {
    const config = androidConfig("  https://School.Example.org:443/  ");
    expect(config.server?.url).toBe("https://school.example.org");
    expect(config.server?.allowNavigation).toEqual([]);
  });

  it.each([
    "not-a-url",
    "http://school.example.org",
    "javascript:alert(1)",
    "file:///private",
    "https://user:secret@school.example.org",
    "https://school.example.org/api",
    "https://school.example.org/?token=secret",
    "https://school.example.org/#token",
    "https://localhost",
    "https://127.0.0.1",
    "https://[::1]",
    "https://127.1",
    "https://localhost.",
    "https://school.localhost",
    "https://*.example.org",
  ])(
    "rejects insecure, credential-bearing or incorrect server configuration: %s",
    (url) => {
      expect(() => androidConfig(url)).toThrow("OMR_ANDROID_SERVER_URL");
    },
  );

  it("declares camera access without storage/microphone permissions and disables automatic backups", () => {
    const manifest = readFileSync(
      new URL("../android/app/src/main/AndroidManifest.xml", import.meta.url),
      "utf8",
    );
    expect(manifest).toContain("android.permission.CAMERA");
    expect(manifest).toContain('android:allowBackup="false"');
    expect(manifest).toContain('android:usesCleartextTraffic="false"');
    expect(manifest).toContain("android.media.action.IMAGE_CAPTURE");
    expect(manifest).not.toMatch(
      /READ_EXTERNAL_STORAGE|WRITE_EXTERNAL_STORAGE|MANAGE_EXTERNAL_STORAGE|RECORD_AUDIO/,
    );
    const paths = readFileSync(
      new URL(
        "../android/app/src/main/res/xml/file_paths.xml",
        import.meta.url,
      ),
      "utf8",
    );
    expect(paths).toContain('path="Pictures/"');
    expect(paths).not.toContain("<external-path");
  });
});
