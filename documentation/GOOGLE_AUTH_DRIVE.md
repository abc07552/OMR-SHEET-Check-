# Google sign-in, password signup and private Drive backups

## What is implemented

The **FastAPI** system has a sign-in / create-institution portal, 12–128 character
Argon2id app passwords, confirmation and show-password controls, SMTP recovery,
verified production email registration, Google sign-in/sign-up, password-confirmed
Google linking/unlinking, and first-password creation for Google-only accounts.
Staff use **Settings → Sign-in & security**; students use **Profile → Sign-in &
security**. Existing accounts are never automatically linked by matching email.

Public signup is an **operator opt-in**, not the protected first-administrator
bootstrap. Each public signup creates one **new, isolated school**, with a regular
school-admin membership and **no super-admin privilege**. It cannot join or read
an existing institution. Existing school administrators continue to provision
teacher/student accounts through **Team & access**; those users can link Google
after signing in with their app password. Permissions still apply on every API.

**Backups → Google Drive backups** has a separate Google consent step. Any active
school administrator can connect **their own** Google account for that particular
school. Another administrator cannot use their refresh token or read their Drive
history. Drive connection does not link Google sign-in and vice versa. No Google
password, access token, refresh token, or OAuth client secret is sent to the UI.

This feature requires a hosted FastAPI system. The static GitHub Pages demo and
preserved Node server do not provide these new Google/signup/Drive endpoints.
There is no live Google configuration or real Google-account acceptance evidence
in this repository. Automated provider tests are explicitly synthetic.

## Server / Google Cloud configuration (required for live use)

1. Deploy the complete application + FastAPI at **one canonical HTTPS origin**,
   for example your own school domain. Follow [DEPLOYMENT.md](DEPLOYMENT.md).
   Finish the existing SETUP_TOKEN-protected `/setup` process first. Keep the
   PostgreSQL database, private object storage and a stable `BACKUP_KEY`.
2. In your own Google Cloud project, configure the OAuth consent screen with
   the correct app name, audience, verified domain, support contact, privacy /
   deletion policy and required publishing/verification. During testing, add
   authorized test users. Google, not this application, controls approval,
   organization policy and refresh-token lifetimes. Testing-mode grants can
   expire; the UI supports reconnecting instead of pretending backups succeeded.
3. Enable **Google Drive API** in that project.
4. Create an OAuth client of type **Web application** (the server exchanges the
   code, including for Android). Register **exactly** this redirect URI, using
   your actual canonical domain:

   ```text
   https://YOUR_REAL_DOMAIN/api/oauth/google/callback
   ```

   The callback has no fragment or trailing slash. Do **not** register a WebView
   origin, custom Android scheme, GitHub Pages demo, localhost alias or arbitrary
   `redirect_uri`. JavaScript Google Identity Services is not used here; no
   frontend Google SDK or secret is needed. Use separate OAuth clients / callback
   domains for unrelated deployments.

5. Inject these variables into the **server's** secret/environment configuration:

   ```dotenv
   PUBLIC_APP_URL=https://YOUR_REAL_DOMAIN
   GOOGLE_CLIENT_ID=YOUR_WEB_OAUTH_CLIENT_ID
   GOOGLE_CLIENT_SECRET=YOUR_WEB_OAUTH_CLIENT_SECRET
   PUBLIC_SIGNUP_ENABLED=false
   ```

   Enable `PUBLIC_SIGNUP_ENABLED=true` only if you intend to host separate new
   institutions publicly, including the associated storage/abuse costs. Configure
   `SMTP_HOST`, `SMTP_PORT`, `SMTP_FROM` and optional SMTP authentication for
   password signup and recovery. STARTTLS with certificate/hostname verification
   is required. **Production password signup fails closed without email
   delivery**; it never silently creates an unverified production account.
   Google signup uses Google's verified email claim and does not need SMTP.

6. Back up your database, apply `alembic upgrade head`, then restart the API.
   `deployment/compose.yaml` passes the Google/signup variables to both migration
   and API services. The new migration is additive; existing passwords, sessions,
   schools and records are preserved. Old sessions are not considered recent
   Google reauthentication.
7. Open the app at `PUBLIC_APP_URL` and test with authorized Google test users.
   Sign in with the existing app password, link Google in Settings, sign out,
   then sign in with Google. For a new independent school, choose **Create
   institution**, enter its name, then email/password or **Sign up with Google**.
   New password accounts in production receive a 30-minute, single-use email
   link and must also enter the password chosen during signup. Merely opening
   the link never activates an attacker-chosen account. Resubmitting the same
   email **and chosen password** can resend a link; an unauthenticated request
   cannot replace a pending signup's password/name/school.
8. Google-only users should immediately **set an app password** in Settings.
   This requires Google sign-in / reauthentication in the last five minutes.
   It allows password login, recovery alternatives and password-confirmed
   destructive operations (such as server backup restore). Removing Google
   sign-in requires that app password and revokes prior app sessions. Drive
   authorization is managed separately.

Never paste real secrets into chat, Git commits, screenshots, `VITE_*` variables
or an APK. A conversation's Arena Drive connector is not an application's OAuth
client and does not configure Google login for your schools.

## Drive workflow and limitations

1. Save/synchronize edits first. The manual backup reads the **acknowledged
   server workspace**, not unsubmitted/offline browser edits.
2. As school administrator, choose **Backups → Connect Google Drive** and approve
   `openid email profile` plus **`drive.appdata`**. Ordinary login requests only
   `openid email profile`. Broad `drive` / `drive.file` permission is not requested.
   A refresh token is encrypted at rest with the server's `BACKUP_KEY`.
3. Select **Back up saved workspace now**. The server locks a coherent school
   snapshot, encrypts a versioned archive with authenticated Fernet encryption,
   and uploads it to the app's private **appDataFolder**. These files do **not**
   appear as ordinary files in My Drive. The app shows the real backup history,
   revision, byte count and upload / failure status. This implementation is
   **manual**, not scheduled Drive replication. Existing daily server recovery
   points are separate and are not automatically uploaded to Drive.
4. A durable operation ID, lease and preallocated Drive file ID are persisted
   before upload. On an interrupted/ambiguous response, choose **Retry same
   backup**, not a new backup. This reuses the immutable snapshot and file ID,
   checks existing metadata and never silently overwrites another file.
5. **Download encrypted** retrieves and verifies the remote ciphertext, not a
   pretend local upload. SHA-256, size and app metadata are checked. Archives
   contain institution settings, classes, students, exams, layouts, keys and
   results. **They do not contain original image binaries, attachments, login
   users/passwords, memberships, audit/evaluation history, server secrets or the
   encryption key**. Original-object references are preserved but the referenced
   storage must also be backed up. The plaintext archive limit is 29 MiB; remote
   downloads are bounded to 40 MiB; Android Save As remains limited to 32 MiB.
6. **Import for restore** downloads and authenticates the ciphertext, validates
   the version/schema and school binding, and creates a **non-destructive server
   recovery point**. It does not replace records. The next confirmation requires
   your **app** password (never your Google password) and current workspace
   revision. A concurrent newer revision is rejected and a pre-restore server
   snapshot is saved. Inspect the restored workspace before resuming work.
7. **Disconnect Drive** removes the local encrypted access/refresh credentials
   even if Google's revocation endpoint is unavailable. It reports whether
   Google confirmed revocation, and never deletes uploaded backups. If
   revocation was not confirmed, remove this application's grant in your Google
   account security settings. Google may revoke the entire OAuth app grant for
   that Google account: other schools connected to that same account/client may
   also need to reconnect. Changing Drive accounts retains metadata but requires
   reconnecting the original account to access its archives.

**This is a school-workspace backup, not complete disaster recovery.** Keep a
separate full PostgreSQL backup (including Drive history/file IDs), original-
image/object storage, deployment configuration and **BACKUP_KEY** in secure
independent storage. Losing the key makes these Drive archives unreadable. A
fresh server/new school is not authorized to import an unrelated tenant archive;
restore the database and key through the documented operator disaster-recovery
process first. The ordinary portable JSON/AES-GCM export is a different format;
`.omr.enc` Drive archives are imported through the Drive integration, not the
browser's JSON file-restoration button.

## Web and Android security

- Authorization Code + S256 PKCE + cryptographically random state and nonce.
  Official `google-auth` verifies the RSA signature, issuer, audience, lifetime,
  authorized party, verified email and nonce. `sub`, not email, identifies a
  linked Google identity. Auth remains HttpOnly cookie-based; 24-hour expiry,
  suspension, CSRF request headers, origin restrictions and RBAC are unchanged.
- Web flows use a Secure/HttpOnly/SameSite=Lax, scoped flow cookie. One-use,
  two-minute completion tickets are bound to that cookie. Server-bound linking /
  Drive flows also re-check the initiating app session and membership before
  completion. There is no automatic privilege escalation or account merge.
- Android uses `@capacitor/browser` (an **external Custom Tab**), never embedded
  Google OAuth in the privileged WebView. Google returns to the same HTTPS server
  callback. A short-lived handoff goes to the installed app's exact package
  scheme (`com.markly.omrpro` or `.debug`) and `oauth/callback` path. A second,
  device-generated SHA-256 proof binds completion to the initiating WebView.
  Intercepting a custom-scheme ticket alone cannot sign in. No provider token or
  server session bearer token appears in that URL. Callback URL parsing allows
  no arbitrary navigation or server switching.
- Pending client proof is per-origin session storage and expires after 12 minutes.
  Sign-out/server departure cancels it. If Android kills the WebView and loses
  that session storage, authorization fails closed: restart sign-in. Physical
  Android browser return/process-death and Google policies still need real-device
  acceptance testing for the selected production domain.
- OAuth endpoint responses are private/no-store with `Referrer-Policy:
no-referrer`; the frontend removes completion tickets from its current history
  entry. The production container disables Uvicorn access logs to avoid logging
  callback authorization codes. Operators must also omit/redact OAuth query
  strings in any external proxy/APM logs. Provider error descriptions/tokens are
  not relayed to the browser.
- Outbound OAuth/Drive hosts are fixed; redirects, environment proxies, arbitrary
  Drive URLs/IDs, TLS bypass and unbounded provider reads are prohibited.

## Validation and live acceptance still required

`backend/tests/test_google_and_drive.py` uses a synthetic HTTP provider, generated
RSA/X.509 signing keys and the **real official Google verifier**, across SQLite
and isolated PostgreSQL. It tests invalid claims/signatures, replay, stolen flow
cookies/tickets, native PKCE, scope separation, tenant isolation, encrypted token
storage/refresh, interrupted upload recovery, integrity checks, non-destructive
import, password/revision restore and disconnect failures. `test_registration.py`
checks verified signup/recovery boundaries, throttles, resend protection and
additive migration. Frontend regressions cover proof/URL policy and Strict Mode
single completion; Playwright exercises actual password registration, password
change/re-login and the unconfigured-Drive state with the genuine backend.

Real Google consent, Cloud-console configuration, SMTP delivery, Drive storage /
quota/revocation behavior and physical-device Android return have **not** been
certified by synthetic tests. They require your configured project/domain and
authorized test users. Do not present disabled/unconfigured Google buttons as an
already-connected Google service.
