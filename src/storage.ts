import type { Workspace } from "./data";
import { isValidWorkspace, enrichWorkspace } from "./data";

export interface Snapshot {
  id: string;
  schoolId: string;
  name: string;
  createdAt: string;
  students: number;
  results: number;
  bytes: number;
  automatic: boolean;
  workspace: Workspace;
}
function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open("markly-backups-v2", 1);
    req.onupgradeneeded = () =>
      req.result.createObjectStore("snapshots", { keyPath: "id" });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () =>
      reject(
        new Error(
          "Device backup storage is unavailable. Please export a backup file.",
        ),
      );
  });
}
async function store<T>(
  mode: IDBTransactionMode,
  fn: (s: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("snapshots", mode),
      req = fn(tx.objectStore("snapshots"));
    let result: T;
    req.onsuccess = () => {
      result = req.result;
    };
    tx.oncomplete = () => {
      db.close();
      resolve(result);
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error || new Error("Backup storage failed."));
    };
    tx.onabort = () => {
      db.close();
      reject(tx.error || new Error("Backup storage was interrupted."));
    };
  });
}
export async function listSnapshots(schoolId?: string): Promise<Snapshot[]> {
  const all = await store("readonly", (s) => s.getAll());
  return (all as Snapshot[])
    .filter((s) => !schoolId || s.schoolId === schoolId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
export async function saveSnapshot(
  workspace: Workspace,
  name = "Automatic recovery point",
  automatic = true,
) {
  const existing = await listSnapshots(workspace.activeSchoolId);
  // Never overwrite the only good copy with invalid data.
  if (!isValidWorkspace(workspace))
    throw new Error("The workspace is invalid and could not be backed up.");
  const snapshot: Snapshot = {
    id: crypto.randomUUID(),
    schoolId: workspace.activeSchoolId || "school-greenwood",
    name,
    createdAt: new Date().toISOString(),
    students: workspace.students?.length || 0,
    results: workspace.results.length,
    bytes: new Blob([JSON.stringify(workspace)]).size,
    automatic,
    workspace: structuredClone(workspace),
  };
  await store("readwrite", (s) => s.put(snapshot));
  const old = existing.filter((s) => s.automatic).slice(9);
  for (const s of old) await deleteSnapshot(s.id);
  return snapshot;
}
export async function deleteSnapshot(id: string) {
  await store("readwrite", (s) => s.delete(id));
}
const b64 = (bytes: Uint8Array) => {
  let str = "";
  for (let i = 0; i < bytes.length; i += 8192)
    str += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(str);
};
const unb64 = (str: string) =>
  Uint8Array.from(atob(str), (c) => c.charCodeAt(0));
async function deriveKey(
  password: string,
  salt: Uint8Array,
  usage: KeyUsage[],
) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
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
    key,
    { name: "AES-GCM", length: 256 },
    false,
    usage,
  );
}
export async function encodeBackup(workspace: Workspace, password?: string) {
  const payload = JSON.stringify(workspace);
  if (!password) return new Blob([payload], { type: "application/json" });
  if (password.length < 10)
    throw new Error("Use a backup passphrase with at least 10 characters.");
  const salt = crypto.getRandomValues(new Uint8Array(16)),
    iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(password, salt, ["encrypt"]);
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(payload),
  );
  return new Blob(
    [
      JSON.stringify({
        format: "markly-encrypted",
        version: 1,
        salt: b64(salt),
        iv: b64(iv),
        ciphertext: b64(new Uint8Array(encrypted)),
      }),
    ],
    { type: "application/json" },
  );
}
export async function decodeBackup(
  file: File,
  password?: string,
): Promise<Workspace> {
  if (file.size > 35 * 1024 * 1024)
    throw new Error("Use a backup smaller than 35 MB.");
  let data: unknown;
  try {
    data = JSON.parse(await file.text());
  } catch {
    throw new Error("This is not a valid backup file.");
  }
  if (
    data &&
    typeof data === "object" &&
    "format" in data &&
    data.format === "markly-encrypted"
  ) {
    if (!password)
      throw new Error("Enter the passphrase used to encrypt this backup.");
    try {
      const d = data as unknown as {
        salt: string;
        iv: string;
        ciphertext: string;
      };
      if (
        typeof d.salt !== "string" ||
        typeof d.iv !== "string" ||
        typeof d.ciphertext !== "string"
      )
        throw new Error("invalid");
      const key = await deriveKey(password, unb64(d.salt), ["decrypt"]);
      const plain = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: unb64(d.iv) },
        key,
        unb64(d.ciphertext),
      );
      data = JSON.parse(new TextDecoder().decode(plain));
    } catch {
      throw new Error(
        "The passphrase is incorrect, or the backup has been damaged.",
      );
    }
  }
  if (!isValidWorkspace(data))
    throw new Error("This file does not contain a valid Markly workspace.");
  return enrichWorkspace(data);
}
