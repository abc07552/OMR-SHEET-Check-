import {
  mkdirSync,
  copyFileSync,
  existsSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { resolve } from "node:path";
const dest = resolve("public/vendor/ocr");
mkdirSync(dest, { recursive: true });
const files = [
  ["tesseract.js/dist/worker.min.js", "worker.min.js"],
  [
    "tesseract.js-core/tesseract-core-lstm.wasm.js",
    "tesseract-core-lstm.wasm.js",
  ],
  [
    "@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz",
    "eng.traineddata.gz",
  ],
];
for (const [src, name] of files) {
  const from = resolve("node_modules", src);
  if (!existsSync(from))
    throw new Error(`Missing OCR dependency: ${src}. Run npm install first.`);
  copyFileSync(from, resolve(dest, name));
}
const notices = [
  ["Capacitor core · MIT", "@capacitor/core/LICENSE"],
  ["Capacitor Android · MIT", "@capacitor/android/LICENSE"],
  ["OpenCV.js / TechStark · Apache-2.0", "@techstark/opencv-js/LICENSE"],
  ["Tesseract.js · Apache-2.0", "tesseract.js/LICENSE.md"],
  ["Tesseract.js core · Apache-2.0", "tesseract.js-core/LICENSE"],
  ["PDF.js · Apache-2.0", "pdfjs-dist/LICENSE"],
  ["jsQR · Apache-2.0", "jsqr/LICENSE"],
]
  .map(
    ([name, path]) =>
      `${name}\n\n${readFileSync(resolve("node_modules", path), "utf8")}`,
  )
  .join("\n\n==========================\n\n");
writeFileSync(resolve("public/vendor/LICENSES.txt"), notices);
console.log(
  "Prepared local OCR worker, WebAssembly core, English digit-recognition model, and license notices.",
);
