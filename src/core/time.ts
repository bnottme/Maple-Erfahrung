/**
 * Capture-time resolution for uploaded screenshots.
 *
 * The stats depend on each screenshot's real capture time. Browsers do not
 * send a file's modified time to a server, but the File API exposes it to us
 * client-side as `File.lastModified`, so we can read it directly.
 *
 * Strategy (the user always has the final say):
 *   1. Best-effort parse of a timestamp embedded in the file NAME.
 *   2. Otherwise `File.lastModified` (the file's on-disk modified time).
 *   3. The UI lets the user override any resolved time per screenshot.
 *
 * All times are returned as epoch SECONDS to match calculations.ts.
 */

/**
 * Common timestamp shapes seen in screenshot file names. Each pattern captures
 * year, month, day, hour, minute and (optionally) second groups. Separators
 * between the time parts vary by OS / capture tool, so we stay permissive.
 */
const FILENAME_PATTERNS: RegExp[] = [
  // 2024-01-30 14.56.07 / 2024-01-30_14-56-07 / 2024-01-30 14:56:07
  /(\d{4})[-_.](\d{2})[-_.](\d{2})[ _T]+(\d{2})[-_.:](\d{2})(?:[-_.:](\d{2}))?/,
  // 20240130_145607 / 20240130-145607 / 20240130145607
  /(\d{4})(\d{2})(\d{2})[-_ ]?(\d{2})(\d{2})(\d{2})/,
];

/**
 * Try to read a capture time out of a file name. Returns epoch seconds, or null
 * when no plausible timestamp is found. Times are interpreted in the user's
 * local timezone, since screenshots are named in local time.
 */
export function parseTimestampFromFilename(name: string): number | null {
  for (const pattern of FILENAME_PATTERNS) {
    const m = pattern.exec(name);
    if (!m) {
      continue;
    }
    const year = Number(m[1]);
    const month = Number(m[2]);
    const day = Number(m[3]);
    const hour = Number(m[4]);
    const minute = Number(m[5]);
    const second = m[6] !== undefined ? Number(m[6]) : 0;

    if (
      month < 1 || month > 12 ||
      day < 1 || day > 31 ||
      hour > 23 || minute > 59 || second > 59 ||
      year < 2000 || year > 2100
    ) {
      continue;
    }

    const dt = new Date(year, month - 1, day, hour, minute, second);
    // Guard against rollover (e.g. day 31 in a 30-day month shifting forward).
    if (
      dt.getFullYear() !== year ||
      dt.getMonth() !== month - 1 ||
      dt.getDate() !== day
    ) {
      continue;
    }
    return dt.getTime() / 1000;
  }
  return null;
}

/**
 * Resolve the best-guess capture time for an uploaded file, in epoch seconds.
 * Falls back to the current time if the file has no known modified date (the
 * File API returns `0` / now in that rare case).
 */
export function resolveCaptureTime(file: File): number {
  const fromName = parseTimestampFromFilename(file.name);
  if (fromName !== null) {
    return fromName;
  }
  if (file.lastModified && Number.isFinite(file.lastModified)) {
    return file.lastModified / 1000;
  }
  return Date.now() / 1000;
}

/** Where a resolved capture time came from, for surfacing to the user. */
export type TimeSource = "filename" | "modified" | "now";

export interface ResolvedTime {
  capturedAt: number; // epoch seconds
  source: TimeSource;
}

/** Like resolveCaptureTime but also reports which source was used. */
export function resolveCaptureTimeWithSource(file: File): ResolvedTime {
  const fromName = parseTimestampFromFilename(file.name);
  if (fromName !== null) {
    return { capturedAt: fromName, source: "filename" };
  }
  if (file.lastModified && Number.isFinite(file.lastModified)) {
    return { capturedAt: file.lastModified / 1000, source: "modified" };
  }
  return { capturedAt: Date.now() / 1000, source: "now" };
}
