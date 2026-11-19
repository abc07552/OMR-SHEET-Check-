# Android APK build and installation

## Why the original workflow failed

The original `Build Android APK` run [44444843181](https://github.com/abc07552/OMR-SHEET-Check-/actions/runs/44444843181)
ran `chmod +x gradlew` at the repository root. That commit contained a web/Python
project and the YAML, **not an Android project or Gradle wrapper**. It therefore
failed before compilation; the APK upload was skipped. GitHub separately reports
that the workflow was **disabled manually**. The run metadata does not establish
who disabled it, or why. Re-enabling that original YAML alone cannot fix it.

This branch adds a real Capacitor Android project under `android/`, builds the
React client first, synchronizes assets and compiles **inside `android/`**. The
workflow remains at `.github/workflows/main.yml`, so it retains its existing name
and identity. The historical failed run is not rewritten or deleted.

## What an APK contains — and what it does not

**Default: device-only demo.** The APK bundles the React app, genuine optical
engine, OCR assets and offline client. It opens the separate local workspace and
shows a persistent warning that this is not an authenticated school account.
There is no pretend sign-in, embedded database server or invented API endpoint.
**Do not enter private student data in this unencrypted demo workspace.**

**Hosted school variant:** first deploy the complete web app and FastAPI with
PostgreSQL at one trusted **HTTPS origin**, following [DEPLOYMENT.md](DEPLOYMENT.md).
Set the public build variable `OMR_ANDROID_SERVER_URL`, for example:

```sh
OMR_ANDROID_SERVER_URL=https://your-actual-school-domain.example npm run android:sync
```

Replace that example with your actual deployed domain. This loads the deployed
web client and its same-origin `/api` together; existing Secure/HttpOnly session
cookies, CSRF header and backend permissions are preserved. Do not point it at
GitHub Pages, an API-only URL, `/api`, localhost, or a third-party/untrusted site.
The URL must be an HTTPS origin with no credentials, path, query or fragment.
Other origins are not added to the privileged WebView navigation allowlist.
Never put a password, setup token, database URL or API secret in this variable.
The configured host controls code with access to this app's native bridge.

For GitHub Actions, configure the repository **Actions variable**
`ANDROID_SERVER_URL` before running the workflow. Leave it unset for the labelled
demo APK. This variable is a **public URL**, not a credential. It is not provisioned
by this change. Deploy the updated client too: older web versions lack the native
export bridge. Initial hosted sign-in needs a reachable deployment; bundled APK
assets do not automatically provide a second authenticated copy of the hosted
site. Hosted PWA/offline-vault behavior still requires device acceptance testing.

Python, PostgreSQL, SMTP, S3 and server workers **are not embedded in an APK**.
The hosted build is a native WebView client, not an on-device Python server.

## Toolchain and local commands

Pinned Capacitor core/Android/CLI **8.6.2** requires Node **22.13+**, **JDK 21**,
Android SDK platform **36**, build-tools **36.0.0**, and minimum device API **24**
(Android 7.0). Use a current Android System WebView/Chrome. The project includes
the Gradle **8.14.3** wrapper and verifies its distribution SHA-256. Android Gradle
Plugin is **8.13.0**. Do not replace JDK 21 with the original workflow's JDK 17.

```sh
npm ci
npm test
npm run android:sync       # build to dist-android/ and cap sync android
cd android
./gradlew --no-daemon testDebugUnitTest lintDebug assembleDebug
# Windows: gradlew.bat instead of ./gradlew
```

The APK is `android/app/build/outputs/apk/debug/app-debug.apk`. Alternatively,
`npm run android:debug` performs the web synchronization and debug build, or
`npm run android:open` opens the synchronized native project in Android Studio.
Run `android:sync` after client, config or npm-plugin changes. Generated web assets,
Capacitor config/build glue, SDK paths, private keys and APKs are ignored, not
checked into Git. `dist-android/` does not overwrite an existing web `dist/`.

## GitHub Actions and downloading the APK

1. Open **Actions → Build Android APK**.
2. If disabled, use **Enable workflow** (or `gh workflow enable main.yml`).
3. Select **Run workflow** and choose the fixed branch. Until this PR is merged,
   `main` still contains the old build; do not re-run its old failing commit.
4. A successful job installs locked npm dependencies, runs frontend regressions,
   builds/synchronizes assets, runs native JVM tests and Android lint, then builds
   a debug APK. Compiler failures propagate through log capture; native JVM XML
   must confirm executed tests with no errors/failures/skips. The job verifies
   the APK signature, launchable activity and SDK/package
   metadata **before** uploading.
5. Download **`omr-checker-android-debug`** from that successful run's **Artifacts**.
   Extract it to obtain `omr-checker-ai-pro-debug.apk`, `SHA256SUMS.txt` and
   `BUILD-INFO.txt` (exact commit, source run and demo/hosted mode). Artifacts expire
   after 14 days; rerun a successful fixed revision when needed.
6. Transfer the APK to your device, permit installation from that specific source
   if Android asks, then open **OMR Pro (Test)**. No Play Store publication or
   release-signing key is supplied. The debug package ID is
   `com.markly.omrpro.debug`, separate from a future release package.

Debug signing keys on disposable CI runners can differ between builds. **Export
and verify backups of local work before replacing an installed test build.** Do
not uninstall an app with unsynchronized work merely to bypass a signature error.
A production release needs a securely retained signing key and release process.

## Camera, exports, privacy and updates

- Live camera uses the genuine existing scanner and Android's runtime camera
  permission. Photo capture has a narrowly scoped `Pictures/` FileProvider;
  multi-image/PDF selection uses the system chooser. No storage-wide or microphone
  permission is requested. Camera-less devices remain installable.
- CSV/XLSX/PDF/PNG/JSON exports use a small native **Storage Access Framework Save
  As** bridge, not unsupported WebView blob-download links. Choose the destination
  explicitly. Completion is reported only after writing; cancellation, insufficient
  space, encoding and provider errors are surfaced. Native exports are bounded to
  **32 MiB before base64 allocation**; use the web app for larger exports. Documents
  are not retained in an app export cache. Chosen export destinations may be
  unencrypted: protect reports and use encrypted backups for private information.
- The report print action opens Android's print service; unavailable printing is
  reported with a PDF-export alternative.
- Automatic Android backup/device transfer is excluded; explicit encrypted backups
  remain the supported route. Cleartext/mixed-content loading and WebView debugging
  are disabled. Bridge logging is disabled because plugin arguments contain report
  contents; failures still propagate to the UI.
- Bundled assets do not register a PWA service worker, avoiding stale client code
  after an APK update. The hosted HTTPS app retains its normal private-API-excluding
  PWA policy. Private API responses are not added to a static shell cache.

## Verification boundary

Frontend bridge/config regressions and JVM policy tests are automated. CI also
compiles the native app, runs Android lint and verifies the APK when successful.
An APK build is **not** proof of physical camera permission behavior, hardware
capture, gallery/PDF providers, print service, large-file saves, hosted cookies,
offline updates or real printed-sheet accuracy. Before school deployment, perform
those checks on representative Android devices and printed sheets, including
permission denial/regrant, cancelled exports, rotation, low memory, offline restart,
sign-out, account isolation and APK upgrades. The device instrumented smoke test is
available via `./gradlew connectedDebugAndroidTest`; it is not silently counted as
executed without a connected device/emulator.
