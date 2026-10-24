/**
 * Image loading and region cropping, using the browser canvas.
 *
 * Replaces the desktop app's PIL crop. A `Region` is fractional (0-1), so a box
 * drawn on one screenshot keeps working at any resolution - exactly as in the
 * Python original. The OCR layer consumes the canvas this module produces.
 */

import { pixelBox, type Region } from "../core/models.js";

/** A decoded image plus its dimensions. */
export interface LoadedImage {
  bitmap: ImageBitmap;
  width: number;
  height: number;
}

/**
 * Decode an image file (or blob) into an ImageBitmap. ImageBitmap decoding is
 * fast and works inside Web Workers, so this stays off the main thread when the
 * OCR engine runs in a worker.
 */
export async function loadImage(source: Blob): Promise<LoadedImage> {
  const bitmap = await createImageBitmap(source);
  return { bitmap, width: bitmap.width, height: bitmap.height };
}

/** Obtain a 2D context, preferring OffscreenCanvas when available (workers). */
function makeCanvas(
  width: number,
  height: number,
): { canvas: HTMLCanvasElement | OffscreenCanvas; ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D } {
  if (typeof OffscreenCanvas !== "undefined") {
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      throw new Error("Could not get 2D context from OffscreenCanvas");
    }
    return { canvas, ctx };
  }
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("Could not get 2D context from canvas");
  }
  return { canvas, ctx };
}

/**
 * Crop a region from a loaded image and return it as a canvas ready for OCR.
 * When `region` is null, the whole image is returned (matching the Python
 * fallback where EXP is read from the full image if no region is set).
 *
 * Returns null if the region collapses to an empty box.
 */
export function cropRegion(
  image: LoadedImage,
  region: Region | null,
): HTMLCanvasElement | OffscreenCanvas | null {
  const { bitmap, width, height } = image;

  let sx = 0;
  let sy = 0;
  let sw = width;
  let sh = height;

  if (region) {
    const [left, top, right, bottom] = pixelBox(region, width, height);
    if (right <= left || bottom <= top) {
      return null;
    }
    sx = left;
    sy = top;
    sw = right - left;
    sh = bottom - top;
  }

  const { canvas, ctx } = makeCanvas(sw, sh);
  ctx.drawImage(bitmap, sx, sy, sw, sh, 0, 0, sw, sh);
  return canvas;
}

/**
 * Upscale a small crop so faint game text is easier for the OCR engine to read.
 * Game HUD numbers are tiny; a 3-4x upscale noticeably improves recognition
 * without needing a heavier model. Returns the input untouched when no scaling
 * is requested.
 */
export function scaleCanvas(
  source: HTMLCanvasElement | OffscreenCanvas,
  factor: number,
): HTMLCanvasElement | OffscreenCanvas {
  if (factor === 1) {
    return source;
  }
  const w = Math.max(1, Math.round(source.width * factor));
  const h = Math.max(1, Math.round(source.height * factor));
  const { canvas, ctx } = makeCanvas(w, h);
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(source as CanvasImageSource, 0, 0, w, h);
  return canvas;
}

/**
 * Binarize a crop to crisp black text on white, which Tesseract reads best.
 *
 * Steps: grayscale, pick a threshold with Otsu's method, then paint the
 * MINORITY class black and the rest white. HUD text (digits) is always the
 * minority of pixels, so this yields black glyphs on white regardless of
 * whether the source was light-on-dark (the EXP bar) or dark-on-light - no need
 * to guess polarity.
 */
export function prepForOcr(
  source: HTMLCanvasElement | OffscreenCanvas,
): HTMLCanvasElement | OffscreenCanvas {
  const sctx = source.getContext("2d") as
    | CanvasRenderingContext2D
    | OffscreenCanvasRenderingContext2D
    | null;
  if (!sctx) {
    return source;
  }
  const w = source.width;
  const h = source.height;
  const img = sctx.getImageData(0, 0, w, h);
  const data = img.data;
  const total = w * h;

  const gray = new Uint8ClampedArray(total);
  const hist = new Array<number>(256).fill(0);
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    const g = Math.round(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]);
    gray[p] = g;
    hist[g]++;
  }

  // Otsu threshold.
  let sum = 0;
  for (let t = 0; t < 256; t++) sum += t * hist[t];
  let sumB = 0;
  let wB = 0;
  let maxVar = -1;
  let threshold = 127;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > maxVar) {
      maxVar = between;
      threshold = t;
    }
  }

  // Minority class = text, painted black on white (polarity-agnostic).
  let above = 0;
  for (let p = 0; p < total; p++) if (gray[p] > threshold) above++;
  const textIsBright = above <= total - above;

  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    const isText = textIsBright ? gray[p] > threshold : gray[p] <= threshold;
    const v = isText ? 0 : 255;
    data[i] = v;
    data[i + 1] = v;
    data[i + 2] = v;
    data[i + 3] = 255;
  }

  const { canvas, ctx } = makeCanvas(w, h);
  ctx.putImageData(img, 0, 0);
  return canvas;
}
