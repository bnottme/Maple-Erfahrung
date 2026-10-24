/**
 * Tesseract.js implementation of the OcrEngine interface.
 *
 * Tesseract.js runs its recognition in its own web worker internally, so OCR
 * already stays off the main UI thread - no custom worker wrapper needed.
 *
 * A single worker is built lazily and all calls are serialized through a small
 * promise-chain mutex. This mirrors the lock around the single RapidOCR engine
 * in the Python original: because we switch the character whitelist per field,
 * setParameters + recognize must run atomically for each call.
 */

import { createWorker, OEM, PSM, type Worker } from "tesseract.js";
import { prepForOcr, scaleCanvas } from "./image.js";
import type { AnyCanvas, OcrEngine, OcrRecognizeOptions } from "./ocr.js";

// Small crops OCR better when upscaled; HUD numbers are tiny.
const CROP_SCALE = 4;

/** Convert any canvas to a PNG blob (Tesseract accepts a blob reliably). */
async function canvasToBlob(canvas: AnyCanvas): Promise<Blob> {
  if ("convertToBlob" in canvas) {
    return canvas.convertToBlob({ type: "image/png" });
  }
  return new Promise<Blob>((resolve, reject) => {
    (canvas as HTMLCanvasElement).toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("canvas.toBlob returned null"));
    }, "image/png");
  });
}

/**
 * Resolve a path under the app's base URL to an absolute URL. Using absolute
 * URLs (rather than relative ones) keeps the worker/core/lang fetches reliable
 * whether the site is served from a domain root or a sub-path (GitHub Pages),
 * and regardless of the worker's own origin.
 */
function asset(path: string): string {
  const base = new URL(import.meta.env.BASE_URL, window.location.href);
  return new URL(path, base).href;
}

export class TesseractEngine implements OcrEngine {
  private worker: Worker | null = null;
  private initPromise: Promise<void> | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  private currentWhitelist: string | null = null;

  async init(): Promise<void> {
    if (this.worker) {
      return;
    }
    if (!this.initPromise) {
      this.initPromise = (async () => {
        // All assets are self-hosted under public/tesseract so there are no
        // external/CDN requests. We ship the LSTM core variants and the fast
        // LSTM English model, so pin the engine to LSTM_ONLY to match.
        // "engbest" is the high-accuracy English model (self-hosted). The
        // distinct name also avoids serving a stale cached "eng" model.
        this.worker = await createWorker("engbest", OEM.LSTM_ONLY, {
          workerPath: asset("tesseract/worker.min.js"),
          corePath: asset("tesseract/"),
          langPath: asset("tesseract/lang"),
          gzip: true,
        });
        // HUD values are a single short line, so single-line segmentation is a
        // big accuracy win over the default "auto page" mode on tiny crops.
        await this.worker.setParameters({
          tessedit_pageseg_mode: PSM.SINGLE_LINE,
        });
      })();
    }
    await this.initPromise;
  }

  /** Serialize work so whitelist changes and recognize calls never interleave. */
  private run<T>(task: () => Promise<T>): Promise<T> {
    const result = this.queue.then(task, task);
    // Keep the chain alive even if a task rejects.
    this.queue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  async recognizeText(image: AnyCanvas, opts?: OcrRecognizeOptions): Promise<string> {
    await this.init();
    // Upscale then binarize to crisp black-on-white before recognition.
    const blob = await canvasToBlob(prepForOcr(scaleCanvas(image, CROP_SCALE)));
    return this.run(async () => {
      const worker = this.worker;
      if (!worker) {
        throw new Error("Tesseract worker not initialized");
      }
      const whitelist = opts?.charWhitelist ?? "";
      if (whitelist !== this.currentWhitelist) {
        await worker.setParameters({ tessedit_char_whitelist: whitelist });
        this.currentWhitelist = whitelist;
      }
      const { data } = await worker.recognize(blob);
      return data.text ?? "";
    });
  }

  async terminate(): Promise<void> {
    const worker = this.worker;
    this.worker = null;
    this.initPromise = null;
    this.currentWhitelist = null;
    if (worker) {
      await worker.terminate();
    }
  }
}
