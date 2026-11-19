import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import request from "supertest";
import { createApp, checkPassword } from "./app.mjs";
import { recoverAccount } from "./reset-password.mjs";

const post = (agent, path, body) =>
  agent.post(path).set("X-Markly-Request", "1").send(body);
test("server-owner recovery changes a salted hash, revokes sessions, and records an audit event", async () => {
  const dir = mkdtempSync(join(tmpdir(), "markly-recovery-"));
  const app = createApp({
    dataDir: dir,
    testing: true,
    allowSetup: true,
    secureCookies: false,
  });
  try {
    const agent = request.agent(app);
    await post(agent, "/api/setup", {
      name: "Recovery Admin",
      email: "recovery@example.org",
      password: "Original-test-password-9213",
      school: { name: "Recovery School", code: "RS" },
    }).expect(201);
    const hash = app.locals.db
      .prepare("SELECT password_hash FROM users")
      .get().password_hash;
    await assert.rejects(
      recoverAccount({
        dataDir: dir,
        email: "missing@example.org",
        password: "New-test-password-783926",
      }),
      /No account/,
    );
    await assert.rejects(
      recoverAccount({
        dataDir: dir,
        email: "recovery@example.org",
        password: "short",
      }),
      /12–128/,
    );
    await agent.get("/api/auth/me").expect(200);
    assert.equal(
      await recoverAccount({
        dataDir: dir,
        email: "RECOVERY@example.org ",
        password: "New-test-password-783926",
      }),
      "Recovery Admin",
    );
    await agent.get("/api/auth/me").expect(401);
    const current = app.locals.db
      .prepare("SELECT password_hash FROM users")
      .get().password_hash;
    assert.notEqual(current, hash);
    assert.equal(
      await checkPassword("New-test-password-783926", current),
      true,
    );
    assert.equal(
      await checkPassword("Original-test-password-9213", current),
      false,
    );
    assert.equal(
      app.locals.db
        .prepare("SELECT action FROM audit ORDER BY id DESC LIMIT 1")
        .get().action,
      "Server-owner password recovery",
    );
    await post(agent, "/api/auth/login", {
      email: "recovery@example.org",
      password: "New-test-password-783926",
    }).expect(200);
  } finally {
    app.locals.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
test("recovery never creates a new database when the data directory is wrong", async () => {
  const dir = mkdtempSync(join(tmpdir(), "markly-no-db-"));
  try {
    await assert.rejects(
      recoverAccount({
        dataDir: dir,
        email: "owner@example.org",
        password: "New-test-password-783926",
      }),
      /No Markly database/,
    );
    assert.equal(existsSync(join(dir, "markly.sqlite")), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
