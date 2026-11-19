import { DatabaseSync } from "node:sqlite";
import { createInterface } from "node:readline/promises";
import { Writable } from "node:stream";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { existsSync } from "node:fs";
import { hashPassword } from "./app.mjs";

// Local server-owner recovery only. No HTTP endpoint bypasses authentication.
export async function recoverAccount({
  dataDir = process.env.DATA_DIR || ".data",
  email,
  password,
}) {
  if (
    typeof email !== "string" ||
    !email.trim() ||
    typeof password !== "string" ||
    password.length < 12 ||
    password.length > 128
  )
    throw new Error(
      "Provide an account email and a password containing 12–128 characters. No changes made.",
    );
  const path = resolve(dataDir, "markly.sqlite");
  if (!existsSync(path))
    throw new Error(
      "No Markly database found. Set DATA_DIR to the existing server data directory.",
    );
  const db = new DatabaseSync(path);
  db.exec("PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;");
  try {
    const user = db
      .prepare("SELECT id,name FROM users WHERE email=?")
      .get(email.trim().toLowerCase());
    if (!user)
      throw new Error("No account with that email exists. No changes made.");
    const hash = await hashPassword(password);
    db.exec("BEGIN IMMEDIATE");
    try {
      db.prepare("UPDATE users SET password_hash=? WHERE id=?").run(
        hash,
        user.id,
      );
      db.prepare("DELETE FROM sessions WHERE user_id=?").run(user.id);
      db.prepare(
        "INSERT INTO audit(school_id,user_id,action,created_at) VALUES(NULL,?,?,?)",
      ).run(
        user.id,
        "Server-owner password recovery",
        new Date().toISOString(),
      );
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
    return user.name;
  } finally {
    db.close();
  }
}

async function hiddenQuestion(prompt) {
  const silent = new Writable({
    write(_chunk, _encoding, callback) {
      callback();
    },
  });
  const input = createInterface({
    input: process.stdin,
    output: silent,
    terminal: true,
  });
  process.stdout.write(prompt);
  try {
    return await input.question("");
  } finally {
    input.close();
    process.stdout.write("\n");
  }
}
async function main() {
  if (!process.stdin.isTTY)
    throw new Error(
      "Run this command in an interactive terminal on the trusted server.",
    );
  const visible = createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  let email;
  try {
    email = await visible.question("Account email to recover: ");
  } finally {
    visible.close();
  }
  const password = await hiddenQuestion(
    "New password (12–128 characters, hidden): ",
  );
  const confirmation = await hiddenQuestion("Confirm new password (hidden): ");
  if (password !== confirmation)
    throw new Error("Passwords do not match. No changes made.");
  const name = await recoverAccount({ email, password });
  console.log(
    `Password changed for ${name}. All account sessions have been revoked.`,
  );
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
