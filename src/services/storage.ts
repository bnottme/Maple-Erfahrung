/**
 * Local persistence. Browser analog of services/storage.py + the desktop
 * data-dir logic in core/config.py.
 *
 * The desktop app kept one state.json in a user folder. Here the whole tracker
 * state lives in the user's own browser (IndexedDB), so each visitor keeps
 * their own history with no server and no database on our side. No screenshots
 * are stored - only the small records (numbers, times, regions).
 *
 * As in the Python original, a corrupt/unreadable store is reported rather than
 * silently clobbered, and saving is debounced so rapid updates coalesce.
 */

const DB_NAME = "exp-meso-tracker";
const DB_VERSION = 1;
const STORE_NAME = "state";
const STATE_KEY = "singleton";

/** Raised when the persisted state exists but can't be read/parsed. */
export class StorageError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = "StorageError";
  }
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(new StorageError("Could not open IndexedDB", req.error));
  });
}

/**
 * Load the persisted state object. Returns null when nothing is stored yet.
 * Throws StorageError when something is stored but unreadable, so a caller can
 * choose to refuse to overwrite it (matching the Python load_state behaviour).
 */
export async function loadState(): Promise<Record<string, unknown> | null> {
  let db: IDBDatabase;
  try {
    db = await openDb();
  } catch (err) {
    throw err instanceof StorageError ? err : new StorageError("open failed", err);
  }
  try {
    return await new Promise<Record<string, unknown> | null>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const req = tx.objectStore(STORE_NAME).get(STATE_KEY);
      req.onsuccess = () => {
        const value = req.result;
        if (value === undefined || value === null) {
          resolve(null);
          return;
        }
        if (typeof value !== "object") {
          reject(new StorageError("Stored state is not an object"));
          return;
        }
        resolve(value as Record<string, unknown>);
      };
      req.onerror = () => reject(new StorageError("Could not read state", req.error));
    });
  } finally {
    db.close();
  }
}

/** Persist the state object, replacing any previous value. */
export async function saveState(state: Record<string, unknown>): Promise<void> {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).put(state, STATE_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(new StorageError("Could not write state", tx.error));
      tx.onabort = () => reject(new StorageError("State write aborted", tx.error));
    });
  } finally {
    db.close();
  }
}

/** Remove the persisted state entirely. */
export async function clearState(): Promise<void> {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).delete(STATE_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(new StorageError("Could not clear state", tx.error));
    });
  } finally {
    db.close();
  }
}

/**
 * Wrap a save function with debouncing + an explicit flush, mirroring the
 * desktop app's 2000 ms single-shot save timer plus synchronous save-on-quit.
 */
export class DebouncedSaver {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private pending: Record<string, unknown> | null = null;
  private inFlight: Promise<void> = Promise.resolve();

  constructor(
    private readonly delayMs: number = 2000,
    private readonly save: (state: Record<string, unknown>) => Promise<void> = saveState,
  ) {}

  /** Schedule a save of `state`, coalescing rapid calls. */
  schedule(state: Record<string, unknown>): void {
    this.pending = state;
    if (this.timer !== null) {
      clearTimeout(this.timer);
    }
    this.timer = setTimeout(() => void this.flush(), this.delayMs);
  }

  /** Write any pending state right now (e.g. on page unload). */
  async flush(): Promise<void> {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.pending === null) {
      return this.inFlight;
    }
    const state = this.pending;
    this.pending = null;
    this.inFlight = this.save(state);
    return this.inFlight;
  }
}
