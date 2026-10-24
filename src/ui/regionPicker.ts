/**
 * Region picker modal - the browser equivalent of the desktop "Set Up Areas on
 * a Screenshot" dialog.
 *
 * The user picks a screenshot, selects a field (EXP / Meso / Level / Name), and
 * drags a box over that value. Boxes are stored as fractional regions (0-1), so
 * they keep working at any resolution. "Test read" runs the real OCR pipeline
 * on the chosen image so the user can confirm the boxes before saving.
 */

import {
  emptyRegionSet,
  type Region,
  type RegionSet,
} from "../core/models.js";
import { loadImage } from "../services/image.js";
import { extractValues, type OcrEngine } from "../services/ocr.js";
import { clear, h } from "./dom.js";
import { fmtPercent } from "./format.js";

interface FieldDef {
  key: keyof RegionSet;
  label: string;
  color: string;
}

const FIELDS: FieldDef[] = [
  { key: "exp", label: "EXP", color: "#f57c00" },
  { key: "meso", label: "Meso", color: "#e8a200" },
  { key: "level", label: "Level", color: "#2f6aa8" },
  { key: "name", label: "Name", color: "#4f8a3d" },
];

export interface RegionPickerOptions {
  engine: OcrEngine;
  initial: RegionSet;
}

/**
 * Open the region picker. Resolves with the new RegionSet on save, or null if
 * the user cancels.
 */
export function openRegionPicker(options: RegionPickerOptions): Promise<RegionSet | null> {
  return new Promise((resolve) => {
    const regions: RegionSet = { ...options.initial };
    let activeField: keyof RegionSet = "exp";
    let currentFile: File | null = null;
    let objectUrl: string | null = null;

    // --- elements --------------------------------------------------------
    const fileInput = h("input", {
      type: "file",
      accept: "image/png,image/jpeg,image/webp,image/bmp",
    }) as HTMLInputElement;

    const img = h("img", { alt: "screenshot" }) as HTMLImageElement;
    const boxLayer = h("div", {
      style: "position:absolute;inset:0;",
    });
    const stage = h("div", { class: "ms-picker-stage" }, [img, boxLayer]);
    const scrollWrap = h("div", { class: "ms-picker-scroll" }, [stage]);
    scrollWrap.style.display = "none";

    // Zoom so tiny HUD values are easy to box. Stage width scales; the scroll
    // container lets the user pan to the area they want.
    let zoom = 1;
    const zoomReadout = h("span", { class: "ms-zoom-val", text: "100%" });
    function applyZoom(): void {
      stage.style.width = `${zoom * 100}%`;
      zoomReadout.textContent = `${Math.round(zoom * 100)}%`;
    }
    function setZoom(z: number): void {
      zoom = Math.min(5, Math.max(1, Math.round(z * 2) / 2));
      applyZoom();
    }
    const zoomRow = h("div", { class: "ms-zoom-row" }, [
      h("span", { class: "ms-zoom-label", text: "Zoom" }),
      h("button", { class: "ms-btn secondary", type: "button", text: "\u2212", onclick: () => setZoom(zoom - 0.5) }),
      zoomReadout,
      h("button", { class: "ms-btn secondary", type: "button", text: "+", onclick: () => setZoom(zoom + 0.5) }),
      h("button", { class: "ms-btn secondary", type: "button", text: "Fit", onclick: () => setZoom(1) }),
    ]);
    zoomRow.style.display = "none";

    const tabs = h("div", { class: "ms-field-tabs" });
    const hint = h("div", {
      class: "ms-picker-hint",
      text: "Choose a screenshot, pick a field below, then drag a box over that value.",
    });
    const testOut = h("div", { class: "ms-test-out" });
    testOut.style.display = "none";

    const testBtn = h("button", {
      class: "ms-btn secondary",
      text: "Test read",
      disabled: "true",
    }) as HTMLButtonElement;
    const clearBtn = h("button", { class: "ms-btn secondary", text: "Clear all boxes" });
    const saveBtn = h("button", { class: "ms-btn", text: "Save areas" });
    const cancelBtn = h("button", { class: "ms-btn danger", text: "Cancel" });

    // --- field tabs ------------------------------------------------------
    function renderTabs(): void {
      clear(tabs);
      for (const field of FIELDS) {
        const isActive = field.key === activeField;
        const hasBox = regions[field.key] !== null;
        const tab = h("button", {
          class: `ms-field-tab${isActive ? " active" : ""}`,
          style: isActive ? `background:${field.color};border-color:${field.color};` : "",
          text: `${field.label}${hasBox ? " \u2022" : ""}`,
          onclick: () => {
            activeField = field.key;
            renderTabs();
          },
        });
        tabs.append(tab);
      }
    }

    // --- box overlay -----------------------------------------------------
    function renderBoxes(): void {
      clear(boxLayer);
      for (const field of FIELDS) {
        const region = regions[field.key];
        if (!region) {
          continue;
        }
        const box = h("div", {
          class: "ms-region-box",
          style:
            `border-color:${field.color};` +
            `left:${region.left * 100}%;top:${region.top * 100}%;` +
            `width:${(region.right - region.left) * 100}%;` +
            `height:${(region.bottom - region.top) * 100}%;`,
        });
        const label = h("div", {
          class: "ms-region-label",
          style: `background:${field.color};`,
          text: field.label,
        });
        box.append(label);
        boxLayer.append(box);
      }
    }

    // --- drawing ---------------------------------------------------------
    let dragging = false;
    let startX = 0;
    let startY = 0;

    function fractionFromEvent(ev: PointerEvent): { x: number; y: number } {
      const rect = img.getBoundingClientRect();
      const x = (ev.clientX - rect.left) / rect.width;
      const y = (ev.clientY - rect.top) / rect.height;
      return { x: clamp01(x), y: clamp01(y) };
    }

    stage.addEventListener("pointerdown", (ev) => {
      if (!currentFile) {
        return;
      }
      const p = fractionFromEvent(ev as PointerEvent);
      dragging = true;
      startX = p.x;
      startY = p.y;
      stage.setPointerCapture((ev as PointerEvent).pointerId);
    });

    stage.addEventListener("pointermove", (ev) => {
      if (!dragging) {
        return;
      }
      const p = fractionFromEvent(ev as PointerEvent);
      regions[activeField] = normalizeRegion(startX, startY, p.x, p.y);
      renderBoxes();
    });

    function endDrag(ev: PointerEvent): void {
      if (!dragging) {
        return;
      }
      dragging = false;
      const p = fractionFromEvent(ev);
      const region = normalizeRegion(startX, startY, p.x, p.y);
      // Ignore accidental tiny boxes (a click rather than a drag).
      if (region.right - region.left < 0.01 || region.bottom - region.top < 0.01) {
        regions[activeField] = options.initial[activeField] ?? null;
      } else {
        regions[activeField] = region;
      }
      renderBoxes();
      renderTabs();
    }

    stage.addEventListener("pointerup", (ev) => endDrag(ev as PointerEvent));
    stage.addEventListener("pointercancel", (ev) => endDrag(ev as PointerEvent));

    // --- file selection --------------------------------------------------
    fileInput.addEventListener("change", () => {
      const file = fileInput.files?.[0];
      if (!file) {
        return;
      }
      currentFile = file;
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
      objectUrl = URL.createObjectURL(file);
      img.src = objectUrl;
      img.onload = () => {
        scrollWrap.style.display = "block";
        zoomRow.style.display = "flex";
        setZoom(1);
        renderBoxes();
      };
      testBtn.disabled = false;
    });

    // --- test read -------------------------------------------------------
    testBtn.addEventListener("click", async () => {
      if (!currentFile) {
        return;
      }
      testOut.style.display = "block";
      testOut.textContent = "Reading the screenshot (first run can take a moment)...";
      try {
        const image = await loadImage(currentFile);
        const result = await extractValues(options.engine, image, regions);
        image.bitmap.close();
        testOut.textContent =
          `Character:  ${result.characterName ?? "not found"}\n` +
          `Level:      ${result.level ?? "not found"}\n` +
          `EXP:        ${result.exp ?? "not found"}\n` +
          `EXP %:      ${result.expPercent !== null ? fmtPercent(result.expPercent) : "not found"}\n` +
          `Meso:       ${result.meso ?? "not found"}`;
      } catch (err) {
        testOut.textContent = `Could not read that image: ${String(err)}`;
      }
    });

    clearBtn.addEventListener("click", () => {
      regions.exp = null;
      regions.meso = null;
      regions.level = null;
      regions.name = null;
      renderBoxes();
      renderTabs();
    });

    // --- close helpers ---------------------------------------------------
    const overlay = h("div", { class: "ms-modal-overlay" });

    function close(result: RegionSet | null): void {
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
      overlay.remove();
      resolve(result);
    }

    saveBtn.addEventListener("click", () => close(regions));
    cancelBtn.addEventListener("click", () => close(null));
    overlay.addEventListener("click", (ev) => {
      if (ev.target === overlay) {
        close(null);
      }
    });

    // --- assemble --------------------------------------------------------
    const body = h("div", { class: "ms-window-body" }, [
      h("div", { class: "ms-controls", style: "margin-bottom:10px;" }, [
        fileInput,
      ]),
      hint,
      tabs,
      zoomRow,
      scrollWrap,
      testOut,
      h("div", { class: "ms-picker-actions" }, [
        clearBtn,
        testBtn,
        cancelBtn,
        saveBtn,
      ]),
    ]);

    const windowEl = h("div", { class: "ms-window ms-modal" }, [
      h("div", { class: "ms-window-title" }, [
        h("span", { text: "Set Up Reading Areas" }),
        h("span", { class: "nub" }),
      ]),
      body,
    ]);

    overlay.append(windowEl);
    document.body.append(overlay);
    renderTabs();
  });
}

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}

function normalizeRegion(x1: number, y1: number, x2: number, y2: number): Region {
  return {
    left: Math.min(x1, x2),
    top: Math.min(y1, y2),
    right: Math.max(x1, x2),
    bottom: Math.max(y1, y2),
  };
}

/** Convenience for callers that want a fresh empty set. */
export { emptyRegionSet };
