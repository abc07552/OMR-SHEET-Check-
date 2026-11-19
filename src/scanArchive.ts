import type { Workspace } from "./data";
import { api } from "./session";
import { offlineImage, saveOfflineImage } from "./offline";

// Device-demo originals are deliberately separate from authenticated encrypted vaults.
function demoStore<T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>,
) {
  return new Promise<T>((resolve, reject) => {
    const request = indexedDB.open("omr-device-demo-originals", 1);
    request.onupgradeneeded = () =>
      request.result.createObjectStore("images", { keyPath: "id" });
    request.onerror = () =>
      reject(new Error("Original-image storage is unavailable."));
    request.onsuccess = () => {
      const db = request.result,
        tx = db.transaction("images", mode),
        operation = fn(tx.objectStore("images"));
      let value: T;
      operation.onsuccess = () => {
        value = operation.result;
      };
      tx.oncomplete = () => {
        db.close();
        resolve(value);
      };
      tx.onerror = tx.onabort = () => {
        db.close();
        reject(
          new Error(
            "The original image could not be retained. Free device storage before scanning.",
          ),
        );
      };
    };
  });
}
export async function uploadOriginal(
  school: string,
  exam: string,
  file: File,
  operationId: string,
) {
  const form = new FormData();
  form.append("file", file);
  form.append("operationId", operationId);
  return (
    await api<{ objectId: string }>(
      `/schools/${school}/exams/${exam}/objects`,
      { method: "POST", body: form },
    )
  ).objectId;
}
export async function retainOriginal(
  id: string,
  file: File,
  authenticated: boolean,
) {
  if (authenticated) await saveOfflineImage(id, file);
  else {
    const count = await demoStore<number>("readonly", (store) => store.count());
    if (count >= 200)
      throw new Error(
        "The device demo retains up to 200 original images. Use a connected server for larger archives; existing evidence has not been deleted.",
      );
    await demoStore("readwrite", (store) =>
      store.put({ id, file, createdAt: Date.now() }),
    );
  }
}
export async function localOriginal(
  id: string,
  authenticated: boolean,
): Promise<Blob | undefined> {
  if (authenticated) return offlineImage(id);
  return (
    await demoStore<{ file: File } | undefined>("readonly", (store) =>
      store.get(id),
    )
  )?.file;
}
export async function materializeOriginals(workspace: Workspace) {
  const w = structuredClone(workspace),
    mapped = new Map<string, string>();
  for (const result of w.results) {
    for (const id of result.scanIds || []) {
      if (!id.startsWith("local-")) continue;
      if (!mapped.has(id)) {
        const image = offlineImage(id);
        if (!image)
          throw new Error(
            "An offline original is locked or missing. Unlock the original account vault before synchronizing.",
          );
        mapped.set(
          id,
          await uploadOriginal(
            w.activeSchoolId!,
            result.examId,
            new File([image], "offline-original", { type: image.type }),
            `upload-${id}`,
          ),
        );
      }
    }
    result.scanIds = result.scanIds?.map((id) => mapped.get(id) || id);
    result.sourceTransforms = result.sourceTransforms?.map((t) => ({
      ...t,
      objectId: mapped.get(t.objectId) || t.objectId,
    }));
  }
  return { workspace: w, changed: mapped.size > 0 };
}
