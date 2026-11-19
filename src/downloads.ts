import { isAndroid, saveAndroidFile } from "./native";

/** Browser download, or a real Android Storage Access Framework Save As dialog. */
export async function downloadFile(
  name: string,
  data: string | Blob,
  type = "text/csv;charset=utf-8",
): Promise<void> {
  const blob = typeof data === "string" ? new Blob([data], { type }) : data;
  if (isAndroid()) {
    await saveAndroidFile(name, blob);
    return;
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  try {
    a.click();
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
