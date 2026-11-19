# Third-party components

Markly depends on the packages recorded in `package-lock.json`. Their respective licenses and copyright notices apply; this is a summary, not a replacement for them.

| Component                            | Purpose                                    | License                                                        |
| ------------------------------------ | ------------------------------------------ | -------------------------------------------------------------- |
| React, React DOM                     | Interface                                  | MIT                                                            |
| Capacitor core / Android / CLI       | Native Android shell and build bridge      | MIT                                                            |
| Vite, Vitest, TypeScript             | Build/test tooling                         | MIT / Apache-2.0 (TypeScript)                                  |
| Lucide                               | Interface icons                            | ISC                                                            |
| Recharts / D3                        | Charts                                     | MIT / ISC (individual D3 modules)                              |
| OpenCV.js via `@techstark/opencv-js` | Perspective alignment and image processing | Apache-2.0                                                     |
| Tesseract.js / Tesseract.js core     | Local numeric OCR                          | Apache-2.0                                                     |
| `@tesseract.js-data/eng`             | English recognition-model packaging        | MIT package; upstream Tesseract trained data licensing applies |
| PDF.js (`pdfjs-dist`)                | PDF page rendering                         | Apache-2.0                                                     |
| jsQR                                 | QR identification                          | Apache-2.0                                                     |
| `qrcode`                             | Printable QR codes                         | MIT                                                            |
| ExcelJS                              | XLSX import/export                         | MIT                                                            |
| jsPDF / jsPDF-AutoTable              | PDF reports and OMR templates              | MIT                                                            |
| Express                              | HTTP API                                   | MIT                                                            |
| Helmet                               | Security headers                           | MIT                                                            |
| Zod                                  | Server validation                          | MIT                                                            |
| DM Sans via Fontsource               | UI typography                              | SIL Open Font License 1.1                                      |
| Noto Sans                            | Embedded PDF typography                    | SIL Open Font License 1.1                                      |

The asset-preparation script copies the available Capacitor/OpenCV/Tesseract/PDF.js/jsQR license notices into `public/vendor/LICENSES.txt`, which is shipped with the built site. Noto Sans is accompanied by `public/fonts/OFL.txt`. See the packages' own `LICENSE` files for the remaining notices and transitive components.

The English model is sourced from `@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz`; OCR assets are served locally, not fetched from a public CDN at runtime. OpenCV.js is shipped as an on-demand local asset. No remote recognition service receives uploaded answer sheets.
