# Enterprise deployment and operations

This guide deploys the **FastAPI/PostgreSQL** application. It does not deploy anything merely by committing files or opening a pull request. You supply a host, DNS, HTTPS reachability, persistent storage, secrets, monitoring and the institution's data-protection policy.

The default `Dockerfile` now builds the React application and a non-root CPython 3.11/FastAPI runtime. `deployment/Dockerfile.node` preserves the former Node/SQLite packaging; `npm run server` remains available for the baseline. **Never mount `markly.sqlite` as an enterprise SQLAlchemy database.** Read [MIGRATION.md](MIGRATION.md) before cutover.

## Android is a client, not backend hosting

The optional native project and `Build Android APK` workflow are documented in
[ANDROID.md](ANDROID.md). They do not package Python/PostgreSQL or provision this
deployment. The default APK opens school-server onboarding with a separate
optional device demo. For school accounts, deploy the complete updated client +
`/api` on this guide's same HTTPS origin, then enter that address in the APK's
**Connect your school** screen. The optional public Android build origin can
still preconfigure a school. Do not weaken cookies/CORS or embed
server secrets to work around a missing deployment. Debug APKs are test builds,
not a production mobile release or physical-device certification.

## Supported configuration

- Node 24 builds the client; Python 3.11 uses `backend/requirements.lock` at runtime with `--require-hashes --only-binary=:all:`. Both runtime and development closures include pinned versions and published non-yanked PyPI SHA-256 artifact hashes. The locks were installed in a clean Linux x86-64 CPython 3.11 environment; validate a different platform's installation separately. Node/npm development dependencies and development-only Bandit are not installed into the Python runtime.
- PostgreSQL is mandatory when `APP_ENV=production`. SQLite is for separate local databases/tests only.
- Build-time assets are self-hosted: OpenCV.js, English browser OCR, PDF worker and fonts. No remote OCR/CDN is required at scan time. The runtime image also installs native Tesseract/English data for Python OCR.
- Original scans and application recovery points are encrypted with a stable Fernet `BACKUP_KEY`, in private local storage or S3-compatible storage. The encryption key must outlive container replacement.
- Production cookies are Secure and HttpOnly. The browser uses relative `/api` requests on the **same HTTPS origin** as the application.
- `AUTO_MIGRATE=false` requires an explicit, successful Alembic migration before startup. The API fails closed if its database revision is missing, stale or incompatible; it must not report a healthy application against an unprepared schema.

The supplied Compose topology is a single-host starting point, not a high-availability managed-cloud deployment. It uses PostgreSQL 17, Caddy 2, persistent named volumes and a private Docker network. Its PostgreSQL application role is **not a superuser**; initialization creates that role only on a new database volume. Managed deployments should further separate migration/DDL privileges from runtime DML privileges.

Image tags track patched releases within a major/minor series; npm/Python application dependencies are locked separately. For an immutable production release, record tested base-image digests, build provenance and the resulting application image digest in your release process. Do not treat a floating base tag or a clean package audit as a complete supply-chain guarantee.

## First deployment with Docker Compose

Prerequisites: a supported Docker Engine/Compose v2 host, adequate memory/disk, a real DNS name pointing to it and reachable TCP 80/443 (UDP 443 optional for HTTP/3). Do not use the Arena embedded preview as a permanent public host. A host firewall should expose only SSH under your policy and HTTPS/ACME ports, **not PostgreSQL or the ASGI port**.

From the repository root:

```sh
cp .env.example .env
chmod 600 .env
```

Edit `.env` privately on that host:

- `APP_DOMAIN`: your real hostname, without `https://` or a path.
- `ACME_EMAIL`: monitored operator email for TLS certificate notices.
- `POSTGRES_PASSWORD`: long URL-safe random secret for the non-superuser application role.
- `POSTGRES_ADMIN_PASSWORD`: a **different** long random bootstrap/database-administration secret.
- `BACKUP_KEY`: generated valid Fernet key. Store an independently protected recovery copy.
- `SETUP_TOKEN`: random first-admin bootstrap secret; remove it after setup.
- Optional S3/SMTP settings described below.

Generate secrets locally on your server, save them directly into secret controls/the private file, and never paste them into chat, issues, source or `VITE_*` variables. For example, Python's `secrets.token_hex(32)` gives a URL-safe random password. With installed Python dependencies, `Fernet.generate_key().decode()` gives the encryption key. These are different secrets with different purposes.

Compose overrides the development defaults in `.env.example` with production settings and constructs an internal PostgreSQL URL. The password in that constructed URL must be URL-safe (hex is suitable); for arbitrary characters, use a correctly URL-encoded connection URL in a customized deployment.

```sh
docker compose --env-file .env -f deployment/compose.yaml config --quiet
docker compose --env-file .env -f deployment/compose.yaml build api
docker compose --env-file .env -f deployment/compose.yaml up -d --wait db

# Run once, serially, after taking backups on upgrades:
docker compose --env-file .env -f deployment/compose.yaml run --rm migrate

docker compose --env-file .env -f deployment/compose.yaml up -d --wait api web
```

Open your real `https://` domain, complete first-admin setup with the bootstrap token and create your own password. There are no default credentials. Remove `SETUP_TOKEN` from the private environment and recreate the API container; do not delete the setup sentinel or user table. Verify a second setup cannot be performed.

The `migrate` service is an explicitly invoked maintenance profile, not a concurrent replica or a continuously restarting process. Do not run concurrent production migrations. The runtime does not automatically apply migrations under this Compose configuration.

**Never run `docker compose down --volumes` or delete a database/data volume on a real installation.** Such commands are suitable only for explicitly disposable CI environments. Changing PostgreSQL password environment values after initial volume creation does not rotate existing database credentials; perform an intentional database-role/password rotation and update clients together.

### Pair Android clients with the real system

After deployment, check your real origin's `/api/connection-info`: it should return
`service: markly-api`, `backend: fastapi`, `connectionVersion: 1`, `apiVersion: 3`,
`authentication: http-only-cookie`, `deploymentMode: production`,
`database: postgresql`, and `clientReady: true`. This small public endpoint performs
a real database query and checks the served client is present; it does not create
an account, expose secrets or authorize private data. An API-only deployment must
build/install `dist` and restart the server before pairing. Existing protected
health/account endpoints retain their permissions and no-store policies.

On each phone, choose **Connect your school**, enter the exact HTTPS origin,
**Check server**, then **Connect & continue securely** and approve the native
trust prompt. First-run setup uses the existing server `SETUP_TOKEN`; subsequent
users sign in with accounts provisioned under **Team & access**. You do not need
to rebuild an APK for each school. Alternatively, preconfigure the public
`ANDROID_SERVER_URL` build variable. Do not enter that variable or any `VITE_*`
value as a place to store secrets.

Pairing loads the full hosted client with same-origin `/api`, not the bundled
client making cross-origin cookie requests. There is no wildcard CORS change,
TLS bypass, token URL or automatic transfer of demo data. Old backend versions
without `/api/connection-info` are rejected until upgraded. Use the native
**Connection** bar to retry/recover when a school's server is unreachable. Consult
[ANDROID.md](ANDROID.md) for cookie clearing, offline queues and device tests.

### HTTPS, proxy trust and ports

- Caddy handles ACME certificates and redirects public HTTP to HTTPS. `deployment/Caddyfile` proxies both app and `/api`; private HTTP responses must never be cached by a CDN/proxy.
- Neither database port 5432 nor API port 8000 is published by Compose. Caddy's internal address is `172.29.241.10`; Uvicorn trusts forwarded headers only from that address or loopback. Caddy replaces untrusted client forwarding headers.
- If that subnet conflicts with your host/VPN, change the Compose subnet/address **and the Uvicorn trusted-proxy argument** together. A different ingress needs its own exact trusted address/network and an API firewall. Do not solve a proxy problem by trusting `*` on a public API port.
- `/api/docs` and `/api/openapi.json` are blocked at the supplied public Caddy ingress. They remain available internally for operators; change that deliberately if your authenticated development workflow needs them.
- Production embedding in arbitrary iframes is blocked. Camera/PWA/cryptographic browser features need HTTPS and permissions; open the application directly when a host iframe denies camera access.
- Backend request limits remain in force (30 MiB JSON, 52 MiB multipart envelope; accepted image payloads at most 50 MiB, with decoded image/workbook bounds). Configure any additional ingress limits/timeouts consistently; do not remove decode/bomb protections.

### Persistent state and non-root access

The runtime runs as UID/GID 10001, with a read-only root filesystem, dropped capabilities, no-new-privileges and bounded temporary storage in Compose. A new named application volume inherits private ownership. A pre-existing bind mount must be provisioned for that UID with restrictive permissions; do not make school data world-writable to fix a permission error.

Preserve:

1. the PostgreSQL database and its backup/PITR chain;
2. the full application data volume (encrypted local originals/recovery objects and migration safety snapshots), or the corresponding private S3 bucket;
3. the original `BACKUP_KEY`, protected independently;
4. deployment configuration, role/permission policies and TLS certificate state as required by your recovery plan.

The container healthcheck verifies `/api/health` and therefore database connectivity; startup separately verifies the exact Alembic head. The authenticated System screen exposes more detail only to a super administrator. Logs/metrics must not include passwords, private connection strings, reset tokens, student photos or original scan payloads.

## Managed PostgreSQL / object storage / SMTP

For your own ASGI/container platform, set `APP_ENV=production`, `DATABASE_URL=postgresql+psycopg://…`, `BACKUP_KEY`, `PUBLIC_APP_URL=https://…`, `DATA_DIR` and `AUTO_MIGRATE=false`. Run Alembic with the same database/environment, then launch Uvicorn on `0.0.0.0:8000`. Route one public HTTPS origin to the app; browsers must not call a sandbox/server's `localhost`.

Use provider-required database TLS (`sslmode=verify-full`/trusted CA as appropriate), private networking, connection limits and narrowly scoped roles. Do not copy sample QA superuser credentials or the optional sandbox PostgreSQL binary into production. Test your provider's failover, pooling and restore behavior explicitly.

Optional storage settings:

- `S3_BUCKET`, `AWS_REGION`, optionally `S3_ENDPOINT_URL` select the private object store. Use workload IAM roles where available, otherwise narrowly scoped server-only credentials.
- Grant only the required object prefix operations; deny public access, enable provider encryption/versioning/retention and monitor failures. Application encryption remains enabled for originals/recovery objects before upload.
- Originals/recovery objects are capped at 50 MiB plaintext. Encrypted storage/download bounds include Fernet padding, envelope and base64 overhead (up to about 66.7 MiB stored for a 50 MiB original). Both local and provider reads are bounded; provider response streams close even on a transport/decryption error. Validate actual provider latency, IAM and transport failures separately from the unit stream tests.
- Switching from local storage to S3 does **not** migrate existing objects automatically. Rehearse an explicit object-copy/verification plan while preserving keys and the database/object mapping.

Optional recovery email settings: `SMTP_HOST`, `SMTP_PORT` (normally 587), `SMTP_FROM`, and optional authentication. The application requires STARTTLS and returns a non-enumerating recovery response. Configure provider authorization/SPF/DKIM/DMARC, test real delivery/expiry/single-use behavior and monitor delivery failures. An unset SMTP host does not magically send mail; trusted-server recovery remains available.

No external S3, SMTP transport, managed database or permanent HTTPS service was provisioned or certified in this development sandbox.

## Optional public signup, Google login and Google Drive

Follow [GOOGLE_AUTH_DRIVE.md](GOOGLE_AUTH_DRIVE.md) for the exact OAuth callback,
consent configuration, signup verification, Android handoff and Drive limitations.
`PUBLIC_SIGNUP_ENABLED` defaults false; new signups create isolated regular-school
admins, not super-admins or memberships of existing schools. Production password
signup requires working certificate-verified SMTP STARTTLS delivery.

Set server-only `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` for a Google Cloud **Web
application** client and enable Google Drive API. Register exactly your canonical
`https://YOUR_REAL_DOMAIN/api/oauth/google/callback`; the complete app must be
opened at `PUBLIC_APP_URL`. Compose passes these variables to the API/migrator.
Do not put secrets in `VITE_*`, APKs, chat or the Arena Drive connector. Run the
additive Alembic migration before upgrading the API. The production container
disables access logs; also redact OAuth callback query strings from external
proxy/APM logging. Never expose authorization codes or password/reset tokens.

Drive uploads are manual, encrypted school-workspace archives in `appDataFolder`,
not ordinary My Drive files. They exclude login accounts, original binaries,
full database histories and the key. Keep the full database (including Drive
history/file IDs), object storage and `BACKUP_KEY` separately. Import first creates
a recovery point; restoring live records still requires app password, current
revision and a pre-restore snapshot. Actual Google project approval, consent,
quota, token expiry and mobile callback behavior need live acceptance testing.

## Upgrades, backup, restore and rollback

Before every production upgrade:

1. Record the running application image digest and migration revision. Stop/quiesce writes and finish/export unsynchronized work deliberately.
2. Take a verified PostgreSQL backup/PITR checkpoint and consistent object-store/data-volume snapshot. Protect a separate key copy. Record counts and representative result/report checksums without exposing student records.
3. Restore those backups into an **isolated** rehearsal environment first. Confirm object decryption, institution settings, permissions, scans/evidence, template geometry, evaluation histories and reports.
4. Stop the old API before migrations; run the new image's Alembic upgrade once. Verify the exact schema head and startup/health before resuming traffic.
5. Verify real sign-in/logout, forbidden-role/student isolation, a known calibrated scan, manual review and report downloads. Observe logs/queue leases/dependency health before declaring the release healthy.

A rollback is not blindly running an older binary on a newer schema, nor automatically running `alembic downgrade` on live data. Rehearse either backward-compatible application rollback or a consistent database+object restore to a known revision. Keep source/previous-release data read-only and available until the institution accepts the cutover.

Application recovery points restore a school workspace and require password/revision authorization; **they do not restore users, all audit/history, the entire PostgreSQL cluster, external objects or encryption keys**. Never use them as your only disaster-recovery backup. Define retention, deletion/consent policy, RPO/RTO, off-site copies and periodic restore drills with your operator.

Trusted-server account recovery, from an interactive terminal on the host with the correct private environment:

```sh
# -T is intentionally absent: hidden password prompts need an interactive TTY.
docker compose --env-file .env -f deployment/compose.yaml exec api \
  python -m backend.cli reset-password account@school.edu
```

The CLI reads a hidden confirmed password, revokes sessions/reset tokens, and does not alter school records. It is not an unauthenticated web reset. Verify the operator's authority independently.

## Verification boundary

Frontend/backend/PostgreSQL/native-CV/browser/offline/migration/recovery checks executed in this sandbox are listed in [PROGRESS.md](PROGRESS.md) and [TESTING.md](TESTING.md). Docker Engine is not installed in the sandbox: local image/Compose/Caddy execution is **not claimed**. The separate container job in [GitHub run 44541435692](https://github.com/abc07552/OMR-SHEET-Check-/actions/runs/44541435692), source checkpoint `ff57c72`, successfully built/validated the image and Compose/Caddy configuration, applied real migrations and checked non-root runtime, native OCR executable availability, PostgreSQL non-superuser access and encrypted storage. Check the latest-head CI result for subsequent changes. These container smoke tests do not prove public DNS/ACME delivery, external cloud services, high availability or physical scanning accuracy.
