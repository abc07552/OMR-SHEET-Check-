import express from "express";
import helmet from "helmet";
import { DatabaseSync } from "node:sqlite";
import {
  randomBytes,
  scrypt,
  timingSafeEqual,
  createHash,
  randomUUID,
} from "node:crypto";
import { promisify } from "node:util";
import {
  mkdirSync,
  writeFileSync,
  readFileSync,
  renameSync,
  unlinkSync,
  chmodSync,
} from "node:fs";
import { resolve } from "node:path";
import {
  credentials,
  userInput,
  schoolInput,
  workspaceSchema,
  emptyWorkspace,
} from "./validation.mjs";

const scryptAsync = promisify(scrypt),
  DAY = 86400000;
async function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  const key = await scryptAsync(password, salt, 64, { N: 16384, r: 8, p: 1 });
  return `${salt}:${key.toString("hex")}`;
}
async function checkPassword(password, stored) {
  try {
    const [salt, hash] = stored.split(":"),
      key = await scryptAsync(password, salt, 64, { N: 16384, r: 8, p: 1 }),
      saved = Buffer.from(hash, "hex");
    return saved.length === key.length && timingSafeEqual(saved, key);
  } catch {
    return false;
  }
}
const digest = (s) => createHash("sha256").update(s).digest("hex");
export function createApp({
  dataDir = process.env.DATA_DIR || resolve(".data"),
  testing = false,
  allowSetup = process.env.NODE_ENV !== "production",
  setupToken = process.env.SETUP_TOKEN || "",
  secureCookies = process.env.NODE_ENV === "production",
} = {}) {
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(resolve(dataDir, "markly.sqlite"));
  chmodSync(resolve(dataDir, "markly.sqlite"), 0o600);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
 CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,email TEXT NOT NULL UNIQUE,name TEXT NOT NULL,password_hash TEXT NOT NULL,owner INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS schools(id TEXT PRIMARY KEY,name TEXT NOT NULL,code TEXT NOT NULL,address TEXT NOT NULL DEFAULT '');
 CREATE TABLE IF NOT EXISTS memberships(user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,role TEXT NOT NULL CHECK(role IN ('admin','teacher')),PRIMARY KEY(user_id,school_id));
 CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,expires INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS workspaces(school_id TEXT PRIMARY KEY REFERENCES schools(id) ON DELETE CASCADE,revision INTEGER NOT NULL DEFAULT 1,payload TEXT NOT NULL,updated_at TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS backups(id TEXT PRIMARY KEY,school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,name TEXT NOT NULL,filename TEXT NOT NULL,created_at TEXT NOT NULL,automatic INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY AUTOINCREMENT,school_id TEXT,user_id TEXT,action TEXT NOT NULL,created_at TEXT NOT NULL);
 `);
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", 1);
  const webOrigin = process.env.PUBLIC_WEB_ORIGIN || "";
  app.use(
    helmet({
      crossOriginEmbedderPolicy: false,
      // Development previews are embedded by Arena; production remains same-origin.
      frameguard: secureCookies ? { action: "sameorigin" } : false,
      contentSecurityPolicy: {
        directives: {
          frameAncestors: secureCookies ? ["'self'"] : null,
          upgradeInsecureRequests: secureCookies ? [] : null,
          defaultSrc: ["'self'"],
          // The bundled OpenCV/Emscripten bindings use Function constructors.
          // No remote scripts are allowed; user content is never executed.
          scriptSrc: ["'self'", "'wasm-unsafe-eval'", "'unsafe-eval'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", "data:", "blob:"],
          workerSrc: ["'self'", "blob:"],
          connectSrc: [
            "'self'",
            "data:",
            "blob:",
            ...(webOrigin ? [webOrigin] : []),
          ],
          fontSrc: ["'self'", "data:"],
        },
      },
    }),
  );
  app.use((req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    if (webOrigin && req.headers.origin === webOrigin) {
      res.setHeader("Access-Control-Allow-Origin", webOrigin);
      res.setHeader("Access-Control-Allow-Credentials", "true");
      res.setHeader("Vary", "Origin");
      res.setHeader(
        "Access-Control-Allow-Headers",
        "Content-Type,X-Markly-Request",
      );
      res.setHeader(
        "Access-Control-Allow-Methods",
        "GET,POST,PUT,DELETE,OPTIONS",
      );
      if (req.method === "OPTIONS") return res.sendStatus(204);
    }
    next();
  });
  app.use(express.json({ limit: "15mb" }));
  const fail = (res, status, message) =>
    res.status(status).json({ error: message });
  const audit = (schoolId, userId, action) =>
    db
      .prepare(
        "INSERT INTO audit(school_id,user_id,action,created_at) VALUES(?,?,?,?)",
      )
      .run(schoolId, userId, action, new Date().toISOString());
  const cookieOptions = {
    httpOnly: true,
    secure: secureCookies,
    sameSite: webOrigin ? "none" : "strict",
    path: "/",
    maxAge: DAY,
  };
  const auth = (req, res, next) => {
    const token = req.headers.cookie
      ?.split(";")
      .map((s) => s.trim())
      .find((s) => s.startsWith("markly_session="))
      ?.slice(15);
    if (!token) return fail(res, 401, "Sign in to continue.");
    const user = db
      .prepare(
        "SELECT u.id,u.email,u.name,u.owner FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires>?",
      )
      .get(digest(token), Date.now());
    if (!user)
      return fail(res, 401, "Your session has expired. Please sign in again.");
    req.user = user;
    next();
  };
  app.use("/api", (req, res, next) => {
    if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) {
      if (req.headers["x-markly-request"] !== "1")
        return fail(res, 403, "The request could not be verified.");
      const origin = req.headers.origin;
      if (origin) {
        const self = `${req.protocol}://${req.get("host")}`;
        if (origin !== self && origin !== webOrigin) {
          if (!(allowSetup && /^https:\/\/[a-z0-9-]+\.e2b\.app$/.test(origin)))
            return fail(res, 403, "This origin is not allowed.");
        }
      }
    }
    next();
  });
  const membership = (role) => (req, res, next) => {
    const m = db
      .prepare("SELECT role FROM memberships WHERE user_id=? AND school_id=?")
      .get(req.user.id, req.params.schoolId);
    if (!m) return fail(res, 403, "You do not have access to this school.");
    if (role === "admin" && m.role !== "admin")
      return fail(res, 403, "Only a school administrator can do that.");
    req.role = m.role;
    next();
  };
  const userInfo = (user) => ({
    id: user.id,
    email: user.email,
    name: user.name,
    owner: !!user.owner,
    memberships: db
      .prepare(
        "SELECT s.id AS schoolId,s.name,s.code,m.role FROM memberships m JOIN schools s ON s.id=m.school_id WHERE m.user_id=? ORDER BY s.name",
      )
      .all(user.id),
  });
  const issueSession = (res, user) => {
    const token = randomBytes(32).toString("base64url");
    db.prepare("DELETE FROM sessions WHERE expires<?").run(Date.now());
    db.prepare(
      "INSERT INTO sessions(token_hash,user_id,expires) VALUES(?,?,?)",
    ).run(digest(token), user.id, Date.now() + DAY);
    res.cookie("markly_session", token, cookieOptions);
  };
  const attempts = new Map();
  function limited(key, limit = 12) {
    const now = Date.now(),
      item = attempts.get(key);
    if (attempts.size > 10000)
      for (const [k, v] of attempts) if (v.until < now) attempts.delete(k);
    if (!item || item.until < now) {
      attempts.set(key, { count: 1, until: now + 10 * 60000 });
      return false;
    }
    item.count++;
    return item.count > limit;
  }
  const parse = (schema, input, res) => {
    const result = schema.safeParse(input);
    if (!result.success) {
      fail(res, 400, result.error.issues[0]?.message || "Invalid request.");
      return null;
    }
    return result.data;
  };
  function snapshot(
    schoolId,
    name = "Automatic recovery point",
    automatic = true,
  ) {
    const row = db
      .prepare("SELECT payload FROM workspaces WHERE school_id=?")
      .get(schoolId);
    if (!row) throw new Error("Workspace not found.");
    const id = randomUUID(),
      dir = resolve(dataDir, "backups", schoolId);
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const filename = `${id}.json`,
      temp = resolve(dir, `${filename}.tmp`);
    writeFileSync(temp, row.payload, { mode: 0o600 });
    renameSync(temp, resolve(dir, filename));
    db.prepare(
      "INSERT INTO backups(id,school_id,name,filename,created_at,automatic) VALUES(?,?,?,?,?,?)",
    ).run(
      id,
      schoolId,
      name,
      filename,
      new Date().toISOString(),
      automatic ? 1 : 0,
    );
    const old = db
      .prepare(
        "SELECT id,filename FROM backups WHERE school_id=? AND automatic=1 ORDER BY created_at DESC LIMIT -1 OFFSET 14",
      )
      .all(schoolId);
    for (const b of old) {
      try {
        unlinkSync(resolve(dir, b.filename));
      } catch {}
      db.prepare("DELETE FROM backups WHERE id=?").run(b.id);
    }
    return {
      id,
      schoolId,
      name,
      createdAt: new Date().toISOString(),
      automatic,
    };
  }
  app.get("/api/health", (_req, res) =>
    res.json({
      ok: true,
      service: "markly-api",
      version: 2,
      storage: "sqlite",
    }),
  );
  app.get("/api/setup/status", (_req, res) =>
    res.json({
      needsSetup: !db.prepare("SELECT id FROM users LIMIT 1").get(),
      setupAllowed: allowSetup || !!setupToken,
      tokenRequired: !allowSetup,
    }),
  );
  app.post("/api/setup", async (req, res) => {
    if (limited(`setup:${req.ip}`, 5))
      return fail(
        res,
        429,
        "Too many setup attempts. Try again in 10 minutes.",
      );
    if (db.prepare("SELECT id FROM users LIMIT 1").get())
      return fail(res, 409, "Setup is already complete. Sign in instead.");
    if (!allowSetup) {
      if (!setupToken)
        return fail(
          res,
          403,
          "Ask the server owner to configure SETUP_TOKEN before creating the first administrator.",
        );
      const candidate =
        typeof req.body.setupToken === "string" ? req.body.setupToken : "";
      if (
        !timingSafeEqual(
          Buffer.from(digest(candidate)),
          Buffer.from(digest(setupToken)),
        )
      )
        return fail(res, 403, "The setup token is incorrect.");
    }
    const input = parse(
      userInput.extend({ school: schoolInput }),
      { ...req.body, role: "admin" },
      res,
    );
    if (!input) return;
    const passwordHash = await hashPassword(input.password);
    if (db.prepare("SELECT id FROM users LIMIT 1").get())
      return fail(res, 409, "Setup was completed by another administrator.");
    const user = {
        id: randomUUID(),
        email: input.email,
        name: input.name,
        owner: 1,
      },
      school = { ...input.school, id: randomUUID() };
    db.exec("BEGIN IMMEDIATE");
    try {
      db.prepare("INSERT INTO users VALUES(?,?,?,?,?,?)").run(
        user.id,
        user.email,
        user.name,
        passwordHash,
        1,
        new Date().toISOString(),
      );
      db.prepare("INSERT INTO schools VALUES(?,?,?,?)").run(
        school.id,
        school.name,
        school.code,
        school.address || "",
      );
      db.prepare("INSERT INTO memberships VALUES(?,?,?)").run(
        user.id,
        school.id,
        "admin",
      );
      db.prepare("INSERT INTO workspaces VALUES(?,?,?,?)").run(
        school.id,
        1,
        JSON.stringify(emptyWorkspace(school, user.name)),
        new Date().toISOString(),
      );
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
    issueSession(res, user);
    audit(school.id, user.id, "Created school and administrator");
    res.status(201).json({ user: userInfo(user) });
  });
  app.post("/api/auth/login", async (req, res) => {
    const email =
      typeof req.body.email === "string" ? req.body.email.toLowerCase() : "";
    if (
      limited(`login-ip:${req.ip}`, 40) ||
      limited(`login:${req.ip}:${email}`)
    )
      return fail(
        res,
        429,
        "Too many sign-in attempts. Try again in 10 minutes.",
      );
    const input = parse(credentials, req.body, res);
    if (!input) return;
    const user = db
      .prepare("SELECT * FROM users WHERE email=?")
      .get(input.email);
    const valid = await checkPassword(
      input.password,
      user?.password_hash ||
        "00000000000000000000000000000000:00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000",
    );
    if (!user || !valid)
      return fail(res, 401, "Email or password is incorrect.");
    if (
      !db
        .prepare("SELECT school_id FROM memberships WHERE user_id=? LIMIT 1")
        .get(user.id)
    )
      return fail(
        res,
        403,
        "Your account does not have a school membership. Contact an administrator.",
      );
    issueSession(res, user);
    attempts.delete(`login:${req.ip}:${email}`);
    res.json({ user: userInfo(user) });
  });
  app.get("/api/auth/me", auth, (req, res) =>
    res.json({ user: userInfo(req.user) }),
  );
  app.post("/api/auth/logout", auth, (req, res) => {
    const token = req.headers.cookie
      ?.split(";")
      .map((s) => s.trim())
      .find((s) => s.startsWith("markly_session="))
      ?.slice(15);
    if (token)
      db.prepare("DELETE FROM sessions WHERE token_hash=?").run(digest(token));
    res.clearCookie("markly_session", { ...cookieOptions, maxAge: undefined });
    res.json({ ok: true });
  });
  app.post("/api/auth/password", auth, async (req, res) => {
    if (limited(`password:${req.user.id}`, 6))
      return fail(res, 429, "Too many attempts. Try again later.");
    const input = parse(
      credentials,
      { email: req.user.email, password: req.body.password },
      res,
    );
    if (!input) return;
    const user = db
      .prepare("SELECT password_hash FROM users WHERE id=?")
      .get(req.user.id);
    if (
      !(await checkPassword(
        String(req.body.currentPassword || ""),
        user.password_hash,
      ))
    )
      return fail(res, 403, "Your current password is incorrect.");
    db.prepare("UPDATE users SET password_hash=? WHERE id=?").run(
      await hashPassword(input.password),
      req.user.id,
    );
    db.prepare("DELETE FROM sessions WHERE user_id=?").run(req.user.id);
    issueSession(res, req.user);
    res.json({ ok: true });
  });
  app.post("/api/schools", auth, (req, res) => {
    if (
      !db
        .prepare(
          "SELECT role FROM memberships WHERE user_id=? AND role='admin' LIMIT 1",
        )
        .get(req.user.id)
    )
      return fail(res, 403, "Only administrators can create a school.");
    const input = parse(schoolInput, req.body, res);
    if (!input) return;
    const school = { id: randomUUID(), ...input };
    db.exec("BEGIN");
    try {
      db.prepare("INSERT INTO schools VALUES(?,?,?,?)").run(
        school.id,
        school.name,
        school.code,
        school.address || "",
      );
      db.prepare("INSERT INTO memberships VALUES(?,?,?)").run(
        req.user.id,
        school.id,
        "admin",
      );
      db.prepare("INSERT INTO workspaces VALUES(?,?,?,?)").run(
        school.id,
        1,
        JSON.stringify(emptyWorkspace(school, req.user.name)),
        new Date().toISOString(),
      );
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
    res.status(201).json({ school, user: userInfo(req.user) });
  });
  app.get(
    "/api/schools/:schoolId/workspace",
    auth,
    membership(),
    (req, res) => {
      const row = db
        .prepare("SELECT * FROM workspaces WHERE school_id=?")
        .get(req.params.schoolId);
      res.json({
        workspace: JSON.parse(row.payload),
        revision: row.revision,
        role: req.role,
      });
    },
  );
  app.put(
    "/api/schools/:schoolId/workspace",
    auth,
    membership(),
    (req, res) => {
      const workspace = parse(workspaceSchema, req.body.workspace, res);
      if (!workspace) return;
      if (workspace.activeSchoolId !== req.params.schoolId)
        return fail(res, 403, "The workspace belongs to another school.");
      const row = db
        .prepare("SELECT * FROM workspaces WHERE school_id=?")
        .get(req.params.schoolId);
      if (
        !Number.isInteger(req.body.revision) ||
        req.body.revision !== row.revision
      )
        return fail(
          res,
          409,
          "This workspace changed in another session. Export your unsaved changes, then reload.",
        );
      const previous = JSON.parse(row.payload);
      if (
        req.role !== "admin" &&
        (workspace.school !== previous.school ||
          workspace.schools.some((s) => {
            const old = previous.schools.find((p) => p.id === s.id);
            return (
              !old ||
              old.name !== s.name ||
              old.code !== s.code ||
              (old.address || "") !== (s.address || "")
            );
          }))
      )
        return fail(
          res,
          403,
          "Only administrators can rename or change school details.",
        );
      const last = db
        .prepare(
          "SELECT created_at FROM backups WHERE school_id=? AND automatic=1 ORDER BY created_at DESC LIMIT 1",
        )
        .get(req.params.schoolId);
      if (!last || Date.now() - Date.parse(last.created_at) > 15 * 60000)
        snapshot(req.params.schoolId);
      const updated = db
        .prepare(
          "UPDATE workspaces SET payload=?,revision=revision+1,updated_at=? WHERE school_id=? AND revision=?",
        )
        .run(
          JSON.stringify(workspace),
          new Date().toISOString(),
          req.params.schoolId,
          row.revision,
        );
      if (!updated.changes)
        return fail(res, 409, "Workspace changed. Reload before saving.");
      if (req.role === "admin")
        db.prepare("UPDATE schools SET name=? WHERE id=?").run(
          workspace.school,
          req.params.schoolId,
        );
      audit(
        req.params.schoolId,
        req.user.id,
        `Saved workspace: ${workspace.students.length} students, ${workspace.results.length} results`,
      );
      res.json({ revision: row.revision + 1 });
    },
  );
  app.get(
    "/api/schools/:schoolId/users",
    auth,
    membership("admin"),
    (req, res) =>
      res.json({
        users: db
          .prepare(
            "SELECT u.id,u.name,u.email,m.role FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.school_id=? ORDER BY u.name",
          )
          .all(req.params.schoolId),
      }),
  );
  app.post(
    "/api/schools/:schoolId/users",
    auth,
    membership("admin"),
    async (req, res) => {
      const input = parse(userInput, req.body, res);
      if (!input) return;
      let user = db
          .prepare("SELECT * FROM users WHERE email=?")
          .get(input.email),
        existing = !!user;
      if (
        user &&
        db
          .prepare(
            "SELECT role FROM memberships WHERE user_id=? AND school_id=?",
          )
          .get(user.id, req.params.schoolId)
      )
        return fail(
          res,
          409,
          "This person is already a member of this school.",
        );
      const hash = user ? null : await hashPassword(input.password);
      db.exec("BEGIN");
      try {
        if (!user) {
          user = { id: randomUUID(), ...input };
          db.prepare("INSERT INTO users VALUES(?,?,?,?,?,?)").run(
            user.id,
            user.email,
            user.name,
            hash,
            0,
            new Date().toISOString(),
          );
        }
        db.prepare("INSERT INTO memberships VALUES(?,?,?)").run(
          user.id,
          req.params.schoolId,
          input.role,
        );
        db.exec("COMMIT");
      } catch (e) {
        db.exec("ROLLBACK");
        throw e;
      }
      audit(req.params.schoolId, req.user.id, `Added ${input.role} membership`);
      res.status(201).json({ id: user.id, existing });
    },
  );
  app.delete(
    "/api/schools/:schoolId/users/:userId",
    auth,
    membership("admin"),
    (req, res) => {
      const member = db
        .prepare("SELECT role FROM memberships WHERE user_id=? AND school_id=?")
        .get(req.params.userId, req.params.schoolId);
      if (!member) return fail(res, 404, "Membership not found.");
      if (
        member.role === "admin" &&
        db
          .prepare(
            "SELECT count(*) AS n FROM memberships WHERE school_id=? AND role='admin'",
          )
          .get(req.params.schoolId).n <= 1
      )
        return fail(
          res,
          400,
          "A school must retain at least one administrator.",
        );
      db.prepare("DELETE FROM memberships WHERE user_id=? AND school_id=?").run(
        req.params.userId,
        req.params.schoolId,
      );
      audit(req.params.schoolId, req.user.id, "Removed a school membership");
      res.json({ ok: true });
    },
  );
  app.post(
    "/api/schools/:schoolId/users/:userId/password",
    auth,
    membership("admin"),
    async (req, res) => {
      if (limited(`reset:${req.user.id}`, 6))
        return fail(
          res,
          429,
          "Too many reset attempts. Try again in 10 minutes.",
        );
      const input = parse(
        credentials,
        { email: req.user.email, password: req.body.password },
        res,
      );
      if (!input) return;
      const admin = db
        .prepare("SELECT password_hash FROM users WHERE id=?")
        .get(req.user.id);
      if (
        !(await checkPassword(
          String(req.body.currentPassword || ""),
          admin.password_hash,
        ))
      )
        return fail(res, 403, "Your administrator password is incorrect.");
      const target = db
        .prepare(
          "SELECT u.id,u.owner FROM users u JOIN memberships m ON m.user_id=u.id WHERE u.id=? AND m.school_id=?",
        )
        .get(req.params.userId, req.params.schoolId);
      if (!target) return fail(res, 404, "School member not found.");
      if (
        target.owner ||
        db
          .prepare("SELECT count(*) AS n FROM memberships WHERE user_id=?")
          .get(target.id).n !== 1
      )
        return fail(
          res,
          403,
          "Multi-school accounts and the server owner must change their own password or use server-owner recovery.",
        );
      db.prepare("UPDATE users SET password_hash=? WHERE id=?").run(
        await hashPassword(input.password),
        target.id,
      );
      db.prepare("DELETE FROM sessions WHERE user_id=?").run(target.id);
      audit(req.params.schoolId, req.user.id, "Reset a school member password");
      res.json({ ok: true });
    },
  );
  app.get(
    "/api/schools/:schoolId/backups",
    auth,
    membership("admin"),
    (req, res) =>
      res.json({
        backups: db
          .prepare(
            "SELECT id,name,created_at AS createdAt,automatic FROM backups WHERE school_id=? ORDER BY created_at DESC",
          )
          .all(req.params.schoolId),
      }),
  );
  app.post(
    "/api/schools/:schoolId/backups",
    auth,
    membership("admin"),
    (req, res) => {
      const name =
        typeof req.body.name === "string"
          ? req.body.name.trim().slice(0, 120)
          : "Manual backup";
      const backup = snapshot(
        req.params.schoolId,
        name || "Manual backup",
        false,
      );
      audit(req.params.schoolId, req.user.id, "Created recovery point");
      res.status(201).json({ backup });
    },
  );
  app.get(
    "/api/schools/:schoolId/backups/:backupId",
    auth,
    membership("admin"),
    (req, res) => {
      const backup = db
        .prepare("SELECT filename FROM backups WHERE id=? AND school_id=?")
        .get(req.params.backupId, req.params.schoolId);
      if (!backup) return fail(res, 404, "Backup not found.");
      res
        .type("application/json")
        .attachment(`markly-backup-${req.params.backupId}.json`)
        .send(
          readFileSync(
            resolve(dataDir, "backups", req.params.schoolId, backup.filename),
          ),
        );
    },
  );
  app.post(
    "/api/schools/:schoolId/backups/:backupId/restore",
    auth,
    membership("admin"),
    async (req, res) => {
      if (limited(`restore:${req.user.id}`, 6))
        return fail(res, 429, "Too many restore attempts. Try again later.");
      const user = db
        .prepare("SELECT password_hash FROM users WHERE id=?")
        .get(req.user.id);
      if (
        !(await checkPassword(
          String(req.body.password || ""),
          user.password_hash,
        ))
      )
        return fail(
          res,
          403,
          "Your current password is required to restore a server backup.",
        );
      const backup = db
        .prepare("SELECT filename FROM backups WHERE id=? AND school_id=?")
        .get(req.params.backupId, req.params.schoolId);
      if (!backup) return fail(res, 404, "Backup not found.");
      const workspace = parse(
        workspaceSchema,
        JSON.parse(
          readFileSync(
            resolve(dataDir, "backups", req.params.schoolId, backup.filename),
            "utf8",
          ),
        ),
        res,
      );
      if (!workspace) return;
      if (workspace.activeSchoolId !== req.params.schoolId)
        return fail(res, 403, "This backup belongs to a different school.");
      snapshot(req.params.schoolId, "Before restore", false);
      db.prepare(
        "UPDATE workspaces SET payload=?,revision=revision+1,updated_at=? WHERE school_id=?",
      ).run(
        JSON.stringify(workspace),
        new Date().toISOString(),
        req.params.schoolId,
      );
      audit(req.params.schoolId, req.user.id, "Restored recovery point");
      res.json({ ok: true });
    },
  );
  app.get(
    "/api/schools/:schoolId/audit",
    auth,
    membership("admin"),
    (req, res) =>
      res.json({
        events: db
          .prepare(
            "SELECT a.action,a.created_at AS createdAt,u.name AS user FROM audit a LEFT JOIN users u ON u.id=a.user_id WHERE a.school_id=? ORDER BY a.id DESC LIMIT 50",
          )
          .all(req.params.schoolId),
      }),
  );
  app.use("/api", (_req, res) => fail(res, 404, "API endpoint not found."));
  app.use((err, _req, res, _next) => {
    if (err?.type === "entity.too.large")
      return fail(
        res,
        413,
        "This workspace is too large. Archive older results or split the import.",
      );
    if (err instanceof SyntaxError)
      return fail(res, 400, "Invalid JSON request.");
    if (!testing) console.error("Request failed:", err.message);
    fail(
      res,
      500,
      "The server could not complete this request. Your last saved data is unchanged.",
    );
  });
  const interval = setInterval(() => {
    try {
      const schools = db.prepare("SELECT school_id FROM workspaces").all();
      for (const s of schools) {
        const last = db
          .prepare(
            "SELECT created_at FROM backups WHERE school_id=? AND automatic=1 ORDER BY created_at DESC LIMIT 1",
          )
          .get(s.school_id);
        if (!last || Date.now() - Date.parse(last.created_at) >= DAY)
          snapshot(s.school_id, "Daily automatic backup", true);
      }
    } catch (e) {
      if (!testing) console.error("Automatic backup failed:", e.message);
    }
  }, 60 * 60000);
  interval.unref();
  app.locals.db = db;
  app.locals.close = () => {
    clearInterval(interval);
    db.close();
  };
  app.locals.snapshot = snapshot;
  app.locals.dataDir = dataDir;
  return app;
}
export { hashPassword, checkPassword };
