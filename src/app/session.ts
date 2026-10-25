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
import { resolveCaptureTimeWithSource } from "../core/time.js";
import { itemById } from "../data/items.js";
import { loadImage } from "../services/image.js";
import { extractValues, type OcrEngine } from "../services/ocr.js";
import {
  DebouncedSaver,
  loadSessions,
  loadState,
  saveSessions,
  type StorageError,
} from "../services/storage.js";

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

/** One consumable line the user is tracking spend for. */
export interface ConsumableLine {
  itemId: string;
  quantity: number;
}

/** Compact summary stored with a saved grind (for lists + dashboard). */
export interface SavedSessionSummary {
  screenshotCount: number;
  elapsedSeconds: number;
  expGained: number;
  expPerHour: number;
  mesoGained: number;
  mesoSpent: number;
  netMeso: number;
  characterName: string | null;
  level: number | null;
  /** Map the grind took place on (free text / from the map DB), or null. */
  currentMapName: string | null;
}

/** A saved grind the user can revisit or reload. */
export interface SavedSession {
  id: string;
  name: string;
  savedAt: number; // epoch seconds
  summary: SavedSessionSummary;
  records: ScreenshotRecord[];
  consumables: ConsumableLine[];
  /** Free-text note / tag (e.g. "2x EXP event"). */
  note: string;
}

/** A full snapshot the UI can render from in one go. */
export interface SessionView {
  records: ScreenshotRecord[];
  regions: RegionSet;
  desiredLevel: number;
  /** Map the user is currently grinding on, or null. */
  currentMapName: string | null;
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
  /** Consumables the user logged (item id + quantity used this session). */
  consumables: ConsumableLine[];
  /** Total meso spent on the logged consumables. */
  mesoSpent: number;
  /** Meso gained minus meso spent on consumables. */
  netMeso: number;
  /** Saved grinds, newest first. */
  savedSessions: SavedSession[];
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
  /** Map the user is grinding on this session (name from the map DB). */
  private currentMapName: string | null = null;
  /** itemId -> quantity used this session. */
  private consumables = new Map<string, number>();
  /** Saved grinds, newest first. */
  private savedSessions: SavedSession[] = [];

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
    // Spacing for images with no real timestamp (bitmaps pasted from a snip
    // tool). Keeps a batch / successive pastes in order instead of colliding
    // at the same instant; the user can still fine-tune times per record.
    const FALLBACK_GAP = 60;
    let fallbackCursor = this.records.reduce((m, r) => Math.max(m, r.capturedAt), 0);
    for (const file of files) {
      const { capturedAt: resolved, source } = resolveCaptureTimeWithSource(file);
      let capturedAt: number;
      if (source === "now") {
        capturedAt = Math.max(fallbackCursor + FALLBACK_GAP, resolved);
        fallbackCursor = capturedAt;
      } else {
        capturedAt = resolved;
        fallbackCursor = Math.max(fallbackCursor, resolved);
      }
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

  /** Set the map being grinded (null clears it). */
  setCurrentMapName(name: string | null): void {
    const next = name && name.trim() ? name.trim() : null;
    if (next === this.currentMapName) {
      return;
    }
    this.currentMapName = next;
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

  /** Set how many of an item were used this session (0 removes the line). */
  setConsumable(itemId: string, quantity: number): void {
    const q = Math.max(0, Math.floor(quantity));
    if (q <= 0) {
      this.consumables.delete(itemId);
    } else {
      this.consumables.set(itemId, q);
    }
    this.scheduleSave();
    this.emit();
  }

  removeConsumable(itemId: string): void {
    if (this.consumables.delete(itemId)) {
      this.scheduleSave();
      this.emit();
    }
  }

  private computeMesoSpent(): number {
    let total = 0;
    for (const [id, qty] of this.consumables) {
      const item = itemById(id);
      if (item && item.mesoCost !== null) {
        total += item.mesoCost * qty;
      }
    }
    return total;
  }

  reset(): void {
    this.records = [];
    this.sessionStart = null;
    this.tracking = false;
    this.consumables.clear();
    this.currentMapName = null;
    this.scheduleSave();
    this.emit();
  }

  // --------------------------------------------------------- saved sessions
  /** Snapshot the current grind as a named saved session (newest first). */
  saveCurrentSession(name: string): SavedSession {
    const stats = this.getStats();
    const mesoSpent = this.computeMesoSpent();
    const saved: SavedSession = {
      id: newId(),
      name: name.trim() || this.defaultSessionName(),
      savedAt: Date.now() / 1000,
      summary: {
        screenshotCount: stats.screenshotCount,
        elapsedSeconds: stats.elapsedSeconds,
        expGained: stats.expGained,
        expPerHour: stats.expPerHour,
        mesoGained: stats.mesoGained,
        mesoSpent,
        netMeso: stats.mesoGained - mesoSpent,
        characterName: this.latestValue("characterName"),
        level: this.latestValue("level"),
        currentMapName: this.currentMapName,
      },
      records: this.records.map((r) => ({ ...r })),
      consumables: [...this.consumables.entries()].map(([itemId, quantity]) => ({
        itemId,
        quantity,
      })),
      note: "",
    };
    this.savedSessions.unshift(saved);
    void this.persistSessions();
    this.emit();
    return saved;
  }

  deleteSavedSession(id: string): void {
    const before = this.savedSessions.length;
    this.savedSessions = this.savedSessions.filter((s) => s.id !== id);
    if (this.savedSessions.length !== before) {
      void this.persistSessions();
      this.emit();
    }
  }

  /** Set the free-text note/tag on a saved session. */
  setSessionNote(id: string, note: string): void {
    const s = this.savedSessions.find((x) => x.id === id);
    if (!s) return;
    s.note = note.trim();
    void this.persistSessions();
    this.emit();
  }

  /** Replace the current live grind with a saved one. */
  loadSavedSession(id: string): void {
    const s = this.savedSessions.find((x) => x.id === id);
    if (!s) {
      return;
    }
    this.records = s.records.map((r) => ({ ...r }));
    this.consumables = new Map(s.consumables.map((c) => [c.itemId, c.quantity]));
    this.currentMapName = s.summary.currentMapName;
    this.scheduleSave();
    this.emit();
  }

  private defaultSessionName(): string {
    const name = this.latestValue("characterName");
    const when = new Date().toLocaleDateString();
    return name ? `${name} - ${when}` : `Grind - ${when}`;
  }

  private async persistSessions(): Promise<void> {
    try {
      await saveSessions(this.savedSessions.map(savedSessionToDict));
    } catch {
      /* storage may be unavailable; keep working in-memory */
    }
  }

  /** Serialize all saved grinds to a JSON backup string. */
  exportSessionsJson(): string {
    return JSON.stringify(
      {
        app: "maple-erfahrung",
        kind: "sessions-backup",
        version: 1,
        exportedAt: new Date().toISOString(),
        sessions: this.savedSessions.map(savedSessionToDict),
      },
      null,
      2,
    );
  }

  /**
   * Merge saved grinds from a JSON backup. New ids are appended (existing ones
   * are skipped so re-importing is safe). Returns how many were added.
   */
  importSessionsJson(text: string): { added: number; error?: string } {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return { added: 0, error: "That file isn't valid JSON." };
    }
    const root = parsed as Record<string, unknown>;
    const rawList = Array.isArray(parsed)
      ? parsed
      : Array.isArray(root?.sessions)
        ? (root.sessions as unknown[])
        : null;
    if (!rawList) {
      return { added: 0, error: "No sessions found in that file." };
    }

    const existing = new Set(this.savedSessions.map((s) => s.id));
    let added = 0;
    for (const raw of rawList) {
      if (!raw || typeof raw !== "object") continue;
      try {
        const session = savedSessionFromDict(raw as Record<string, unknown>);
        if (existing.has(session.id)) continue;
        this.savedSessions.push(session);
        existing.add(session.id);
        added++;
      } catch {
        /* skip malformed entries */
      }
    }
    if (added > 0) {
      this.savedSessions.sort((a, b) => b.savedAt - a.savedAt);
      void this.persistSessions();
      this.emit();
    }
    return { added };
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
    const stats = this.getStats();
    const mesoSpent = this.computeMesoSpent();
    return {
      records: [...this.records].sort((a, b) => a.capturedAt - b.capturedAt),
      regions: { ...this.regions },
      desiredLevel: this.desiredLevel,
      currentMapName: this.currentMapName,
      windowIndex: this.windowIndex,
      windowMinutes: WINDOW_CHOICES_MINUTES[this.windowIndex],
      tracking: this.tracking,
      sessionStart: this.sessionStart,
      stats,
      window: this.getWindowStats(),
      goal: this.getGoalStats(),
      latestName: this.latestValue("characterName"),
      latestLevel: this.latestValue("level"),
      latestRecord: this.latestRecord(),
      consumables: [...this.consumables.entries()].map(([itemId, quantity]) => ({
        itemId,
        quantity,
      })),
      mesoSpent,
      netMeso: stats.mesoGained - mesoSpent,
      savedSessions: this.savedSessions.map((s) => ({ ...s })),
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
      currentMapName: this.currentMapName,
      regions: {
        exp: this.regions.exp ? regionToDict(this.regions.exp) : null,
        meso: this.regions.meso ? regionToDict(this.regions.meso) : null,
        level: this.regions.level ? regionToDict(this.regions.level) : null,
        name: this.regions.name ? regionToDict(this.regions.name) : null,
      },
      records: this.records.map(screenshotRecordToDict),
      consumables: Object.fromEntries(this.consumables),
    };
  }

  /**
   * Restore state from IndexedDB. Returns true if state was loaded. A corrupt
   * store is surfaced via the returned StorageError so the UI can warn the user
   * rather than silently wiping their history.
   */
  async load(): Promise<{ loaded: boolean; error?: StorageError }> {
    // Saved grinds load independently of the live state.
    try {
      const rawSessions = await loadSessions();
      this.savedSessions = rawSessions.map((r) =>
        savedSessionFromDict(r as Record<string, unknown>),
      );
    } catch {
      /* ignore unreadable sessions list */
    }

    let state: Record<string, unknown> | null;
    try {
      state = await loadState();
    } catch (err) {
      this.emit();
      return { loaded: false, error: err as StorageError };
    }
    if (!state) {
      this.emit();
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
    this.currentMapName =
      typeof state.currentMapName === "string" && state.currentMapName
        ? state.currentMapName
        : null;

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

    this.consumables = new Map();
    const cons = state.consumables;
    if (cons && typeof cons === "object") {
      for (const [id, qty] of Object.entries(cons as Record<string, unknown>)) {
        const q = Math.floor(Number(qty));
        if (Number.isFinite(q) && q > 0) {
          this.consumables.set(id, q);
        }
      }
    }
  }
}

function savedSessionToDict(s: SavedSession): Record<string, unknown> {
  return {
    id: s.id,
    name: s.name,
    savedAt: s.savedAt,
    summary: s.summary,
    records: s.records.map(screenshotRecordToDict),
    consumables: s.consumables,
    note: s.note,
  };
}

function savedSessionFromDict(d: Record<string, unknown>): SavedSession {
  const sum = (d.summary ?? {}) as Record<string, unknown>;
  const num = (v: unknown): number => (Number.isFinite(Number(v)) ? Number(v) : 0);
  const records = Array.isArray(d.records) ? d.records : [];
  const cons = Array.isArray(d.consumables) ? d.consumables : [];
  return {
    id: String(d.id),
    name: String(d.name ?? "Grind"),
    savedAt: num(d.savedAt) || Date.now() / 1000,
    summary: {
      screenshotCount: num(sum.screenshotCount),
      elapsedSeconds: num(sum.elapsedSeconds),
      expGained: num(sum.expGained),
      expPerHour: num(sum.expPerHour),
      mesoGained: num(sum.mesoGained),
      mesoSpent: num(sum.mesoSpent),
      netMeso: num(sum.netMeso),
      characterName: (sum.characterName as string) || null,
      level: sum.level === null || sum.level === undefined ? null : num(sum.level),
      currentMapName: (sum.currentMapName as string) || null,
    },
    records: records.map((r) => screenshotRecordFromDict(r as Record<string, unknown>)),
    consumables: cons.map((c) => {
      const cc = c as Record<string, unknown>;
      return { itemId: String(cc.itemId), quantity: num(cc.quantity) };
    }),
    note: typeof d.note === "string" ? d.note : "",
  };
}

/** Quote a CSV cell if it contains a comma, quote or newline. */
function csvCell(value: string): string {
  if (/[",\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}
