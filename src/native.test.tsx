// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { downloadFile } from "./downloads";
import {
  isBundledAndroid,
  MAX_ANDROID_EXPORT_BYTES,
  printDocument,
} from "./native";

const native = vi.hoisted(() => ({
  platform: vi.fn(() => "web"),
  save: vi.fn<(...args: unknown[]) => Promise<void>>(),
  print: vi.fn<() => Promise<void>>(),
}));
vi.mock("@capacitor/core", () => ({
  Capacitor: { getPlatform: native.platform },
  registerPlugin: () => ({ save: native.save, print: native.print }),
}));

const OriginalURL = URL;
let click: ReturnType<typeof vi.spyOn>;
const createObjectURL = vi.fn<(blob: Blob) => string>(() => "blob:test-report");
const revokeObjectURL = vi.fn();
beforeEach(() => {
  vi.clearAllMocks();
  native.platform.mockReturnValue("web");
  native.save.mockResolvedValue(undefined);
  native.print.mockResolvedValue(undefined);
  vi.stubGlobal(
    "URL",
    class extends OriginalURL {
      static createObjectURL = createObjectURL;
      static revokeObjectURL = revokeObjectURL;
    },
  );
  click = vi
    .spyOn(HTMLAnchorElement.prototype, "click")
    .mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("browser and real Android export dispatch", () => {
  it("preserves browser downloads and revokes the temporary URL", async () => {
    vi.useFakeTimers();
    await downloadFile("results.csv", "roll,score\n12,8");
    expect(native.save).not.toHaveBeenCalled();
    expect(click).toHaveBeenCalledOnce();
    const anchor = click.mock.instances[0] as HTMLAnchorElement;
    expect(anchor.download).toBe("results.csv");
    expect(anchor.href).toBe("blob:test-report");
    expect(createObjectURL.mock.calls[0]?.[0]).toMatchObject({
      type: "text/csv;charset=utf-8",
    });
    expect(revokeObjectURL).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1000);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:test-report");
  });

  it("cleans up a browser object URL even when starting the download fails", async () => {
    vi.useFakeTimers();
    click.mockImplementationOnce(() => {
      throw new Error("Download blocked");
    });
    await expect(downloadFile("results.csv", "test")).rejects.toThrow(
      "Download blocked",
    );
    vi.advanceTimersByTime(1000);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:test-report");
  });

  it("sends exact binary contents and a concrete MIME type to Android Save As", async () => {
    native.platform.mockReturnValue("android");
    const bytes = new Uint8Array([0, 255, 120, 10, 13]);
    await downloadFile("report.pdf", new Blob([bytes]));
    expect(native.save).toHaveBeenCalledWith({
      filename: "report.pdf",
      mimeType: "application/pdf",
      base64: Buffer.from(bytes).toString("base64"),
    });
    expect(click).not.toHaveBeenCalled();
    expect(createObjectURL).not.toHaveBeenCalled();
  });

  it("does not announce completion until the native destination has been written", async () => {
    native.platform.mockReturnValue("android");
    let finish!: () => void;
    native.save.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
    );
    let completed = false;
    const task = downloadFile("report.csv", "private report").then(() => {
      completed = true;
    });
    await vi.waitFor(() => expect(native.save).toHaveBeenCalledOnce());
    expect(completed).toBe(false);
    finish();
    await task;
    expect(completed).toBe(true);
  });

  it.each([
    "Export cancelled. No file was saved.",
    "The document could not be saved.",
  ])(
    "propagates native failure without a fake browser fallback: %s",
    async (message) => {
      native.platform.mockReturnValue("android");
      native.save.mockRejectedValueOnce(new Error(message));
      await expect(downloadFile("report.csv", "data")).rejects.toThrow(message);
      expect(click).not.toHaveBeenCalled();
    },
  );

  it("rejects oversized exports before allocating base64 or calling the native bridge", async () => {
    native.platform.mockReturnValue("android");
    const read = vi.spyOn(FileReader.prototype, "readAsDataURL");
    const blob = new Blob([new Uint8Array(MAX_ANDROID_EXPORT_BYTES + 1)]);
    await expect(downloadFile("backup.json", blob)).rejects.toThrow("32 MiB");
    expect(native.save).not.toHaveBeenCalled();
    expect(read).not.toHaveBeenCalled();
  });

  it("sanitizes filenames and chooses the correct Office MIME type", async () => {
    native.platform.mockReturnValue("android");
    await downloadFile("../result\\name\u0000.xlsx", "sheet");
    expect(native.save).toHaveBeenCalledWith(
      expect.objectContaining({
        filename: ".._result_name_.xlsx",
        mimeType:
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      }),
    );
  });

  it.each([".", "..", "   "])(
    "rejects an invalid native filename: %s",
    async (name) => {
      native.platform.mockReturnValue("android");
      await expect(downloadFile(name, "data")).rejects.toThrow("filename");
      expect(native.save).not.toHaveBeenCalled();
    },
  );

  it("reports a FileReader failure instead of silently discarding the export", async () => {
    native.platform.mockReturnValue("android");
    vi.spyOn(FileReader.prototype, "readAsDataURL").mockImplementation(
      function (this: FileReader) {
        this.dispatchEvent(new ProgressEvent("error"));
      },
    );
    await expect(downloadFile("report.csv", "data")).rejects.toThrow(
      "could not be read",
    );
    expect(native.save).not.toHaveBeenCalled();
  });

  it("detects only the native bundled asset origin, not hosted or ordinary web clients", () => {
    vi.stubGlobal("location", { origin: "https://localhost" });
    expect(isBundledAndroid()).toBe(false);
    native.platform.mockReturnValue("android");
    expect(isBundledAndroid()).toBe(true);
    vi.stubGlobal("location", { origin: "https://school.example.org" });
    expect(isBundledAndroid()).toBe(false);
  });

  it("opens the real platform print dialog and propagates native errors", async () => {
    const browserPrint = vi.spyOn(window, "print").mockImplementation(() => {});
    await printDocument();
    expect(browserPrint).toHaveBeenCalledOnce();
    expect(native.print).not.toHaveBeenCalled();
    native.platform.mockReturnValue("android");
    await printDocument();
    expect(native.print).toHaveBeenCalledOnce();
    native.print.mockRejectedValueOnce(new Error("Printing unavailable"));
    await expect(printDocument()).rejects.toThrow("Printing unavailable");
    expect(browserPrint).toHaveBeenCalledOnce();
  });
});
