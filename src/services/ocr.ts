/**
 * OCR extraction. Port of services/ocr.py's extract_values, adapted for the
 * browser.
 *
 * The engine is pluggable behind the `OcrEngine` interface so we can start with
 * Tesseract.js (easy, bundles a worker, good for digit crops with a whitelist)
 * and later swap in onnxruntime-web with the original RapidOCR models without
 * touching the extraction logic.
 *
 * Like the Python original:
 *   - EXP falls back to whole-image OCR when no region is set.
 *   - Meso, level and name are only read when their own region is set, otherwise
 *     they stay blank (a value picked out of the whole image would be
 *     meaningless, and reusing the EXP crop would just duplicate the number).
 *   - OCR failures never throw; they yield an empty/partial result so tracking
 *     keeps working and the user can type values in by hand.
 */

import {
  parseIntFromText,
  parsePercentFromText,
} from "../core/calculations.js";
import {
  emptyOcrResult,
  type OcrResult,
  type Region,
  type RegionSet,
} from "../core/models.js";
import { cropRegion, type LoadedImage } from "./image.js";

export type AnyCanvas = HTMLCanvasElement | OffscreenCanvas;

/** Optional hints the extraction layer passes to the engine per call. */
export interface OcrRecognizeOptions {
  /** Restrict recognition to these characters (Tesseract char whitelist). */
  charWhitelist?: string;
}

/**
 * A swappable OCR backend. Implementations receive the cropped region as a
 * canvas and do their own preprocessing (Tesseract binarizes; RapidOCR
 * normalizes colour), then return the recognized text. Implementations must
 * serialize their own calls.
 */
export interface OcrEngine {
  /** Prepare the engine (load worker/models). Safe to call more than once. */
  init(): Promise<void>;
  /** Recognize all text in a cropped region and return it as a single string. */
  recognizeText(image: AnyCanvas, opts?: OcrRecognizeOptions): Promise<string>;
  /** Release resources. */
  terminate(): Promise<void>;
}

// Character whitelists per field (used by engines that support them, e.g.
// Tesseract). EXP text carries digits, grouping separators, a percent sign and
// often a "/" and brackets; the SPACE keeps adjacent numbers from merging.
const NUMERIC_WHITELIST = "0123456789.,%/[]() ";
const NAME_WHITELIST =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789 ";

/** OCR a single region of a loaded image and return the raw recognized text. */
async function ocrRegion(
  engine: OcrEngine,
  image: LoadedImage,
  region: Region | null,
  opts?: OcrRecognizeOptions,
): Promise<string> {
  const crop = cropRegion(image, region);
  if (!crop) {
    return "";
  }
  try {
    const text = await engine.recognizeText(crop, opts);
    return text.trim();
  } catch (err) {
    console.warn("ocr_region_failed", err);
    return "";
  }
}

/**
 * Tidy an OCR'd character name.
 *
 * MapleStory names are a single token of letters/digits. We take the longest
 * whitespace-separated token (so a region that also catches a job label, e.g.
 * "Cleric SmileBig", still resolves to the name).
 */
export function cleanName(text: string): string | null {
  if (!text) {
    return null;
  }
  const tokens = text
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
  if (tokens.length === 0) {
    return null;
  }
  return tokens.reduce((a, b) => (b.length > a.length ? b : a));
}

/** Public, one-region helper used by the UI's region-picker preview. */
export async function readRegionText(
  engine: OcrEngine,
  image: LoadedImage,
  region: Region | null,
): Promise<string> {
  return ocrRegion(engine, image, region);
}

/**
 * Run OCR on a screenshot and parse EXP / meso / level / name values.
 * Never throws: on failure returns an empty/partial result.
 */
export async function extractValues(
  engine: OcrEngine,
  image: LoadedImage,
  regions: RegionSet,
): Promise<OcrResult> {
  try {
    const expText = await ocrRegion(engine, image, regions.exp, {
      charWhitelist: NUMERIC_WHITELIST,
    });
    const mesoText = regions.meso
      ? await ocrRegion(engine, image, regions.meso, {
          charWhitelist: NUMERIC_WHITELIST,
        })
      : "";
    const levelText = regions.level
      ? await ocrRegion(engine, image, regions.level, {
          charWhitelist: NUMERIC_WHITELIST,
        })
      : "";
    const nameText = regions.name
      ? await ocrRegion(engine, image, regions.name, {
          charWhitelist: NAME_WHITELIST,
        })
      : "";

    const exp = parseIntFromText(expText);
    const expPercent = parsePercentFromText(expText);
    const meso = regions.meso ? parseIntFromText(mesoText) : null;
    const level = regions.level ? parseIntFromText(levelText) : null;
    const characterName = regions.name ? cleanName(nameText) : null;

    const parts = [
      expText ? `EXP:${expText}` : "",
      regions.meso && mesoText ? `MESO:${mesoText}` : "",
      levelText ? `LVL:${levelText}` : "",
      nameText ? `NAME:${nameText}` : "",
    ].filter((p) => p);
    const combined = parts.length ? parts.join(" | ") : expText;

    return {
      exp,
      meso,
      expPercent,
      level,
      characterName,
      text: combined.trim(),
    };
  } catch (err) {
    console.warn("ocr_failed", err);
    return { ...emptyOcrResult(), text: `(ocr error: ${String(err)})` };
  }
}
