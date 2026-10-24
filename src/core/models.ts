/**
 * Data models for the EXP/Meso tracker. Port of core/models.py.
 *
 * Python used frozen dataclasses; here we use plain interfaces plus pure helper
 * functions. Serialization (to_dict/from_dict) lives in the helpers so storage
 * stays straightforward.
 *
 * Two deliberate differences from the desktop version:
 *   - A `ScreenshotRecord` has no filesystem `path`. The browser has no stable
 *     path for an uploaded file, so records carry a generated `id` for identity
 *     plus the original `fileName` for display.
 *   - `capturedAt` stays epoch SECONDS (a float), matching calculations.ts and
 *     the Python original, so the math ports over unchanged.
 */

/**
 * A crop region expressed as fractions of the image (0.0-1.0),
 * (left, top, right, bottom). Stored as fractions so a region keeps working
 * even if the screenshot resolution changes.
 */
export interface Region {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** Convert a fractional region to an integer pixel box [left, top, right, bottom]. */
export function pixelBox(
  region: Region,
  width: number,
  height: number,
): [number, number, number, number] {
  return [
    Math.max(0, Math.trunc(region.left * width)),
    Math.max(0, Math.trunc(region.top * height)),
    Math.min(width, Math.trunc(region.right * width)),
    Math.min(height, Math.trunc(region.bottom * height)),
  ];
}

export function regionToDict(region: Region): Record<string, number> {
  return {
    left: region.left,
    top: region.top,
    right: region.right,
    bottom: region.bottom,
  };
}

export function regionFromDict(
  data: Record<string, unknown> | null | undefined,
): Region | null {
  if (!data) {
    return null;
  }
  return {
    left: Number(data.left),
    top: Number(data.top),
    right: Number(data.right),
    bottom: Number(data.bottom),
  };
}

/**
 * One processed screenshot.
 *
 * exp / meso / expPercent / level are nullable because OCR may be disabled or
 * may fail to read a clean value from a given image.
 */
export interface ScreenshotRecord {
  /** Stable identity for this record within the browser session. */
  id: string;
  /** Original uploaded file name, for display. */
  fileName: string;
  /** Epoch seconds (capture time; user-overridable). */
  capturedAt: number;
  exp: number | null;
  meso: number | null;
  expPercent: number | null;
  level: number | null;
  characterName: string | null;
  ocrText: string;
}

/** The four OCR regions a user can configure. Any may be unset (null). */
export interface RegionSet {
  exp: Region | null;
  meso: Region | null;
  level: Region | null;
  name: Region | null;
}

export function emptyRegionSet(): RegionSet {
  return { exp: null, meso: null, level: null, name: null };
}

/** Raw result of running OCR over one screenshot. Mirrors ocr.OcrResult. */
export interface OcrResult {
  exp: number | null;
  meso: number | null;
  expPercent: number | null;
  level: number | null;
  characterName: string | null;
  text: string;
}

export function emptyOcrResult(): OcrResult {
  return {
    exp: null,
    meso: null,
    expPercent: null,
    level: null,
    characterName: null,
    text: "",
  };
}

function optInt(value: unknown): number | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const n = Math.trunc(Number(value));
  return Number.isFinite(n) ? n : null;
}

function optFloat(value: unknown): number | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function screenshotRecordToDict(
  rec: ScreenshotRecord,
): Record<string, unknown> {
  return {
    id: rec.id,
    fileName: rec.fileName,
    capturedAt: rec.capturedAt,
    exp: rec.exp,
    meso: rec.meso,
    expPercent: rec.expPercent,
    level: rec.level,
    characterName: rec.characterName,
    ocrText: rec.ocrText,
  };
}

export function screenshotRecordFromDict(
  data: Record<string, unknown>,
): ScreenshotRecord {
  return {
    id: String(data.id),
    fileName: String(data.fileName ?? ""),
    capturedAt: Number(data.capturedAt),
    exp: optInt(data.exp),
    meso: optInt(data.meso),
    expPercent: optFloat(data.expPercent),
    level: optInt(data.level),
    characterName: (data.characterName as string) || null,
    ocrText: String(data.ocrText ?? ""),
  };
}

/** Values a user can manually correct on a record (used by the UI). */
export interface RecordEdits {
  exp?: number | null;
  meso?: number | null;
  expPercent?: number | null;
  level?: number | null;
  characterName?: string | null;
  capturedAt?: number;
}

/**
 * Return a copy of `rec` with the provided edits applied. Only fields present
 * in `edits` are changed. Mirrors ScreenshotRecord.with_values, extended to
 * allow correcting the capture time (the user decides the time on the web).
 */
export function withValues(
  rec: ScreenshotRecord,
  edits: RecordEdits,
): ScreenshotRecord {
  return {
    ...rec,
    exp: edits.exp !== undefined ? edits.exp : rec.exp,
    meso: edits.meso !== undefined ? edits.meso : rec.meso,
    expPercent: edits.expPercent !== undefined ? edits.expPercent : rec.expPercent,
    level: edits.level !== undefined ? edits.level : rec.level,
    characterName:
      edits.characterName !== undefined ? edits.characterName : rec.characterName,
    capturedAt: edits.capturedAt !== undefined ? edits.capturedAt : rec.capturedAt,
  };
}
