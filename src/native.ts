import { Capacitor, registerPlugin } from "@capacitor/core";

export const MAX_ANDROID_EXPORT_BYTES = 32 * 1024 * 1024;
export const isAndroid = () => Capacitor.getPlatform() === "android";
export const isBundledAndroid = () =>
  isAndroid() && location.origin === "https://localhost";

interface DocumentExportPlugin {
  save(options: {
    filename: string;
    mimeType: string;
    base64: string;
  }): Promise<void>;
  print(): Promise<void>;
}
const DocumentExport = registerPlugin<DocumentExportPlugin>("DocumentExport");

function base64Data(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () =>
      reject(new Error("The export could not be read. Try again."));
    reader.onabort = () => reject(new Error("Export cancelled."));
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== "string" || !result.includes(";base64,")) {
        reject(new Error("The export could not be encoded."));
        return;
      }
      resolve(result.slice(result.indexOf(",") + 1));
    };
    reader.readAsDataURL(blob);
  });
}

/** Resolves only after Android's Save As destination has been written. */
export async function saveAndroidFile(name: string, blob: Blob) {
  if (blob.size > MAX_ANDROID_EXPORT_BYTES)
    throw new Error(
      "This file exceeds the 32 MiB Android export limit. Export it using the web app instead.",
    );
  const filename = name.replace(/[/\\\u0000-\u001f\u007f]/g, "_").slice(0, 160);
  if (!filename.trim() || filename === "." || filename === "..")
    throw new Error("Choose a valid export filename.");
  const extension = filename.split(".").at(-1)?.toLowerCase();
  const mimeTypes: Record<string, string> = {
    pdf: "application/pdf",
    csv: "text/csv",
    json: "application/json",
    png: "image/png",
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  };
  await DocumentExport.save({
    filename,
    mimeType:
      mimeTypes[extension || ""] ||
      blob.type.split(";")[0] ||
      "application/octet-stream",
    base64: await base64Data(blob),
  });
}

export async function printDocument() {
  if (isAndroid()) await DocumentExport.print();
  else window.print();
}
