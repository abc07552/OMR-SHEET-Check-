import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { webcrypto } from "node:crypto";
import { blankWorkspace } from "./data";
import type { AuthUser } from "./session";
import {
  authorizationChanged,
  cachePortal,
  cacheSchool,
  cachedPortal,
  cachedSchool,
  enablePortalVault,
  enableVault,
  forgetVault,
  lockVault,
  offlineImage,
  refreshVaultUser,
  saveOfflineImage,
  unlockVault,
  vaultEnabled,
} from "./offline";
const phrase = "an-independent-offline-passphrase";
const user: AuthUser = {
  id: "teacher",
  name: "Teacher",
  email: "teacher@school.edu",
  owner: false,
  memberships: [
    {
      schoolId: "s",
      name: "School",
      code: "S",
      role: "teacher",
      classIds: ["a", "b"],
      permissions: { scan: true, createExams: true, reports: true },
    },
  ],
};
const workspace = () =>
  blankWorkspace({ id: "s", name: "School", code: "S" }, "Teacher");
async function envelope() {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const r = indexedDB.open("omr-private-offline-v1", 1);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
  return new Promise<Record<string, unknown>>((resolve, reject) => {
    const t = db.transaction("vaults"),
      r = t.objectStore("vaults").getAll();
    r.onsuccess = () => {
      db.close();
      resolve(r.result[0]);
    };
    r.onerror = () => reject(r.error);
  });
}
beforeEach(() => {
  lockVault();
  vi.stubGlobal("indexedDB", new IDBFactory());
  vi.stubGlobal("crypto", webcrypto);
});
afterEach(async () => {
  lockVault();
  // Finish captured writes before replacing IndexedDB with the next factory.
  await forgetVault(user.email);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
describe("authorized encrypted IndexedDB vault", () => {
  it("stores no cleartext identity/records and requires the correct separate passphrase", async () => {
    await enableVault(user, "s", workspace(), 7, phrase);
    const saved = await envelope();
    expect(Object.keys(saved).sort()).toEqual([
      "ciphertext",
      "id",
      "iv",
      "salt",
    ]);
    expect(saved.id).not.toContain("teacher");
    expect(saved.ciphertext).toBeInstanceOf(ArrayBuffer);
    expect(JSON.stringify(saved)).not.toContain(user.email);
    lockVault();
    expect(cachedSchool("s")).toBeUndefined();
    await expect(
      unlockVault(user.email, "not-the-right-passphrase"),
    ).rejects.toThrow(/incorrect/);
    expect((await unlockVault(user.email, phrase)).id).toBe(user.id);
    expect(cachedSchool("s")?.revision).toBe(7);
    await enableVault(user, "s", workspace(), 8, "");
    expect(cachedSchool("s")?.revision).toBe(8);
  });
  it("retains pending and in-flight operation IDs across a real encrypt/decrypt roundtrip", async () => {
    const w = workspace();
    await enableVault(user, "s", w, 3, phrase);
    await cacheSchool("s", {
      workspace: w,
      revision: 3,
      pending: JSON.stringify(w),
      inflight: {
        id: "stable-operation-1",
        revision: 3,
        payload: JSON.stringify(w),
      },
    });
    await expect(enableVault(user, "s", w, 4, "")).rejects.toThrow(
      /Pending work was not overwritten/,
    );
    lockVault();
    await unlockVault(user.email, phrase);
    expect(cachedSchool("s")?.inflight?.id).toBe("stable-operation-1");
  });
  it("checks TTL on every access, not just when initially unlocking", async () => {
    const now = Date.now();
    await enableVault(user, "s", workspace(), 1, phrase);
    await saveOfflineImage(
      "local-image",
      new File([new Uint8Array([1, 2, 3])], "scan.png", { type: "image/png" }),
    );
    vi.spyOn(Date, "now").mockReturnValue(now + 25 * 60 * 60 * 1000);
    expect(vaultEnabled(user.id)).toBe(false);
    expect(cachedSchool("s")).toBeUndefined();
    expect(offlineImage("local-image")).toBeUndefined();
    await expect(
      cacheSchool("s", { workspace: workspace(), revision: 1 }),
    ).rejects.toThrow(/locked or expired/);
    lockVault();
    await expect(unlockVault(user.email, phrase)).rejects.toThrow(/expired/);
    await unlockVault(user.email, phrase, user);
    expect(vaultEnabled(user.id)).toBe(true);
  });
  it("invalidates broader caches after permission reductions without deleting their ciphertext", async () => {
    await enableVault(user, "s", workspace(), 1, phrase);
    const reduced = {
      ...user,
      memberships: user.memberships.map((m) => ({ ...m, classIds: ["a"] })),
    };
    expect(await refreshVaultUser(reduced)).toBe(true);
    expect(vaultEnabled()).toBe(false);
    expect((await envelope()).ciphertext).toBeInstanceOf(ArrayBuffer);
    await expect(unlockVault(user.email, phrase)).rejects.toThrow(/expired/);
    await expect(unlockVault(user.email, phrase, reduced)).rejects.toThrow(
      /permissions changed/,
    );
  });
  it("treats membership removal as an authorization change but not a class-order/name change", () => {
    expect(authorizationChanged(user, { ...user, memberships: [] })).toBe(true);
    expect(
      authorizationChanged(user, {
        ...user,
        name: "Renamed",
        memberships: user.memberships.map((m) => ({
          ...m,
          name: "Renamed School",
          classIds: ["b", "a"],
        })),
      }),
    ).toBe(false);
  });
  it("does not overwrite an existing locked vault and cannot cache another institution", async () => {
    await enableVault(user, "s", workspace(), 1, phrase);
    lockVault();
    await expect(
      enableVault(user, "s", workspace(), 1, phrase),
    ).rejects.toThrow(/already exists/);
    await unlockVault(user.email, phrase);
    await expect(
      cacheSchool("another", { workspace: workspace(), revision: 1 }),
    ).rejects.toThrow(/not authorized/);
    await forgetVault(user.email);
    expect(vaultEnabled()).toBe(false);
    await expect(unlockVault(user.email, phrase)).rejects.toThrow(
      /No encrypted/,
    );
  });
  it("encrypts only a student's own portal, supports refresh, and exposes no staff workspace", async () => {
    const student: AuthUser = {
      ...user,
      id: "learner",
      email: "learner@school.edu",
      memberships: [
        {
          schoolId: "s",
          name: "School",
          code: "S",
          role: "student",
          studentId: "own-student",
        },
      ],
    };
    const portal = {
      student: { id: "own-student", name: "Only me" },
      results: [{ id: "own-result" }],
    };
    await enablePortalVault(student, "s", portal, phrase);
    await enablePortalVault(student, "s", portal, "");
    expect(cachedSchool("s")).toBeUndefined();
    expect(cachedPortal("s")).toEqual(portal);
    await expect(
      cachePortal("s", { student: { id: "other-student" } }),
    ).rejects.toThrow(/own portal/);
    lockVault();
    await unlockVault(student.email, phrase);
    expect(cachedPortal("s")).toEqual(portal);
    expect(cachedPortal("other-school")).toBeUndefined();
  });
  it("captures queued writes before locking so an account switch cannot mix or silently lose them", async () => {
    await enableVault(user, "s", workspace(), 1, phrase);
    const w = workspace();
    w.teacher = "Last deliberate change";
    const pending = cacheSchool("s", {
      workspace: w,
      revision: 1,
      pending: JSON.stringify(w),
    });
    lockVault();
    await pending;
    await unlockVault(user.email, phrase);
    expect(cachedSchool("s")?.workspace.teacher).toBe("Last deliberate change");
  });
  it("never places a delayed original-image read into a different user's vault", async () => {
    await enableVault(user, "s", workspace(), 1, phrase);
    let release!: (buffer: ArrayBuffer) => void;
    const file = new File(["secret pixels"], "original.png", {
      type: "image/png",
    });
    Object.defineProperty(file, "arrayBuffer", {
      value: () =>
        new Promise<ArrayBuffer>((resolve) => {
          release = resolve;
        }),
    });
    const saving = saveOfflineImage("local-delayed", file);
    lockVault();
    const other = { ...user, id: "other", email: "other@school.edu" };
    await enableVault(other, "s", workspace(), 1, phrase);
    release(new TextEncoder().encode("secret pixels").buffer);
    await expect(saving).rejects.toThrow(/original account was locked/);
    expect(vaultEnabled(other.id)).toBe(true);
    expect(offlineImage("local-delayed")).toBeUndefined();
  });
  it("cannot finish opening a vault after the user has explicitly locked it", async () => {
    const subtle = crypto.subtle,
      original = subtle.deriveKey.bind(subtle);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const deriving = vi
      .spyOn(subtle, "deriveKey")
      .mockImplementation(async (...args) => {
        await gate;
        return original(...args);
      });
    const opening = enableVault(user, "s", workspace(), 1, phrase);
    await vi.waitFor(() => expect(deriving).toHaveBeenCalled());
    lockVault();
    release();
    await expect(opening).rejects.toThrow(/account changed/);
    expect(vaultEnabled()).toBe(false);
  });
});
