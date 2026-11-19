import cvURL from "@techstark/opencv-js/dist/opencv.js?url";
import jsQR from "jsqr";
import type { AnswerDetection, Exam, Option } from "./data";
import { getOptions } from "./data";
import { getLayout, pageCount, sheetSignature, WIDTH, HEIGHT } from "./layout";
import type { Point } from "./layout";
import { outlineReadability } from "./omrQuality";
import { analyzeAlignedImageData, analyzeImageEvidence, MARKERS } from "./omr";
import {
  identity3,
  inverse3,
  multiply3,
  project3,
  rotation3,
} from "./geometry";
import type { Matrix3 } from "./geometry";

type CV = any;
let cvReady: Promise<{ cv: CV }> | undefined;
export function loadOpenCV(): Promise<{ cv: CV }> {
  return (cvReady ||= new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cvReady = undefined;
      reject(
        new Error(
          "The OpenCV engine timed out. Check your connection and try again.",
        ),
      );
    }, 90000);
    const script = document.createElement("script");
    script.src = cvURL;
    script.async = true;
    script.onerror = () => {
      clearTimeout(timeout);
      cvReady = undefined;
      reject(
        new Error(
          "OpenCV could not be loaded. Try the lightweight engine or check your connection.",
        ),
      );
    };
    script.onload = async () => {
      try {
        let cv = (window as unknown as { cv: CV }).cv;
        if (!cv)
          throw new Error(
            "OpenCV could not start. Check that your host permits the local OpenCV script and its WebAssembly runtime.",
          );
        if (cv instanceof Promise) cv = await cv;
        else if (!cv?.calledRun)
          await new Promise<void>((r) => {
            cv.onRuntimeInitialized = r;
          });
        clearTimeout(timeout);
        if (!cv?.Mat) throw new Error("OpenCV did not initialise.");
        resolve({ cv });
      } catch (e) {
        clearTimeout(timeout);
        cvReady = undefined;
        reject(e);
      }
    };
    document.head.appendChild(script);
  }));
}
function orderQuad(points: Point[]): Point[] {
  const byY = [...points].sort((a, b) => a.y - b.y),
    top = byY.slice(0, 2).sort((a, b) => a.x - b.x),
    bottom = byY.slice(2).sort((a, b) => a.x - b.x);
  return [top[0], top[1], bottom[1], bottom[0]];
}
function cvMarkers(cv: CV, src: CV, reference: Point[]): Point[] {
  const gray = new cv.Mat(),
    binary = new cv.Mat(),
    contours = new cv.MatVector(),
    hierarchy = new cv.Mat();
  try {
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
    cv.adaptiveThreshold(
      gray,
      binary,
      255,
      cv.ADAPTIVE_THRESH_GAUSSIAN_C,
      cv.THRESH_BINARY_INV,
      61,
      12,
    );
    cv.findContours(
      binary,
      contours,
      hierarchy,
      cv.RETR_EXTERNAL,
      cv.CHAIN_APPROX_SIMPLE,
    );
    const candidates: { point: Point; area: number }[] = [];
    for (let i = 0; i < contours.size(); i++) {
      const c = contours.get(i);
      try {
        const r = cv.boundingRect(c),
          area = cv.contourArea(c);
        if (
          area > 30 &&
          r.width / r.height > 0.6 &&
          r.width / r.height < 1.65 &&
          area / (r.width * r.height) > 0.68
        )
          candidates.push({
            point: { x: r.x + r.width / 2, y: r.y + r.height / 2 },
            area,
          });
      } finally {
        c.delete();
      }
    }
    const expectedArea = (34 * 34 * src.cols * src.rows) / (WIDTH * HEIGHT);
    return [
      [0, 0],
      [0.76, 0],
      [0.76, 0.76],
      [0, 0.76],
    ].map(([rx, ry], i) => {
      const score = (candidate: { point: Point; area: number }) =>
        Math.abs(Math.log(candidate.area / expectedArea)) +
        5 *
          Math.hypot(
            candidate.point.x / src.cols - reference[i].x / WIDTH,
            candidate.point.y / src.rows - reference[i].y / HEIGHT,
          );
      const found = candidates
        .filter(
          (c) =>
            c.area < expectedArea * 4 &&
            c.point.x >= rx * src.cols &&
            c.point.x <= (rx + 0.24) * src.cols &&
            c.point.y >= ry * src.rows &&
            c.point.y <= (ry + 0.24) * src.rows,
        )
        .sort((a, b) => score(a) - score(b))[0];
      if (!found)
        throw new Error(
          "Registration squares not found. Include all four corners or calibrate this layout.",
        );
      return found.point;
    });
  } finally {
    gray.delete();
    binary.delete();
    contours.delete();
    hierarchy.delete();
  }
}
/** The live-camera guide uses the same four-corner detector as final reads. */
export async function cameraRegistration(
  canvas: HTMLCanvasElement,
  exam: Exam,
): Promise<Point[] | null> {
  const { cv } = await loadOpenCV();
  const src = cv.imread(canvas);
  try {
    return cvMarkers(cv, src, exam.layout?.anchors || MARKERS).map((p) => ({
      x: p.x / src.cols,
      y: p.y / src.rows,
    }));
  } catch {
    return null;
  } finally {
    src.delete();
  }
}
function pageQuad(cv: CV, src: CV): Point[] {
  const gray = new cv.Mat(),
    blur = new cv.Mat(),
    edges = new cv.Mat(),
    contours = new cv.MatVector(),
    hierarchy = new cv.Mat();
  try {
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
    cv.GaussianBlur(gray, blur, new cv.Size(5, 5), 0);
    cv.Canny(blur, edges, 45, 150);
    cv.findContours(
      edges,
      contours,
      hierarchy,
      cv.RETR_EXTERNAL,
      cv.CHAIN_APPROX_SIMPLE,
    );
    let best: Point[] | null = null,
      largest = src.rows * src.cols * 0.2;
    for (let i = 0; i < contours.size(); i++) {
      const c = contours.get(i),
        approx = new cv.Mat();
      try {
        cv.approxPolyDP(c, approx, 0.025 * cv.arcLength(c, true), true);
        const area = cv.contourArea(approx);
        if (approx.rows === 4 && area > largest) {
          largest = area;
          best = Array.from({ length: 4 }, (_, j) => ({
            x: approx.data32S[j * 2],
            y: approx.data32S[j * 2 + 1],
          }));
        }
      } finally {
        c.delete();
        approx.delete();
      }
    }
    return best
      ? orderQuad(best)
      : [
          { x: 0, y: 0 },
          { x: src.cols - 1, y: 0 },
          { x: src.cols - 1, y: src.rows - 1 },
          { x: 0, y: src.rows - 1 },
        ];
  } finally {
    gray.delete();
    blur.delete();
    edges.delete();
    contours.delete();
    hierarchy.delete();
  }
}
function alignOne(cv: CV, canvas: HTMLCanvasElement, exam: Exam) {
  const src = cv.imread(canvas),
    dest = new cv.Mat(),
    layout = getLayout(exam);
  let source: Point[];
  try {
    const reference =
      layout.anchorMode === "page"
        ? [
            { x: 0, y: 0 },
            { x: WIDTH - 1, y: 0 },
            { x: WIDTH - 1, y: HEIGHT - 1 },
            { x: 0, y: HEIGHT - 1 },
          ]
        : exam.layout?.anchors || MARKERS;
    source =
      layout.anchorMode === "page"
        ? pageQuad(cv, src)
        : cvMarkers(cv, src, reference);
    const from = cv.matFromArray(
        4,
        1,
        cv.CV_32FC2,
        source.flatMap((p) => [p.x, p.y]),
      ),
      to = cv.matFromArray(
        4,
        1,
        cv.CV_32FC2,
        reference.flatMap((p) => [p.x, p.y]),
      );
    let matrix: CV;
    try {
      matrix = cv.getPerspectiveTransform(from, to);
    } finally {
      from.delete();
      to.delete();
    }
    try {
      cv.warpPerspective(
        src,
        dest,
        matrix,
        new cv.Size(WIDTH, HEIGHT),
        cv.INTER_LINEAR,
        cv.BORDER_CONSTANT,
        new cv.Scalar(255, 255, 255, 255),
      );
      const output = document.createElement("canvas");
      output.width = WIDTH;
      output.height = HEIGHT;
      cv.imshow(output, dest);
      const values = Array.from(matrix.data64F as Float64Array);
      return {
        canvas: output,
        matrix: [values.slice(0, 3), values.slice(3, 6), values.slice(6, 9)],
      };
    } finally {
      matrix.delete();
    }
  } finally {
    src.delete();
    dest.delete();
  }
}
function registrationQuality(canvas: HTMLCanvasElement, exam: Exam) {
  const data = canvas
    .getContext("2d", { willReadFrequently: true })!
    .getImageData(0, 0, WIDTH, HEIGHT);
  const readability = outlineReadability(data, exam);
  let score = readability;
  // QR placement disambiguates symmetric 180-degree registration without reading the key.
  const qr = jsQR(data.data, WIDTH, HEIGHT, {
    inversionAttempts: "dontInvert",
  });
  if (qr) {
    try {
      const meta = JSON.parse(qr.data);
      if (meta.m === 2) {
        const f = getLayout(exam).fields.find(
            (v) => v.visible && v.type === "qr",
          ),
          expected = f
            ? { x: f.x + f.width / 2, y: f.y + f.height / 2 }
            : { x: 1100, y: 262 };
        const center = {
          x:
            (qr.location.topLeftCorner.x + qr.location.bottomRightCorner.x) / 2,
          y:
            (qr.location.topLeftCorner.y + qr.location.bottomRightCorner.y) / 2,
        };
        score +=
          180 *
          Math.max(
            0,
            1 - Math.hypot(center.x - expected.x, center.y - expected.y) / 450,
          );
      }
    } catch {
      /* Arbitrary barcodes do not provide a Markly orientation hint. */
    }
  }
  return { score, readability };
}
function align(cv: CV, canvas: HTMLCanvasElement, exam: Exam) {
  const candidates =
    canvas.width / canvas.height > 1.2
      ? [1, 3]
      : canvas.width / canvas.height < 0.82
        ? [0, 2]
        : [0, 1, 2, 3];
  let best:
    | {
        canvas: HTMLCanvasElement;
        matrix: Matrix3;
        quality: number;
        readability: number;
      }
    | undefined;
  let failure: unknown;
  for (const k of candidates) {
    const rotated = document.createElement("canvas");
    rotated.width = k % 2 ? canvas.height : canvas.width;
    rotated.height = k % 2 ? canvas.width : canvas.height;
    const ctx = rotated.getContext("2d")!;
    ctx.translate(rotated.width / 2, rotated.height / 2);
    ctx.rotate((-k * Math.PI) / 2);
    ctx.drawImage(canvas, -canvas.width / 2, -canvas.height / 2);
    try {
      const registered = alignOne(cv, rotated, exam),
        quality = registrationQuality(registered.canvas, exam);
      const matrix = multiply3(
        registered.matrix,
        rotation3(k, canvas.width + 1, canvas.height + 1),
      );
      if (!best || quality.score > best.quality) {
        if (best) best.canvas.width = 0;
        best = {
          canvas: registered.canvas,
          matrix,
          quality: quality.score,
          readability: quality.readability,
        };
      } else registered.canvas.width = 0;
    } catch (e) {
      failure = e;
    }
    rotated.width = 0;
  }
  if (!best)
    throw failure || new Error("No reliable sheet registration was found.");
  // A sharp QR can guide orientation, but cannot rescue an unreadable bubble grid.
  if (best.readability < 9) {
    best.canvas.width = 0;
    throw new Error(
      "The printed bubble grid does not match this template, or the image is too blurred. Retake the image or calibrate its layout.",
    );
  }
  return best;
}
let ocrWorker: Promise<import("tesseract.js").Worker> | undefined;
export async function readRollNumber(
  canvas: HTMLCanvasElement,
  exam: Exam,
  onStage?: (s: string) => void,
) {
  const { createWorker, OEM, PSM } = await import("tesseract.js");
  if (!ocrWorker) {
    onStage?.("Loading local OCR model…");
    const base = new URL(
      `${import.meta.env.BASE_URL}vendor/ocr/`,
      location.origin,
    ).href;
    ocrWorker = createWorker("eng", OEM.LSTM_ONLY, {
      workerPath: `${base}worker.min.js`,
      corePath: `${base}tesseract-core-lstm.wasm.js`,
      langPath: base,
      gzip: true,
      workerBlobURL: false,
      cacheMethod: "write",
    }).catch((e) => {
      ocrWorker = undefined;
      throw e;
    });
  }
  const worker = await ocrWorker;
  const measure = document.createElement("canvas").getContext("2d")!;
  measure.font = "19px sans-serif";
  const legacyLeft = 760 + measure.measureText("Roll number:  ").width - 2;
  const r =
      !exam.layout && (exam.optionCount || 4) === 4 && exam.questions <= 100
        ? { x: legacyLeft, y: 268, width: 1155 - legacyLeft, height: 39 }
        : getLayout(exam).rollRegion,
    crop = document.createElement("canvas");
  crop.width = Math.round(r.width * 3);
  crop.height = Math.round(r.height * 3);
  const ctx = crop.getContext("2d")!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, crop.width, crop.height);
  ctx.drawImage(
    canvas,
    r.x,
    r.y,
    r.width,
    r.height,
    0,
    0,
    crop.width,
    crop.height,
  );
  await worker.setParameters({
    tessedit_char_whitelist: "0123456789",
    tessedit_pageseg_mode: PSM.SINGLE_LINE,
  });
  onStage?.("Recognising roll number…");
  const output = await worker.recognize(crop);
  return {
    roll: output.data.text.replace(/\D/g, ""),
    confidence: output.data.confidence,
  };
}
export interface ScannedPage {
  answers: (Option | null)[];
  flagged: number[];
  pageIndex: number;
  roll: string;
  rollConfidence: number;
  confidence: number;
  engine: "opencv" | "canvas" | "opencv-python";
  preview: string;
  qrMatched: boolean;
  answerMeta?: AnswerDetection[];
  detectedOptions?: Option[][];
  objectId?: string;
  questionSet?: string;
  sourceToAligned?: Matrix3;
  sourceWidth?: number;
  sourceHeight?: number;
  warnings?: string[];
}
export async function scanPageFile(
  file: File,
  exam: Exam,
  settings: {
    pageIndex?: number;
    ocr?: boolean;
    engine?: "opencv" | "canvas";
    onStage?: (s: string) => void;
  } = {},
): Promise<ScannedPage> {
  if (file.size > 50 * 1024 * 1024)
    throw new Error("Images must be smaller than 50 MB.");
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error(
      "This file is not a readable image. Use PNG, JPEG or WebP.",
    );
  }
  const sourceWidth = bitmap.width,
    sourceHeight = bitmap.height;
  const canvas = document.createElement("canvas"),
    scale = Math.min(1, 2200 / Math.max(bitmap.width, bitmap.height));
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const context = canvas.getContext("2d", { willReadFrequently: true })!;
  context.fillStyle = "#fff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  let sourceToAligned = identity3();
  let aligned = canvas,
    engine: "opencv" | "canvas" = settings.engine || "opencv";
  if (engine === "opencv") {
    settings.onStage?.("Aligning sheet with OpenCV…");
    const { cv } = await loadOpenCV();
    const registered = align(cv, canvas, exam);
    aligned = registered.canvas;
    sourceToAligned = multiply3(registered.matrix, [
      [scale, 0, 0],
      [0, scale, 0],
      [0, 0, 1],
    ]);
  } else if (exam.layout?.anchorMode === "page")
    throw new Error("Paper-edge calibration requires the OpenCV engine.");
  const ctx = aligned.getContext("2d", { willReadFrequently: true })!,
    image = ctx.getImageData(0, 0, aligned.width, aligned.height);
  let pageIndex = settings.pageIndex || 0,
    roll = "",
    rollConfidence = 0,
    qrMatched = false,
    questionSet = "A";
  // Decode the whole aligned page: supports moved QR fields and calibrated templates.
  const qr = jsQR(image.data, image.width, image.height, {
    inversionAttempts: "dontInvert",
  });
  if (qr) {
    try {
      const meta = JSON.parse(qr.data);
      if (meta.m === 2) {
        if (meta.e !== exam.id)
          throw new Error(
            "This sheet belongs to another assessment. Choose its matching answer key.",
          );
        if (meta.q !== exam.questions || meta.o !== getOptions(exam).length)
          throw new Error(
            "This sheet was printed with a different question or option count.",
          );
        if (
          meta.n !== pageCount(exam) ||
          (meta.l !== undefined && meta.l !== sheetSignature(exam))
        )
          throw new Error(
            "This sheet uses a different saved layout. Restore its matching layout or print a new template before scanning.",
          );
        if (
          !Number.isInteger(meta.p) ||
          meta.p < 0 ||
          meta.p >= pageCount(exam)
        )
          throw new Error("Invalid page number in the sheet identifier.");
        pageIndex = meta.p;
        roll = typeof meta.r === "string" ? meta.r : "";
        questionSet = typeof meta.s === "string" ? meta.s : "A";
        rollConfidence = roll ? 100 : 0;
        qrMatched = true;
      }
    } catch (e) {
      if (e instanceof SyntaxError) {
        /* QR may belong to a non-Markly legacy template. */
      } else throw e;
    }
  }
  if (pageIndex >= pageCount(exam))
    throw new Error("Choose a valid page number for this assessment.");
  settings.onStage?.("Reading bubble marks…");
  let result: {
    answers: (Option | null)[];
    flagged: number[];
    confidence?: number;
    answerMeta?: AnswerDetection[];
    detectedOptions?: Option[][];
  };
  if (engine === "opencv")
    result = analyzeAlignedImageData(image, exam, pageIndex);
  else result = analyzeImageEvidence(image, exam, pageIndex);
  if (settings.ocr && !roll) {
    try {
      const found = await readRollNumber(aligned, exam, settings.onStage);
      roll = found.roll;
      rollConfidence = found.confidence;
    } catch (e) {
      settings.onStage?.(
        `OCR unavailable: ${e instanceof Error ? e.message : "enter roll manually"}`,
      );
    }
  }
  if (engine === "opencv" && result.answerMeta) {
    const inverse = inverse3(sourceToAligned);
    result.answerMeta = result.answerMeta.map((m) => ({
      ...m,
      coordinates: m.coordinates.map((p) => ({
        ...p,
        ...project3(inverse, p.alignedX!, p.alignedY!),
      })),
    }));
  }
  const thumb = document.createElement("canvas");
  thumb.width = 350;
  thumb.height = Math.round((aligned.height / aligned.width) * 350);
  thumb.getContext("2d")!.drawImage(aligned, 0, 0, thumb.width, thumb.height);
  return {
    ...result,
    confidence: result.confidence ?? (result.flagged.length ? 75 : 100),
    pageIndex,
    roll,
    rollConfidence,
    engine,
    preview: thumb.toDataURL("image/jpeg", 0.6),
    qrMatched,
    questionSet,
    sourceToAligned,
    sourceWidth,
    sourceHeight,
  };
}
export async function* pdfImages(
  file: File,
  onProgress?: (s: string) => void,
): AsyncGenerator<{ file: File; page: number; total: number }> {
  if (file.size > 50 * 1024 * 1024)
    throw new Error("PDF files must be smaller than 50 MB.");
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/build/pdf.worker.min.mjs",
    import.meta.url,
  ).href;
  const task = pdfjs.getDocument({
    data: new Uint8Array(await file.arrayBuffer()),
    maxImageSize: 25_000_000,
  });
  const doc = await task.promise;
  try {
    if (doc.numPages > 200)
      throw new Error(
        "Process up to 200 PDF pages per batch. Split a larger PDF first.",
      );
    for (let p = 1; p <= doc.numPages; p++) {
      onProgress?.(`Rendering PDF page ${p} of ${doc.numPages}…`);
      const page = await doc.getPage(p),
        base = page.getViewport({ scale: 1 }),
        viewport = page.getViewport({
          scale: Math.min(2.5, 1900 / Math.max(base.width, base.height)),
        }),
        canvas = document.createElement("canvas");
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      await page.render({ canvas, viewport }).promise;
      const blob = await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob(
          (b) =>
            b ? resolve(b) : reject(new Error("Could not render a PDF page.")),
          "image/png",
        ),
      );
      yield {
        file: new File(
          [blob],
          `${file.name.replace(/\.pdf$/i, "")}-page-${p}.png`,
          { type: "image/png" },
        ),
        page: p - 1,
        total: doc.numPages,
      };
      page.cleanup();
      canvas.width = canvas.height = 0;
    }
  } finally {
    await task.destroy();
  }
}
