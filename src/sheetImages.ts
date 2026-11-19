import { isEmbeddedRaster, MAX_LOGO_LENGTH } from "./layout";

// Only raster data generated from a local upload reaches a sheet. No external
// fetch, SVG script, or cross-origin canvas taint is needed for logos.
const cache = new Map<string, Promise<HTMLImageElement>>();
export function loadSheetImage(source: string): Promise<HTMLImageElement> {
  if (!isEmbeddedRaster(source))
    return Promise.reject(
      new Error("The sheet logo is not a valid embedded raster image."),
    );
  const found = cache.get(source);
  if (found) return found;
  const pending = new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => {
      cache.delete(source);
      reject(
        new Error(
          "A sheet logo could not be opened. Replace it in Layout studio.",
        ),
      );
    };
    image.src = source;
  });
  if (cache.size >= 16) cache.delete(cache.keys().next().value!);
  cache.set(source, pending);
  return pending;
}

export async function normaliseLogo(file: File): Promise<string> {
  if (
    !["image/png", "image/jpeg", "image/webp"].includes(file.type) ||
    file.size > 5 * 1024 * 1024
  )
    throw new Error("Choose a PNG, JPEG or WebP logo smaller than 5 MB.");
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, 512 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    canvas
      .getContext("2d")!
      .drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    let source = canvas.toDataURL("image/png");
    if (source.length > MAX_LOGO_LENGTH)
      source = canvas.toDataURL("image/webp", 0.8);
    if (!isEmbeddedRaster(source))
      throw new Error(
        "This logo is too detailed. Try a smaller, simpler image.",
      );
    // Decode before accepting the upload, and prime the printable-sheet cache.
    await loadSheetImage(source);
    return source;
  } finally {
    bitmap.close();
  }
}
