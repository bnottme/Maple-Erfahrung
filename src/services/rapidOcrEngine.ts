/**
 * RapidOCR recognition engine for the browser - the same PP-OCRv3 recognition
 * model your desktop app used, run via onnxruntime-web. This gives Python-level
 * recognition of the small, stylized MapleStory HUD text that Tesseract
 * struggled with (e.g. the level digits).
 *
 * Detection isn't needed: the region picker already crops tightly to one value,
 * so we feed that crop straight to the recognizer (a single text line).
 *
 * Pipeline (matches PaddleOCR / RapidOCR rec preprocessing):
 *   1. resize the crop to height 48, width proportional (RGB),
 *   2. normalize to [-1, 1],
 *   3. run the model -> logits [1, T, C],
 *   4. CTC greedy decode with the model's embedded character dictionary,
 *      where the class list is ['blank'] + dict + [' '].
 *
 * All assets (model, dictionary, onnxruntime wasm) are self-hosted - no CDN.
 */

import * as ort from "onnxruntime-web";
import type { AnyCanvas, OcrEngine } from "./ocr.js";

function asset(path: string): string {
  return new URL(`${import.meta.env.BASE_URL}${path}`, window.location.href).href;
}

const REC_HEIGHT = 48;

function makeCanvas(w: number, h: number): {
  canvas: AnyCanvas;
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
} {
  if (typeof OffscreenCanvas !== "undefined") {
    const canvas = new OffscreenCanvas(w, h);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("no 2d context");
    return { canvas, ctx };
  }
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no 2d context");
  return { canvas, ctx };
}

export class RapidOcrEngine implements OcrEngine {
  private session: ort.InferenceSession | null = null;
  private initPromise: Promise<void> | null = null;
  private chars: string[] = [];
  private queue: Promise<unknown> = Promise.resolve();

  async init(): Promise<void> {
    if (this.session) return;
    if (!this.initPromise) {
      this.initPromise = (async () => {
        // Self-hosted wasm, single-threaded (no COOP/COEP headers needed).
        ort.env.wasm.wasmPaths = asset("ort/");
        ort.env.wasm.numThreads = 1;

        const [session, keysText] = await Promise.all([
          ort.InferenceSession.create(asset("models/ch_PP-OCRv3_rec_infer.onnx"), {
            executionProviders: ["wasm"],
            graphOptimizationLevel: "all",
          }),
          fetch(asset("models/ppocr_keys.txt")).then((r) => r.text()),
        ]);
        this.session = session;

        const lines = keysText.replace(/\r/g, "").split("\n");
        while (lines.length && lines[lines.length - 1] === "") lines.pop();
        // Class list at inference: ['blank'] + dict + [' '].
        this.chars = ["\u0000", ...lines, " "];
      })();
    }
    await this.initPromise;
  }

  recognizeText(image: AnyCanvas): Promise<string> {
    const task = async () => {
      await this.init();
      return this.run(image);
    };
    const result = this.queue.then(task, task);
    this.queue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private async run(image: AnyCanvas): Promise<string> {
    const session = this.session;
    if (!session) throw new Error("rec session not initialized");

    const w0 = image.width;
    const h0 = image.height;
    if (w0 === 0 || h0 === 0) return "";

    let w = Math.round((REC_HEIGHT * w0) / h0);
    w = Math.max(16, Math.min(w, 2000));

    const { ctx } = makeCanvas(w, REC_HEIGHT);
    ctx.drawImage(image as CanvasImageSource, 0, 0, w0, h0, 0, 0, w, REC_HEIGHT);
    const px = ctx.getImageData(0, 0, w, REC_HEIGHT).data;

    const area = REC_HEIGHT * w;
    const tensor = new Float32Array(3 * area);
    for (let y = 0; y < REC_HEIGHT; y++) {
      for (let x = 0; x < w; x++) {
        const p = (y * w + x) * 4;
        const o = y * w + x;
        tensor[o] = (px[p] / 255) * 2 - 1; // R
        tensor[area + o] = (px[p + 1] / 255) * 2 - 1; // G
        tensor[2 * area + o] = (px[p + 2] / 255) * 2 - 1; // B
      }
    }

    const input = new ort.Tensor("float32", tensor, [1, 3, REC_HEIGHT, w]);
    const feeds: Record<string, ort.Tensor> = {
      [session.inputNames[0]]: input,
    };
    const output = await session.run(feeds);
    const logits = output[session.outputNames[0]];
    return this.ctcDecode(logits);
  }

  private ctcDecode(t: ort.Tensor): string {
    const dims = t.dims as number[];
    const steps = dims[1];
    const classes = dims[2];
    const data = t.data as Float32Array;
    let prev = -1;
    let out = "";
    for (let s = 0; s < steps; s++) {
      const off = s * classes;
      let best = 0;
      let bestVal = -Infinity;
      for (let c = 0; c < classes; c++) {
        const v = data[off + c];
        if (v > bestVal) {
          bestVal = v;
          best = c;
        }
      }
      if (best !== 0 && best !== prev) {
        out += this.chars[best] ?? "";
      }
      prev = best;
    }
    return out;
  }

  async terminate(): Promise<void> {
    const session = this.session;
    this.session = null;
    this.initPromise = null;
    if (session) await session.release();
  }
}
