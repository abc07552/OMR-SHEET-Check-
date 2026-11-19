import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "./app.mjs";
const dir = mkdtempSync(join(tmpdir(), "markly-test-")),
  password = "Test-only-password-7289";
let app, admin, teacher, schoolId, teacherId, revision, workspace, otherSchool;
const write = (agent, method, url, data) =>
  agent[method](url).set("X-Markly-Request", "1").send(data);
before(() => {
  app = createApp({
    dataDir: dir,
    testing: true,
    allowSetup: true,
    secureCookies: false,
  });
  admin = request.agent(app);
  teacher = request.agent(app);
});
after(() => {
  app.locals.close();
  rmSync(dir, { recursive: true, force: true });
});
test("health, security headers and first-run status are available", async () => {
  const r = await request(app).get("/api/health").expect(200);
  assert.equal(r.body.storage, "sqlite");
  assert.ok(r.headers["content-security-policy"]);
  assert.equal(r.headers["x-powered-by"], undefined);
  assert.equal(
    (await request(app).get("/api/setup/status")).body.needsSetup,
    true,
  );
});
test("authentication and CSRF checks reject unauthenticated changes", async () => {
  await request(app).get("/api/auth/me").expect(401);
  await request(app).post("/api/setup").send({}).expect(403);
  await write(request(app), "post", "/api/setup", {
    email: "no",
    password: "short",
  }).expect(400);
});
test("first administrator uses a hashed password and HttpOnly session", async () => {
  const r = await write(admin, "post", "/api/setup", {
    name: "Test Admin",
    email: "ADMIN@EXAMPLE.ORG",
    password,
    school: { name: "Test School", code: "TS" },
  }).expect(201);
  assert.equal(r.body.user.email, "admin@example.org");
  assert.ok(r.headers["set-cookie"][0].includes("HttpOnly"));
  assert.ok(r.headers["set-cookie"][0].includes("SameSite=Strict"));
  schoolId = r.body.user.memberships[0].schoolId;
  const row = app.locals.db.prepare("SELECT password_hash FROM users").get();
  assert.notEqual(row.password_hash, password);
  assert.ok(!row.password_hash.includes(password));
});
test("first-run setup cannot be used twice", async () => {
  await write(request(app), "post", "/api/setup", {}).expect(409);
  assert.equal(
    (await request(app).get("/api/setup/status")).body.needsSetup,
    false,
  );
});
test("invalid login does not reveal whether an email exists", async () => {
  const a = await write(request(app), "post", "/api/auth/login", {
      email: "admin@example.org",
      password: "not-the-right-password",
    }).expect(401),
    b = await write(request(app), "post", "/api/auth/login", {
      email: "unknown@example.org",
      password: "not-the-right-password",
    }).expect(401);
  assert.equal(a.body.error, b.body.error);
});
test("an administrator creates a teacher membership", async () => {
  const r = await write(admin, "post", `/api/schools/${schoolId}/users`, {
    name: "Teacher One",
    email: "teacher@example.org",
    password,
    role: "teacher",
  }).expect(201);
  teacherId = r.body.id;
  await write(teacher, "post", "/api/auth/login", {
    email: "teacher@example.org",
    password,
  }).expect(200);
});
test("teacher permissions are enforced on the server, not just in UI", async () => {
  for (const path of ["users", "backups", "audit"])
    await teacher.get(`/api/schools/${schoolId}/${path}`).expect(403);
  await write(teacher, "post", `/api/schools/${schoolId}/users`, {
    name: "Escalate",
    email: "escape@example.org",
    password,
    role: "admin",
  }).expect(403);
  await write(teacher, "post", "/api/schools", {
    name: "Wrong",
    code: "X",
  }).expect(403);
});
test("a shared workspace is loaded and accepts valid teacher updates", async () => {
  const r = await teacher.get(`/api/schools/${schoolId}/workspace`).expect(200);
  workspace = r.body.workspace;
  revision = r.body.revision;
  assert.equal(workspace.results.length, 0);
  workspace.students.push({
    id: "student-1",
    schoolId,
    name: "Maya Verma",
    roll: "00101",
    section: "12 A",
    registeredAt: new Date().toISOString(),
  });
  workspace.classes.push({
    id: "class-1",
    schoolId,
    name: "12 A",
    academicYear: "2026–27",
  });
  const saved = await write(
    teacher,
    "put",
    `/api/schools/${schoolId}/workspace`,
    { workspace, revision },
  ).expect(200);
  revision = saved.body.revision;
  assert.equal(revision, 2);
  assert.equal(
    (await admin.get(`/api/schools/${schoolId}/workspace`)).body.workspace
      .students[0].roll,
    "00101",
  );
});
test("revision conflicts preserve the newer saved workspace", async () => {
  await write(admin, "put", `/api/schools/${schoolId}/workspace`, {
    workspace: { ...workspace, teacher: "Stale write" },
    revision: 1,
  }).expect(409);
  assert.equal(
    (await admin.get(`/api/schools/${schoolId}/workspace`)).body.workspace
      .teacher,
    "Test Admin",
  );
});
test("cross-school references and malformed questions are rejected", async () => {
  const malformed = structuredClone(workspace);
  malformed.students[0].schoolId = "another-school";
  await write(teacher, "put", `/api/schools/${schoolId}/workspace`, {
    workspace: malformed,
    revision,
  }).expect(400);
  malformed.students[0].schoolId = schoolId;
  malformed.exams[0].questions = 501;
  await write(teacher, "put", `/api/schools/${schoolId}/workspace`, {
    workspace: malformed,
    revision,
  }).expect(400);
});
test("duplicate roll numbers and invalid answer keys cannot enter SQLite", async () => {
  const duplicate = structuredClone(workspace);
  duplicate.students.push({ ...duplicate.students[0], id: "different-id" });
  await write(teacher, "put", `/api/schools/${schoolId}/workspace`, {
    workspace: duplicate,
    revision,
  }).expect(400);
  const bad = structuredClone(workspace);
  bad.exams[0].published = true;
  await write(teacher, "put", `/api/schools/${schoolId}/workspace`, {
    workspace: bad,
    revision,
  }).expect(400);
});
test("teachers cannot rename a school by writing workspace JSON", async () => {
  await write(teacher, "put", `/api/schools/${schoolId}/workspace`, {
    workspace: { ...workspace, school: "Tampered" },
    revision,
  }).expect(403);
});
test("multiple schools remain isolated", async () => {
  const r = await write(admin, "post", "/api/schools", {
    name: "Second School",
    code: "SS",
  }).expect(201);
  otherSchool = r.body.school.id;
  await teacher.get(`/api/schools/${otherSchool}/workspace`).expect(403);
  assert.equal(
    (await admin.get(`/api/schools/${otherSchool}/workspace`)).body.workspace
      .students.length,
    0,
  );
});
test("backups are real server files and can be downloaded only by school admins", async () => {
  const r = await write(admin, "post", `/api/schools/${schoolId}/backups`, {
    name: "Before changes",
  }).expect(201);
  const list = await admin.get(`/api/schools/${schoolId}/backups`).expect(200);
  assert.ok(list.body.backups.length >= 2);
  const backup = r.body.backup.id;
  const file = await admin
    .get(`/api/schools/${schoolId}/backups/${backup}`)
    .expect(200);
  assert.equal(file.body.students[0].name, "Maya Verma");
  assert.equal(file.body.password, undefined);
  await teacher.get(`/api/schools/${schoolId}/backups/${backup}`).expect(403);
  await admin.get(`/api/schools/${otherSchool}/backups/${backup}`).expect(404);
});
test("server restore requires password and creates a pre-restore recovery point", async () => {
  const before = await write(
    admin,
    "post",
    `/api/schools/${schoolId}/backups`,
    { name: "Restore test" },
  );
  const id = before.body.backup.id;
  await write(admin, "post", `/api/schools/${schoolId}/backups/${id}/restore`, {
    password: "wrong",
  }).expect(403);
  const beforeCount = (await admin.get(`/api/schools/${schoolId}/backups`)).body
    .backups.length;
  await write(admin, "post", `/api/schools/${schoolId}/backups/${id}/restore`, {
    password,
  }).expect(200);
  const r = await admin.get(`/api/schools/${schoolId}/workspace`);
  revision = r.body.revision;
  assert.ok(
    (await admin.get(`/api/schools/${schoolId}/backups`)).body.backups.length >
      beforeCount,
  );
});
test("cross-origin mutating requests are rejected", async () => {
  await admin
    .post("/api/auth/logout")
    .set("X-Markly-Request", "1")
    .set("Origin", "https://attacker.invalid")
    .send({})
    .expect(403);
  await admin.get("/api/auth/me").expect(200);
});
test("password reset requires administrator verification and revokes all target sessions", async () => {
  await write(
    admin,
    "post",
    `/api/schools/${schoolId}/users/${teacherId}/password`,
    { currentPassword: "wrong", password: "New-test-password-192837" },
  ).expect(403);
  await write(
    admin,
    "post",
    `/api/schools/${schoolId}/users/${teacherId}/password`,
    { currentPassword: password, password: "New-test-password-192837" },
  ).expect(200);
  await teacher.get("/api/auth/me").expect(401);
  await write(teacher, "post", "/api/auth/login", {
    email: "teacher@example.org",
    password: "New-test-password-192837",
  }).expect(200);
});
test("removing membership immediately revokes school access", async () => {
  await write(
    admin,
    "delete",
    `/api/schools/${schoolId}/users/${teacherId}`,
    {},
  ).expect(200);
  await teacher.get(`/api/schools/${schoolId}/workspace`).expect(403);
});
test("a school cannot lose its last administrator", async () => {
  const id = (await admin.get("/api/auth/me")).body.user.id;
  await write(
    admin,
    "delete",
    `/api/schools/${schoolId}/users/${id}`,
    {},
  ).expect(400);
});
test("audit records actor and consequential writes", async () => {
  const r = await admin.get(`/api/schools/${schoolId}/audit`).expect(200);
  assert.ok(r.body.events.some((e) => e.action.includes("Saved workspace")));
  assert.ok(r.body.events.some((e) => e.action.includes("Restored")));
  assert.ok(r.body.events.some((e) => e.user === "Test Admin"));
});
test("database persists across server instances", async () => {
  const second = createApp({
    dataDir: dir,
    testing: true,
    allowSetup: true,
    secureCookies: false,
  });
  try {
    const agent = request.agent(second);
    await write(agent, "post", "/api/auth/login", {
      email: "admin@example.org",
      password,
    }).expect(200);
    const r = await agent.get(`/api/schools/${schoolId}/workspace`).expect(200);
    assert.equal(r.body.workspace.students[0].roll, "00101");
    assert.equal(r.body.revision, revision);
  } finally {
    second.locals.close();
  }
});
test("sign-out invalidates the cookie session", async () => {
  await write(admin, "post", "/api/auth/logout", {}).expect(200);
  await admin.get("/api/auth/me").expect(401);
});
test("production bootstrap is locked until the server setup token is supplied", async () => {
  const dir2 = mkdtempSync(join(tmpdir(), "markly-prod-")),
    prod = createApp({
      dataDir: dir2,
      testing: true,
      allowSetup: false,
      setupToken: "server-owner-bootstrap-token",
      secureCookies: true,
    });
  try {
    const payload = {
      name: "Owner",
      email: "owner@example.org",
      password,
      school: { name: "Production School", code: "PR" },
    };
    await write(request(prod), "post", "/api/setup", payload).expect(403);
    const r = await write(request(prod), "post", "/api/setup", {
      ...payload,
      setupToken: "server-owner-bootstrap-token",
    }).expect(201);
    assert.ok(r.headers["set-cookie"][0].includes("Secure"));
  } finally {
    prod.locals.close();
    rmSync(dir2, { recursive: true, force: true });
  }
});
