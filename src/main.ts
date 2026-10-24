/**
 * Entry point. Wires the OCR engine and headless TrackerSession to the
 * MapleStory-themed UI, restores saved state, and flushes on page unload.
 */

import "./ui/theme.css";

import { TrackerSession } from "./app/session.js";
import { RapidOcrEngine } from "./services/rapidOcrEngine.js";
import { TrackerUI } from "./ui/app.js";

async function bootstrap(): Promise<void> {
  // RapidOCR (PP-OCRv3) - same recognizer as the desktop app, strong on small
  // stylized game text. Runs fully in-browser via onnxruntime-web.
  const engine = new RapidOcrEngine();
  const session = new TrackerSession(engine);

  const root = document.getElementById("app");
  if (!root) {
    throw new Error("Missing #app root element");
  }
  root.classList.add("ms-app");

  const ui = new TrackerUI(root, session, engine);
  ui.mount();

  const result = await session.load();
  if (result.error) {
    console.warn("state_load_failed", result.error.message);
  }

  // Persist in-flight state when the tab is closed or hidden.
  window.addEventListener("beforeunload", () => void session.flush());
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      void session.flush();
    }
  });

  // Expose for manual testing from the console (temporary).
  (window as unknown as { tracker: TrackerSession }).tracker = session;
  console.info("tracker_ready");
}

void bootstrap();
