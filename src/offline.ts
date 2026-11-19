import type { Workspace } from "./data";
import { isValidWorkspace } from "./data";
import type { AuthUser } from "./session";

export interface PendingOperation {
  id: string;
  payload: string;
  revision: number;
}
export interface CachedSchool {
  workspace: Workspace;
  revision: number;
  pending?: string;
  inflight?: PendingOperation;
}
interface Vault {
  version: 1;
  user: AuthUser;
  validatedAt: number;
  schools: Record<string, CachedSchool>;
  images: Record<string, { data: string; media: string }>;
  portals?: Record<string, unknown>;
}
interface Envelope {
  id: string;
  salt: string;
  iv: string;
  ciphertext: ArrayBuffer;
}
let unlocked: { key: CryptoKey; envelope: Envelope; vault: Vault } | undefined;
let lifecycle = 0;
const ensureCurrent = (epoch: number) => {
  if (epoch !== lifecycle)
    throw new Error(
      "The offline account changed while storage was opening. Unlock the intended account again.",
    );
};
let writes: Promise<void> = Promise.resolve();
const lifetime = 24 * 60 * 60 * 1000;
const bytes = (str: string) =>
  Uint8Array.from(atob(str), (s) => s.charCodeAt(0));
const b64 = (value: Uint8Array) => {
  let result = "";
  for (let i = 0; i < value.length; i += 8192)
    result += String.fromCharCode(...value.subarray(i, i + 8192));
  return btoa(result);
};
async function accountId(email: string) {
  const hash = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(email.trim().toLowerCase()),
  );
  return Array.from(new Uint8Array(hash), (n) =>
    n.toString(16).padStart(2, "0"),
  ).join("");
}
async function keyFor(passphrase: string, salt: Uint8Array) {
  const material = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(passphrase),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: salt as BufferSource,
      iterations: 310000,
      hash: "SHA-256",
    },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}
async function transact<T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>,
) {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open("omr-private-offline-v1", 1);
    req.onupgradeneeded = () =>
      req.result.createObjectStore("vaults", { keyPath: "id" });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () =>
      reject(new Error("Private device storage is unavailable."));
  });
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction("vaults", mode),
      request = fn(tx.objectStore("vaults"));
    let value: T;
    request.onsuccess = () => {
      value = request.result;
    };
    tx.oncomplete = () => {
      db.close();
      resolve(value);
    };
    tx.onerror = tx.onabort = () => {
      db.close();
      reject(
        new Error(
          "The encrypted device vault could not be saved. Export your unsaved data.",
        ),
      );
    };
  });
}
async function persist(state: NonNullable<typeof unlocked>, snapshot: Vault) {
  // Capture a consistent immutable version before asynchronous encryption.
  const plain = new TextEncoder().encode(JSON.stringify(snapshot));
  if (plain.length > 100 * 1024 * 1024)
    throw new Error(
      "The offline vault reached 100 MB. Sync and remove old originals before scanning more pages.",
    );
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    state.key,
    plain,
  );
  const envelope = {
    id: state.envelope.id,
    salt: state.envelope.salt,
    iv: b64(iv),
    ciphertext,
  };
  await transact("readwrite", (s) => s.put(envelope));
  if (unlocked === state) state.envelope = envelope;
}
function write(state = unlocked) {
  if (!state) return Promise.resolve();
  const snapshot = structuredClone(state.vault);
  const next = writes.catch(() => {}).then(() => persist(state, snapshot));
  writes = next;
  return next;
}
const validLifetime = (time: number) =>
  Date.now() - time <= lifetime && Date.now() >= time - 60_000;
export function vaultEnabled(userId?: string) {
  return (
    !!unlocked &&
    validLifetime(unlocked.vault.validatedAt) &&
    (!userId || unlocked.vault.user.id === userId)
  );
}
export function authorizationChanged(oldUser: AuthUser, user: AuthUser) {
  const scope = (u: AuthUser) =>
    JSON.stringify(
      u.memberships
        .map((m) => ({
          school: m.schoolId,
          role: m.role,
          student: m.studentId || "",
          classes: [...(m.classIds || [])].sort(),
          permissions: Object.entries(m.permissions || {}).sort(([a], [b]) =>
            a.localeCompare(b),
          ),
        }))
        .sort((a, b) => a.school.localeCompare(b.school)),
    );
  return (
    oldUser.id !== user.id ||
    oldUser.owner !== user.owner ||
    scope(oldUser) !== scope(user)
  );
}
export function lockVault() {
  lifecycle++;
  unlocked = undefined;
}
function validateStaffCache(
  user: AuthUser,
  school: string,
  workspace: Workspace,
) {
  if (
    !isValidWorkspace(workspace) ||
    workspace.activeSchoolId !== school ||
    !workspace.schools?.every((s) => s.id === school) ||
    !user.memberships.some((m) => m.schoolId === school && m.role !== "student")
  )
    throw new Error(
      "Only the authorized single-school staff workspace can be cached.",
    );
}
function validatePersonalCache(
  user: AuthUser,
  school: string,
  portal: unknown,
) {
  const member = user.memberships.find(
    (m) => m.schoolId === school && m.role === "student",
  );
  if (
    !member?.studentId ||
    !portal ||
    typeof portal !== "object" ||
    (portal as { student?: { id?: string } }).student?.id !== member.studentId
  )
    throw new Error("Only the linked student's own portal can be cached.");
}
export async function enableVault(
  user: AuthUser,
  school: string,
  workspace: Workspace,
  revision: number,
  passphrase: string,
) {
  if (!vaultEnabled(user.id) && passphrase.length < 12)
    throw new Error(
      "Use an offline passphrase with at least 12 characters. It is separate from your account password.",
    );
  validateStaffCache(user, school, workspace);
  const epoch = ++lifecycle;
  const id = await accountId(user.email),
    salt = crypto.getRandomValues(new Uint8Array(16));
  const existing = await transact<Envelope | undefined>("readonly", (s) =>
    s.get(id),
  );
  ensureCurrent(epoch);
  if (existing && !vaultEnabled(user.id))
    throw new Error(
      "An encrypted vault already exists. Unlock it first to preserve queued work, or explicitly forget it before creating a replacement.",
    );
  if (vaultEnabled(user.id)) {
    if (
      unlocked!.vault.schools[school]?.pending ||
      unlocked!.vault.schools[school]?.inflight
    )
      throw new Error(
        "Synchronize or deliberately resolve the encrypted queue before refreshing its baseline. Pending work was not overwritten.",
      );
    if (authorizationChanged(unlocked!.vault.user, user)) {
      await refreshVaultUser(user);
      throw new Error(
        "Your authorizations changed. The prior vault is retained but locked.",
      );
    }
    unlocked!.vault.user = user;
    unlocked!.vault.validatedAt = Date.now();
    await cacheSchool(school, { workspace, revision });
    return;
  }
  const key = await keyFor(passphrase, salt);
  ensureCurrent(epoch);
  unlocked = {
    key,
    envelope: { id, salt: b64(salt), iv: "", ciphertext: new ArrayBuffer(0) },
    vault: {
      version: 1,
      user,
      validatedAt: Date.now(),
      schools: { [school]: { workspace, revision } },
      images: {},
    },
  };
  try {
    await write();
  } catch (e) {
    unlocked = undefined;
    throw e;
  }
}
export async function unlockVault(
  email: string,
  passphrase: string,
  verifiedUser?: AuthUser,
) {
  lockVault();
  const epoch = lifecycle;
  await writes.catch(() => {});
  const id = await accountId(email);
  const envelope = await transact<Envelope | undefined>("readonly", (s) =>
    s.get(id),
  );
  ensureCurrent(epoch);
  if (!envelope)
    throw new Error(
      "No encrypted offline workspace is saved for this account on this device.",
    );
  let vault: Vault;
  try {
    const key = await keyFor(passphrase, bytes(envelope.salt));
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: bytes(envelope.iv) as BufferSource },
      key,
      envelope.ciphertext,
    );
    ensureCurrent(epoch);
    vault = JSON.parse(new TextDecoder().decode(plain)) as Vault;
    if (
      vault.version !== 1 ||
      vault.user.email.toLowerCase() !== email.trim().toLowerCase() ||
      !Object.values(vault.schools).every((s) => isValidWorkspace(s.workspace))
    )
      throw new Error("Invalid vault.");
    if (verifiedUser && authorizationChanged(vault.user, verifiedUser))
      throw new Error("permissions");
    if (!verifiedUser && !validLifetime(vault.validatedAt))
      throw new Error("expired");
    if (verifiedUser) {
      vault.user = verifiedUser;
      vault.validatedAt = Date.now();
    }
    unlocked = { key, envelope, vault };
    if (verifiedUser) await write();
  } catch (e) {
    throw new Error(
      e instanceof Error && e.message === "permissions"
        ? "Your school assignments or permissions changed. The old encrypted cache is retained but cannot be reopened with broader access. Resolve queued work with your administrator before explicitly forgetting it."
        : e instanceof Error && e.message === "expired"
          ? "Offline authorization expired after 24 hours. Sign in online and unlock the existing vault to reverify it."
          : "The offline passphrase is incorrect, or the encrypted cache is damaged.",
    );
  }
  return vault.user;
}
export function cachedSchool(school: string) {
  if (!vaultEnabled()) return undefined;
  if (
    !unlocked!.vault.user.memberships.some(
      (m) => m.schoolId === school && m.role !== "student",
    )
  )
    return undefined;
  const data = unlocked!.vault.schools[school];
  return data ? structuredClone(data) : undefined;
}
export async function cacheSchool(school: string, data: CachedSchool) {
  if (!vaultEnabled())
    throw new Error(
      "Your offline authorization is locked or expired. Reverify online before caching private records.",
    );
  if (
    !unlocked!.vault.user.memberships.some(
      (m) => m.schoolId === school && m.role !== "student",
    )
  )
    throw new Error("This school is not authorized for a staff offline cache.");
  validateStaffCache(unlocked!.vault.user, school, data.workspace);
  unlocked!.vault.schools[school] = structuredClone(data);
  await write();
}
export async function refreshVaultUser(user: AuthUser) {
  const state = unlocked;
  if (!state || state.vault.user.id !== user.id) return false;
  if (authorizationChanged(state.vault.user, user)) {
    // Capture the revoked snapshot, lock immediately, and never lock a later account after an await.
    state.vault.validatedAt = 0;
    const persisted = write(state);
    lockVault();
    await persisted;
    return true;
  }
  state.vault.user = user;
  state.vault.validatedAt = Date.now();
  await write(state);
  return false;
}
export async function forgetVault(email: string) {
  await writes.catch(() => {});
  const id = await accountId(email);
  if (unlocked?.envelope.id === id) lockVault();
  await transact("readwrite", (s) => s.delete(id));
}
export async function saveOfflineImage(id: string, file: File) {
  const state = unlocked;
  if (!vaultEnabled())
    throw new Error(
      "Enable and unlock the encrypted offline vault to retain original images while disconnected.",
    );
  if (file.size > 15 * 1024 * 1024)
    throw new Error("Offline original images must be smaller than 15 MB.");
  const data = b64(new Uint8Array(await file.arrayBuffer()));
  if (unlocked !== state || !vaultEnabled())
    throw new Error(
      "The original account was locked before its image could be retained. No other account was modified.",
    );
  state!.vault.images[id] = { data, media: file.type };
  await write(state);
}
export function offlineImage(id: string) {
  const image = vaultEnabled() ? unlocked!.vault.images[id] : undefined;
  return image
    ? new Blob([bytes(image.data)], { type: image.media })
    : undefined;
}
export function cachedPortal<T>(school: string): T | undefined {
  if (!vaultEnabled()) return undefined;
  if (
    !unlocked!.vault.user.memberships.some(
      (m) => m.schoolId === school && m.role === "student",
    )
  )
    return undefined;
  const portal = unlocked!.vault.portals?.[school];
  return portal ? (structuredClone(portal) as T) : undefined;
}
export async function cachePortal(school: string, portal: unknown) {
  if (!vaultEnabled())
    throw new Error("Your private-result vault is locked or expired.");
  if (
    !unlocked!.vault.user.memberships.some(
      (m) => m.schoolId === school && m.role === "student",
    )
  )
    throw new Error("This account is not linked to a student in this school.");
  validatePersonalCache(unlocked!.vault.user, school, portal);
  unlocked!.vault.portals = {
    ...unlocked!.vault.portals,
    [school]: structuredClone(portal),
  };
  await write();
}
export async function enablePortalVault(
  user: AuthUser,
  school: string,
  portal: unknown,
  passphrase: string,
) {
  validatePersonalCache(user, school, portal);
  if (vaultEnabled(user.id)) {
    await refreshVaultUser(user);
    await cachePortal(school, portal);
    return;
  }
  if (passphrase.length < 12)
    throw new Error("Use an offline passphrase with at least 12 characters.");
  const epoch = ++lifecycle;
  const id = await accountId(user.email),
    salt = crypto.getRandomValues(new Uint8Array(16));
  const existing = await transact("readonly", (s) => s.get(id));
  ensureCurrent(epoch);
  if (existing)
    throw new Error(
      "An encrypted vault already exists. Unlock it first, or explicitly forget it before replacing it.",
    );
  const key = await keyFor(passphrase, salt);
  ensureCurrent(epoch);
  unlocked = {
    key,
    envelope: { id, salt: b64(salt), iv: "", ciphertext: new ArrayBuffer(0) },
    vault: {
      version: 1,
      user,
      validatedAt: Date.now(),
      schools: {},
      images: {},
      portals: { [school]: portal },
    },
  };
  try {
    await write();
  } catch (e) {
    unlocked = undefined;
    throw e;
  }
}
