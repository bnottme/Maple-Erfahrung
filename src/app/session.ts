/**
 * Headless session orchestrator - the browser equivalent of the desktop
 * MainWindow's logic, with no DOM. The UI layer (added later) drives this and
 * subscribes to change events; it computes and parses nothing itself.
 *
 * Responsibilities mirror the desktop app minus folder-watching:
 *   - Hold the session state (records, OCR regions, desired level, rate window).
 *   - Add uploaded screenshots: resolve capture time, OCR, build a record.
 *   - Expose live stats (session / rolling-window / level-goal).
 *   - Allow manual correction of any field, including the capture time.
 *   - Persist to IndexedDB (debounced) and restore on load.
 */

import {
  computeStats,
  windowedStats,
  WINDOW_CHOICES_MINUTES,
  type SessionStats,
  type WindowStats,
} from "../core/calculations.js";
import { expToReachLevel, LEVEL_CAP } from "../core/expTable.js";
import {
  emptyRegionSet,
  regionFromDict,
  regionToDict,
  screenshotRecordFromDict,
  screenshotRecordToDict,
  withValues,
  type RecordEdits,
  type Region,
  type RegionSet,
  type ScreenshotRecord,
} from "../core/models.js";
import { resolveCaptureTime } from "../core/time.js";
import { loadImage } from "../services/image.js";
import { extractValues, type OcrEngine } from "../services/ocr.js";
import { DebouncedSaver, loadState, type StorageError } from "../services/storage.js";

/** Which of the four OCR regions. */
export type RegionKey = keyof RegionSet;

/** EXP-to-goal figures for the "level goal" panel. */
export interface GoalStats {
  /** EXP remaining to the desired level (null if not computable). */
  goalRemaining: number | null;
  /** EXP remaining to the level cap (null if not computable). */
  capRemaining: number | null;
  /** Estimated seconds to the desired level (null if unknown). */
  goalEtaSeconds: number | null;
  /** True when the desired level is already reached. */
  reached: boolean;
}

/** A full snapshot the UI can render from in one go. */
export interface SessionView {
  records: ScreenshotRecord[];
  regions: RegionSet;
  desiredLevel: number;
  windowIndex: number;
  windowMinutes: number;
  tracking: boolean;
  sessionStart: number | null;
  stats: SessionStats;
  window: WindowStats;
  goal: GoalStats;
  latestName: string | null;
  latestLevel: number | null;
  latestRecord: ScreenshotRecord | null;
}

type Listener = (view: SessionView) => void;

const DEFAULT_WINDOW_INDEX = 1; // 15 min, matching the desktop default
const DEFAULT_DESIRED_LEVEL = 100;

function newId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `rec_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

export class TrackerSession {
  private records: ScreenshotRecord[] = [];
  private regions: RegionSet = emptyRegionSet();
  private sessionStart: number | null = null;
  private tracking = false;
  private windowIndex = DEFAULT_WINDOW_INDEX;
  private desiredLevel = DEFAULT_DESIRED_LEVEL;

  private readonly listeners = new Set<Listener>();
  private readonly saver: DebouncedSaver;

  constructor(
    private readonly engine: OcrEngine,
    saver: DebouncedSaver = new DebouncedSaver(),
  ) {
    this.saver = saver;
  }

  // --------------------------------------------------------------- events
  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(): void {
    const view = this.getView();
    for (const listener of this.listeners) {
      listener(view);
    }
  }

  // --------------------------------------------------------------- ingest
  /**
   * Process uploaded screenshot files: resolve each capture time, OCR it, and
   * append a record. Files are handled in the order given. OCR never throws, so
   * a bad image still yields a timestamped record the user can fill in by hand.
   * Returns the records that were added.
   */
  async addFiles(files: Iterable<File>): Promise<ScreenshotRecord[]> {
    const added: ScreenshotRecord[] = [];
    for (const file of files) {
      const capturedAt = resolveCaptureTime(file);
      let record: ScreenshotRecord = {
        id: newId(),
        fileName: file.name,
        capturedAt,
        exp: null,
        meso: null,
        expPercent: null,
        level: null,
        characterName: null,
        ocrText: "",
      };
      try {
        const image = await loadImage(file);
        const result = await extractValues(this.engine, image, this.regions);
        image.bitmap.close();
        record = {
          ...record,
          exp: result.exp,
          meso: result.meso,
          expPercent: result.expPercent,
          level: result.level,
          characterName: result.characterName,
          ocrText: result.text,
        };
      } catch (err) {
        record = { ...record, ocrText: `(image error: ${String(err)})` };
      }
      this.records.push(record);
      added.push(record);
    }
    if (added.length) {
      this.scheduleSave();
      this.emit();
    }
    return added;
  }

  // ------------------------------------------------------------- mutators
  setRegion(key: RegionKey, region: Region | null): void {
    this.regions = { ...this.regions, [key]: region };
    this.scheduleSave();
    this.emit();
  }

  setRegions(regions: RegionSet): void {
    this.regions = { ...regions };
    this.scheduleSave();
    this.emit();
  }

  setDesiredLevel(level: number): void {
    this.desiredLevel = level;
    this.scheduleSave();
    this.emit();
  }

  cycleWindow(): void {
    this.windowIndex = (this.windowIndex + 1) % WINDOW_CHOICES_MINUTES.length;
    this.scheduleSave();
    this.emit();
  }

  setWindowIndex(index: number): void {
    if (index >= 0 && index < WINDOW_CHOICES_MINUTES.length) {
      this.windowIndex = index;
      this.scheduleSave();
      this.emit();
    }
  }

  setTracking(tracking: boolean): void {
    this.tracking = tracking;
    if (tracking && this.sessionStart === null) {
      this.sessionStart = Date.now() / 1000;
    }
    this.scheduleSave();
    this.emit();
  }

  /** Apply manual corrections to one record (EXP/meso/level/name/time). */
  updateRecord(id: string, edits: RecordEdits): void {
    let changed = false;
    this.records = this.records.map((r) => {
      if (r.id !== id) {
        return r;
      }
      changed = true;
      return withValues(r, edits);
    });
    if (changed) {
      this.scheduleSave();
      this.emit();
    }
  }

  removeRecord(id: string): void {
    const before = this.records.length;
    this.records = this.records.filter((r) => r.id !== id);
    if (this.records.length !== before) {
      this.scheduleSave();
      this.emit();
    }
  }

  reset(): void {
    this.records = [];
    this.sessionStart = null;
    this.tracking = false;
    this.scheduleSave();
    this.emit();
  }

  // ----------------------------------------------------------- selectors
  currentWindowSeconds(): number {
    return WINDOW_CHOICES_MINUTES[this.windowIndex] * 60;
  }

  getStats(): SessionStats {
    return computeStats(this.records);
  }

  getWindowStats(): WindowStats {
    return windowedStats(this.records, this.currentWindowSeconds());
  }

  getGoalStats(): GoalStats {
    const rec = this.latestRecordWithLevel();
    if (!rec || rec.level === null) {
      return {
        goalRemaining: null,
        capRemaining: null,
        goalEtaSeconds: null,
        reached: false,
      };
    }
    const currentLevel = rec.level;
    const expInLevel = rec.exp ?? 0;
    const goalRemaining = expToReachLevel(currentLevel, expInLevel, this.desiredLevel);
    const capRemaining = expToReachLevel(currentLevel, expInLevel, LEVEL_CAP);
    const rate = this.getWindowStats().expPerHour;

    let goalEtaSeconds: number | null = null;
    let reached = false;
    if (goalRemaining === 0) {
      reached = true;
    } else if (goalRemaining !== null && rate > 0) {
      goalEtaSeconds = (goalRemaining / rate) * 3600.0;
    }
    return { goalRemaining, capRemaining, goalEtaSeconds, reached };
  }

  getView(): SessionView {
    return {
      records: [...this.records].sort((a, b) => a.capturedAt - b.capturedAt),
      regions: { ...this.regions },
      desiredLevel: this.desiredLevel,
      windowIndex: this.windowIndex,
      windowMinutes: WINDOW_CHOICES_MINUTES[this.windowIndex],
      tracking: this.tracking,
      sessionStart: this.sessionStart,
      stats: this.getStats(),
      window: this.getWindowStats(),
      goal: this.getGoalStats(),
      latestName: this.latestValue("characterName"),
      latestLevel: this.latestValue("level"),
      latestRecord: this.latestRecord(),
    };
  }

  private latestRecord(): ScreenshotRecord | null {
    if (!this.records.length) {
      return null;
    }
    return this.records.reduce((a, b) => (b.capturedAt >= a.capturedAt ? b : a));
  }

  private latestRecordWithLevel(): ScreenshotRecord | null {
    const candidates = this.records.filter((r) => r.level !== null);
    if (!candidates.length) {
      return null;
    }
    return candidates.reduce((a, b) => (b.capturedAt >= a.capturedAt ? b : a));
  }

  /** Most recent non-null value of a field across all records. */
  private latestValue<K extends keyof ScreenshotRecord>(
    field: K,
  ): ScreenshotRecord[K] | null {
    const ordered = [...this.records].sort((a, b) => a.capturedAt - b.capturedAt);
    for (let i = ordered.length - 1; i >= 0; i--) {
      const value = ordered[i][field];
      if (value !== null && value !== undefined && value !== "") {
        return value;
      }
    }
    return null;
  }

  // -------------------------------------------------------------- export
  /** Build a CSV string of all records (mirrors the desktop CSV export). */
  exportCsv(): string {
    const header = [
      "captured_at_iso",
      "file",
      "character_name",
      "level",
      "exp",
      "exp_percent",
      "meso",
    ];
    const rows = [...this.records]
      .sort((a, b) => a.capturedAt - b.capturedAt)
      .map((rec) => [
        new Date(rec.capturedAt * 1000).toISOString(),
        rec.fileName,
        rec.characterName ?? "",
        rec.level ?? "",
        rec.exp ?? "",
        rec.expPercent ?? "",
        rec.meso ?? "",
      ]);
    return [header, ...rows]
      .map((cols) => cols.map((c) => csvCell(String(c))).join(","))
      .join("\r\n");
  }

  // ----------------------------------------------------------- persistence
  private scheduleSave(): void {
    this.saver.schedule(this.toState());
  }

  /** Flush any pending save immediately (call on page unload). */
  async flush(): Promise<void> {
    await this.saver.flush();
  }

  private toState(): Record<string, unknown> {
    return {
      version: 1,
      sessionStart: this.sessionStart,
      tracking: this.tracking,
      windowIndex: this.windowIndex,
      desiredLevel: this.desiredLevel,
      regions: {
        exp: this.regions.exp ? regionToDict(this.regions.exp) : null,
        meso: this.regions.meso ? regionToDict(this.regions.meso) : null,
        level: this.regions.level ? regionToDict(this.regions.level) : null,
        name: this.regions.name ? regionToDict(this.regions.name) : null,
      },
      records: this.records.map(screenshotRecordToDict),
    };
  }

  /**
   * Restore state from IndexedDB. Returns true if state was loaded. A corrupt
   * store is surfaced via the returned StorageError so the UI can warn the user
   * rather than silently wiping their history.
   */
  async load(): Promise<{ loaded: boolean; error?: StorageError }> {
    let state: Record<string, unknown> | null;
    try {
      state = await loadState();
    } catch (err) {
      return { loaded: false, error: err as StorageError };
    }
    if (!state) {
      return { loaded: false };
    }
    this.applyState(state);
    this.emit();
    return { loaded: true };
  }

  private applyState(state: Record<string, unknown>): void {
    this.sessionStart =
      state.sessionStart === null || state.sessionStart === undefined
        ? null
        : Number(state.sessionStart);
    this.tracking = Boolean(state.tracking);
    this.windowIndex =
      typeof state.windowIndex === "number" &&
      state.windowIndex >= 0 &&
      state.windowIndex < WINDOW_CHOICES_MINUTES.length
        ? state.windowIndex
        : DEFAULT_WINDOW_INDEX;
    this.desiredLevel =
      typeof state.desiredLevel === "number" ? state.desiredLevel : DEFAULT_DESIRED_LEVEL;

    const regions = (state.regions ?? {}) as Record<string, unknown>;
    this.regions = {
      exp: regionFromDict(regions.exp as Record<string, unknown>),
      meso: regionFromDict(regions.meso as Record<string, unknown>),
      level: regionFromDict(regions.level as Record<string, unknown>),
      name: regionFromDict(regions.name as Record<string, unknown>),
    };

    const records = Array.isArray(state.records) ? state.records : [];
    this.records = records.map((r) =>
      screenshotRecordFromDict(r as Record<string, unknown>),
    );
  }
}

/** Quote a CSV cell if it contains a comma, quote or newline. */
function csvCell(value: string): string {
  if (/[",\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}
