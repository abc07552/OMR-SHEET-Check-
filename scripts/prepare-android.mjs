import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
function run(command, args, env = process.env) {
  const result = spawnSync(command, args, {
    cwd: root,
    env,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}

// A separate output directory preserves any running web preview. An API URL from
// a developer's .env must not accidentally turn into a cross-origin native login.
// Hosted APKs load their trusted HTTPS app + /api together (Capacitor server.url).
run(
  process.platform === "win32" ? "npm.cmd" : "npm",
  ["run", "build", "--", "--base=/", "--outDir=dist-android", "--mode=android"],
  { ...process.env, VITE_API_BASE: "" },
);
run(process.execPath, [
  "node_modules/@capacitor/cli/bin/capacitor",
  "sync",
  "android",
]);
console.log(
  process.env.OMR_ANDROID_SERVER_URL?.trim()
    ? "Android synchronized: trusted HTTPS school deployment. The server is NOT included in the APK."
    : "Android synchronized: device-only demo. No school server or account authentication is included.",
);
