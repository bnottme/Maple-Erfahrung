/**
 * Pure calculation functions. No I/O, no clock reads. Port of core/calculations.py.
 *
 * Note on `now`: the Python original accepted a `now` argument on
 * compute_stats / windowed_stats but never actually used it - elapsed time is
 * the span the screenshots cover (first to last capture) and the rolling window
 * is measured relative to the most recent screenshot, not the wall clock. Those
 * unused parameters are dropped here; behaviour is identical.
 */

import type { ScreenshotRecord } from "./models.js";

// ---------------------------------------------------------------------------
// OCR text parsing
// ---------------------------------------------------------------------------

const PERCENT_RE = /(\d{1,3}(?:[.,]\d{1,4})?)\s*%/;
// Fallback for when OCR drops the stylized "%" glyph: a small decimal number
// (e.g. 64.81) in the EXP text is almost always the percent. One/two integer
// digits before the point keeps it from matching a grouped EXP amount like
// "459.998".
const PERCENT_FALLBACK_RE = /\b(\d{1,2}[.,]\d{1,2})\b/;
const NUMBER_RE = /\d[\d.,]*\d|\d/g;

/**
 * Pull the largest plausible integer out of noisy OCR text.
 *
 * Game numbers are grouped with commas/periods (e.g. `1,234,567`). We strip
 * grouping separators and return the largest run of digits found, a good
 * heuristic for an EXP or meso figure sitting among UI noise.
 */
export function parseIntFromText(text: string): number | null {
  if (!text) {
    return null;
  }
  let best: number | null = null;
  for (const match of text.matchAll(NUMBER_RE)) {
    const digits = match[0].replace(/[^\d]/g, "");
    if (!digits) {
      continue;
    }
    const value = Number(digits);
    if (best === null || value > best) {
      best = value;
    }
  }
  return best;
}

/** Pull an EXP percentage (e.g. `12.34%`) out of OCR text. */
export function parsePercentFromText(text: string): number | null {
  if (!text) {
    return null;
  }
  const match = PERCENT_RE.exec(text);
  if (match) {
    const value = Number(match[1].replace(",", "."));
    return Number.isFinite(value) ? value : null;
  }
  // No explicit "%": fall back to a small decimal number, which in EXP text is
  // the percent. Must be in a sensible 0-100 range.
  const fb = PERCENT_FALLBACK_RE.exec(text);
  if (fb) {
    const value = Number(fb[1].replace(",", "."));
    if (Number.isFinite(value) && value > 0 && value < 100) {
      return value;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Session statistics
// ---------------------------------------------------------------------------

export interface SessionStats {
  screenshotCount: number;
  firstCapturedAt: number | null;
  lastCapturedAt: number | null;
  elapsedSeconds: number;
  expGained: number;
  expPerHour: number;
  mesoCurrent: number | null;
  mesoGained: number;
}

export function emptySessionStats(): SessionStats {
  return {
    screenshotCount: 0,
    firstCapturedAt: null,
    lastCapturedAt: null,
    elapsedSeconds: 0,
    expGained: 0,
    expPerHour: 0,
    mesoCurrent: null,
    mesoGained: 0,
  };
}

function sortedRecords(records: readonly ScreenshotRecord[]): ScreenshotRecord[] {
  return [...records].sort((a, b) => a.capturedAt - b.capturedAt);
}

/**
 * Sum positive EXP deltas between consecutive readings.
 *
 * Summing only positive increments means a level-up (which resets the displayed
 * current-level EXP to a small number) does not subtract from the running
 * total. Readings without an EXP value are skipped.
 */
export function computeExpGained(records: readonly ScreenshotRecord[]): number {
  const ordered = sortedRecords(records).filter((r) => r.exp !== null);
  let gained = 0;
  for (let i = 1; i < ordered.length; i++) {
    const delta = (ordered[i].exp as number) - (ordered[i - 1].exp as number);
    if (delta > 0) {
      gained += delta;
    }
  }
  return gained;
}

/** Net meso change: last reading minus first reading (can be negative). */
export function computeMesoGained(records: readonly ScreenshotRecord[]): number {
  const ordered = sortedRecords(records).filter((r) => r.meso !== null);
  if (ordered.length < 2) {
    return 0;
  }
  return (ordered[ordered.length - 1].meso as number) - (ordered[0].meso as number);
}

export function latestMeso(records: readonly ScreenshotRecord[]): number | null {
  const ordered = sortedRecords(records).filter((r) => r.meso !== null);
  return ordered.length ? (ordered[ordered.length - 1].meso as number) : null;
}

/**
 * Build a full stats snapshot for the given records.
 *
 * Elapsed is the span the screenshots actually cover (first to last capture),
 * measured from the photos themselves so saved and live photos behave the same.
 */
export function computeStats(
  records: readonly ScreenshotRecord[],
): SessionStats {
  const ordered = sortedRecords(records);
  if (ordered.length === 0) {
    return emptySessionStats();
  }

  const firstTs = ordered[0].capturedAt;
  const lastTs = ordered[ordered.length - 1].capturedAt;
  const elapsed = Math.max(0, lastTs - firstTs);

  return {
    screenshotCount: ordered.length,
    firstCapturedAt: firstTs,
    lastCapturedAt: lastTs,
    elapsedSeconds: elapsed,
    expGained: computeExpGained(ordered),
    expPerHour: overallExpRate(ordered),
    mesoCurrent: latestMeso(ordered),
    mesoGained: computeMesoGained(ordered),
  };
}

/** Filter records whose capture time falls within [dayStart, dayEnd). */
export function recordsForDay(
  records: readonly ScreenshotRecord[],
  dayStart: number,
  dayEnd: number,
): ScreenshotRecord[] {
  return records.filter((r) => dayStart <= r.capturedAt && r.capturedAt < dayEnd);
}

// ---------------------------------------------------------------------------
// Rolling-window rate + time-to-level
// ---------------------------------------------------------------------------

/** Selectable rate windows, in minutes (MapleStory-style 5/15/30/60). */
export const WINDOW_CHOICES_MINUTES = [5, 15, 30, 60] as const;

/**
 * Below this many seconds of elapsed time, a rate is treated as unreliable
 * (e.g. two screenshots written to disk at almost the same moment). Avoids
 * absurd EXP/hour figures from near-simultaneous captures.
 */
export const MIN_RATE_SPAN_SECONDS = 5.0;

/**
 * Average EXP/hour measured between the first and last screenshot. Returns 0
 * when there aren't two EXP readings, or when the timestamps are too close
 * together to be trustworthy.
 */
export function overallExpRate(records: readonly ScreenshotRecord[]): number {
  const expRecords = sortedRecords(records).filter((r) => r.exp !== null);
  if (expRecords.length < 2) {
    return 0;
  }
  const span =
    expRecords[expRecords.length - 1].capturedAt - expRecords[0].capturedAt;
  if (span < MIN_RATE_SPAN_SECONDS) {
    return 0;
  }
  const gained = positiveDeltaSum(expRecords);
  return gained / (span / 3600.0);
}

export interface WindowStats {
  windowSeconds: number;
  screenshotCount: number; // screenshots that fell inside the window
  expGained: number; // EXP gained within the window (or projected)
  expPerHour: number; // projected from the window's observed span
  etaSeconds: number | null; // estimated time to next level (null if unknown)
  estimated: boolean; // true when projected from a broader rate
  hasData: boolean; // true when any rate could be computed
}

/** Most recent record (by time) that has both an EXP value and a percent. */
export function latestRecordWithExpPercent(
  records: readonly ScreenshotRecord[],
): ScreenshotRecord | null {
  const candidates = sortedRecords(records).filter(
    (r) => r.exp !== null && r.expPercent !== null && (r.expPercent as number) > 0,
  );
  return candidates.length ? candidates[candidates.length - 1] : null;
}

/**
 * EXP still needed to finish the current level, inferred from one reading.
 *
 * MapleStory shows current-level EXP as an absolute value plus the percent of
 * the level completed. If EXP is X at P percent, the full level is X / (P/100),
 * so remaining = full - X. Returns null when the inputs can't support it.
 */
export function remainingExpToLevel(record: ScreenshotRecord): number | null {
  if (
    record.exp === null ||
    record.expPercent === null ||
    record.expPercent <= 0 ||
    record.expPercent >= 100
  ) {
    return null;
  }
  const total = record.exp / (record.expPercent / 100.0);
  const remaining = total - record.exp;
  return Math.max(0, Math.round(remaining));
}

/**
 * EXP gained / rate over the last `windowSeconds`, plus time-to-level.
 *
 * Only screenshots captured within the window are used. The rate is projected
 * from the observed span between the first and last in-window screenshot. The
 * window is measured relative to the most recent screenshot (not the wall
 * clock), so reviewing already-saved photos works the same as live tracking.
 */
export function windowedStats(
  records: readonly ScreenshotRecord[],
  windowSeconds: number,
): WindowStats {
  const expRecords = sortedRecords(records).filter((r) => r.exp !== null);
  if (expRecords.length < 2) {
    return {
      windowSeconds,
      screenshotCount: expRecords.length,
      expGained: 0,
      expPerHour: 0,
      etaSeconds: null,
      estimated: false,
      hasData: false,
    };
  }

  const windowHours = windowSeconds / 3600.0;

  const reference = expRecords[expRecords.length - 1].capturedAt;
  const cutoff = reference - windowSeconds;
  const inWindow = expRecords.filter((r) => r.capturedAt >= cutoff);

  const gained = inWindow.length >= 2 ? positiveDeltaSum(inWindow) : 0;
  const span =
    inWindow.length >= 2
      ? inWindow[inWindow.length - 1].capturedAt - inWindow[0].capturedAt
      : 0;

  let rate: number;
  let estimated: boolean;
  if (inWindow.length >= 2 && span >= MIN_RATE_SPAN_SECONDS) {
    // Enough well-separated points inside the window: measure the rate here.
    rate = gained / (span / 3600.0);
    estimated = false;
  } else {
    // Not enough usable points in this window - use the overall rate.
    rate = overallExpRate(expRecords);
    estimated = true;
  }

  // EXP for the window = how much you'd gain over the whole window at this rate.
  const expGained = Math.round(rate * windowHours);

  let etaSeconds: number | null = null;
  const anchor = latestRecordWithExpPercent(records);
  if (anchor !== null && rate > 0) {
    const remaining = remainingExpToLevel(anchor);
    if (remaining !== null && remaining > 0) {
      etaSeconds = (remaining / rate) * 3600.0;
    }
  }

  return {
    windowSeconds,
    screenshotCount: inWindow.length,
    expGained,
    expPerHour: rate,
    etaSeconds,
    estimated,
    hasData: rate > 0,
  };
}

/** Sum of positive EXP increases between consecutive readings. */
function positiveDeltaSum(records: readonly ScreenshotRecord[]): number {
  let total = 0;
  for (let i = 1; i < records.length; i++) {
    const delta = (records[i].exp as number) - (records[i - 1].exp as number);
    if (delta > 0) {
      total += delta;
    }
  }
  return total;
}
