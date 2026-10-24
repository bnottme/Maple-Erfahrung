/**
 * MapleStory-themed UI controller. Builds the HUD once, then re-renders from
 * SessionView whenever the session emits. Framework-free: all computation lives
 * in the engine; this layer only formats and displays.
 */

import { WINDOW_CHOICES_MINUTES } from "../core/calculations.js";
import type { RegionSet } from "../core/models.js";
import type { OcrEngine } from "../services/ocr.js";
import type { SessionView, TrackerSession } from "../app/session.js";
import { clear, h } from "./dom.js";
import {
  fmtDateTime,
  fmtDuration,
  fmtEta,
  fmtInt,
  fmtPercent,
  fromDateTimeLocal,
  toDateTimeLocal,
} from "./format.js";
import { openRegionPicker } from "./regionPicker.js";

/** Resolve a static asset path under the app base URL. */
function assetUrl(path: string): string {
  return `${import.meta.env.BASE_URL}${path}`;
}

export class TrackerUI {
  private view: SessionView;
  private refs: Record<string, HTMLElement> = {};
  private fileInput!: HTMLInputElement;

  constructor(
    private readonly root: HTMLElement,
    private readonly session: TrackerSession,
    private readonly engine: OcrEngine,
  ) {
    this.view = session.getView();
  }

  mount(): void {
    this.build();
    this.session.subscribe((view) => this.render(view));
    this.render(this.session.getView());
  }

  // ------------------------------------------------------------------ build
  private build(): void {
    clear(this.root);

    this.fileInput = h("input", {
      type: "file",
      accept: "image/png,image/jpeg,image/webp,image/bmp",
      multiple: "true",
      style: "display:none;",
      onchange: () => {
        const files = this.fileInput.files;
        if (files && files.length) {
          void this.handleFiles(Array.from(files));
        }
        this.fileInput.value = "";
      },
    }) as HTMLInputElement;

    this.root.append(
      this.fileInput,
      this.buildBanner(),
      h("div", { class: "ms-row" }, [this.buildCharWindow(), this.buildUploadWindow()]),
      h("div", { class: "ms-row" }, [this.buildSessionWindow(), this.buildWindowPanel()]),
      this.buildGoalWindow(),
      this.buildRecordsWindow(),
      this.buildExpBar(),
    );
  }

  private buildBanner(): HTMLElement {
    const slime = h("img", {
      class: "ms-banner-slime",
      src: assetUrl("assets/slime.png"),
      alt: "",
    }) as HTMLImageElement;
    slime.addEventListener("error", () => slime.remove());

    return h("div", { class: "ms-banner" }, [
      slime,
      h("div", { class: "ms-banner-text" }, [
        h("span", { class: "ms-logo", html: 'Maple <span class="accent">Erfahrung</span>' }),
        h("div", { class: "ms-banner-sub", text: "EXP & Meso Tracker" }),
      ]),
      this.buildThemeToggle(),
    ]);
  }

  private buildThemeToggle(): HTMLElement {
    const btn = h("button", {
      class: "ms-theme-toggle",
      type: "button",
      title: "Toggle dark mode",
    });
    const sync = () => {
      const dark = document.documentElement.getAttribute("data-theme") === "dark";
      btn.textContent = dark ? "Light mode" : "Dark mode";
    };
    btn.addEventListener("click", () => {
      const dark = document.documentElement.getAttribute("data-theme") === "dark";
      if (dark) {
        document.documentElement.removeAttribute("data-theme");
      } else {
        document.documentElement.setAttribute("data-theme", "dark");
      }
      try {
        localStorage.setItem("theme", dark ? "light" : "dark");
      } catch {
        /* storage may be unavailable; theme still applies for the session */
      }
      sync();
    });
    sync();
    return btn;
  }

  private window(title: string, body: HTMLElement, extraClass = ""): HTMLElement {
    return h("div", { class: `ms-window ${extraClass}` }, [
      h("div", { class: "ms-window-title" }, [
        h("span", { text: title }),
        h("span", { class: "nub" }),
      ]),
      body,
    ]);
  }

  private buildCharWindow(): HTMLElement {
    this.refs.charName = h("div", { class: "ms-char-name", text: "-" });
    this.refs.charSub = h("div", { class: "ms-char-sub" });

    // Portrait sprite. Lights up when public/assets/portrait.png exists; until
    // then the img quietly removes itself leaving a clean tile.
    const portrait = h("div", { class: "ms-char-portrait" });
    const portraitImg = h("img", {
      alt: "",
      src: assetUrl("assets/portrait.png"),
    }) as HTMLImageElement;
    portraitImg.addEventListener("error", () => portraitImg.remove());
    portrait.append(portraitImg);

    const body = h("div", { class: "ms-window-body" }, [
      h("div", { class: "ms-char" }, [
        portrait,
        h("div", {}, [this.refs.charName, this.refs.charSub]),
      ]),
    ]);
    return this.window("Character", body);
  }

  private buildUploadWindow(): HTMLElement {
    const drop = h("div", { class: "ms-drop" }, [
      h("div", { html: "<strong>Drop screenshots here</strong>" }),
      h("div", { text: "or click to choose files" }),
    ]);
    drop.addEventListener("click", () => this.fileInput.click());
    drop.addEventListener("dragover", (ev) => {
      ev.preventDefault();
      drop.classList.add("drag");
    });
    drop.addEventListener("dragleave", () => drop.classList.remove("drag"));
    drop.addEventListener("drop", (ev) => {
      ev.preventDefault();
      drop.classList.remove("drag");
      const files = ev.dataTransfer?.files;
      if (files && files.length) {
        void this.handleFiles(Array.from(files).filter((f) => f.type.startsWith("image/")));
      }
    });

    this.refs.status = h("div", { class: "ms-status" });

    const body = h("div", { class: "ms-window-body" }, [
      drop,
      h("div", { class: "ms-controls", style: "margin-top:12px;" }, [
        h("button", {
          class: "ms-btn secondary",
          text: "Set Up Reading Areas",
          onclick: () => void this.openPicker(),
        }),
        h("button", {
          class: "ms-btn secondary",
          text: "Export CSV",
          onclick: () => this.exportCsv(),
        }),
        h("button", {
          class: "ms-btn danger",
          text: "Reset",
          onclick: () => this.confirmReset(),
        }),
      ]),
      this.refs.status,
    ]);
    return this.window("Screenshots", body);
  }

  private statTile(key: string, label: string): HTMLElement {
    const value = h("div", { class: "ms-stat-value", text: "-" });
    this.refs[key] = value;
    return h("div", { class: "ms-stat" }, [
      h("div", { class: "ms-stat-label", text: label }),
      value,
    ]);
  }

  private buildSessionWindow(): HTMLElement {
    const body = h("div", { class: "ms-window-body" }, [
      h("div", { class: "ms-stat-grid" }, [
        this.statTile("screenshots", "Screenshots"),
        this.statTile("elapsed", "Elapsed"),
        this.statTile("expGained", "EXP Gained"),
        this.statTile("expPerHour", "EXP / Hour"),
        this.statTile("mesoCurrent", "Current Meso"),
        this.statTile("mesoGained", "Meso Gained"),
        this.statTile("lastPercent", "Last EXP %"),
        this.statTile("lastShot", "Last Shot"),
      ]),
    ]);
    return this.window("Live Stats", body);
  }

  private buildWindowPanel(): HTMLElement {
    this.refs.winCaption = h("div", { class: "ms-stat-label", text: "EXP in 15 min" });
    const stepper = h("div", { class: "ms-stepper" }, [
      h("button", { text: "\u2212", onclick: () => this.stepWindow(-1) }),
      (this.refs.winMinutes = h("span", { class: "val", text: "15m" })),
      h("button", { text: "+", onclick: () => this.stepWindow(1) }),
    ]);

    const expTile = h("div", { class: "ms-stat" }, [
      this.refs.winCaption,
      (this.refs.winExp = h("div", { class: "ms-stat-value", text: "-" })),
    ]);

    const body = h("div", { class: "ms-window-body" }, [
      h("div", { class: "ms-inline", style: "margin-bottom:10px;" }, [
        h("span", { class: "ms-stat-label", text: "Rate window" }),
        stepper,
      ]),
      h("div", { class: "ms-stat-grid" }, [
        expTile,
        this.statTile("winRate", "EXP / Hour"),
        this.statTile("winEta", "Time to Level"),
        this.statTile("winShots", "Shots in Window"),
      ]),
    ]);
    return this.window("Rate Window", body);
  }

  private buildGoalWindow(): HTMLElement {
    const levelInput = h("input", {
      type: "number",
      min: "1",
      max: "100",
      value: "100",
      style: "width:70px;",
      onchange: () => {
        const v = Number((levelInput as HTMLInputElement).value);
        if (Number.isFinite(v)) {
          this.session.setDesiredLevel(Math.max(1, Math.min(100, Math.trunc(v))));
        }
      },
    }) as HTMLInputElement;
    this.refs.desiredLevel = levelInput;

    const body = h("div", { class: "ms-window-body" }, [
      h("div", { class: "ms-inline", style: "margin-bottom:12px;" }, [
        h("span", { class: "ms-stat-label", text: "Desired level" }),
        levelInput,
      ]),
      h("div", { class: "ms-stat-grid" }, [
        this.statTile("goalExp", "EXP to Goal"),
        this.statTile("goalEta", "Time to Goal"),
        this.statTile("capExp", "EXP to Level 100"),
        this.statTile("goalReached", "Status"),
      ]),
    ]);
    return this.window("Level Goal", body);
  }

  private buildRecordsWindow(): HTMLElement {
    this.refs.tbody = h("tbody");
    const table = h("table", { class: "ms-table" }, [
      h("thead", {}, [
        h("tr", {}, [
          h("th", { text: "Time" }),
          h("th", { text: "File" }),
          h("th", { text: "Level" }),
          h("th", { text: "EXP" }),
          h("th", { text: "%" }),
          h("th", { text: "Meso" }),
          h("th", { text: "Name" }),
          h("th", { text: "" }),
        ]),
      ]),
      this.refs.tbody,
    ]);
    const body = h("div", { class: "ms-window-body" }, [
      h("div", { class: "ms-table-wrap" }, [table]),
    ]);
    return this.window("Captured Screenshots", body);
  }

  private buildExpBar(): HTMLElement {
    this.refs.levelBadge = h("div", { class: "ms-level-badge", text: "Lv. -" });
    this.refs.expFill = h("div", { class: "ms-expbar-fill" });
    this.refs.expText = h("div", { class: "ms-expbar-text", text: "-" });
    this.refs.expSide = h("div", { class: "ms-expbar-side", text: "" });
    return h("div", { class: "ms-expbar" }, [
      this.refs.levelBadge,
      h("div", { class: "ms-expbar-track" }, [this.refs.expFill, this.refs.expText]),
      this.refs.expSide,
    ]);
  }

  // ----------------------------------------------------------------- actions
  private async handleFiles(files: File[]): Promise<void> {
    if (!files.length) {
      return;
    }
    this.setStatus(`Reading ${files.length} screenshot(s)... (first run loads the reader)`, true);
    try {
      await this.session.addFiles(files);
      this.setStatus(`Added ${files.length} screenshot(s).`);
    } catch (err) {
      this.setStatus(`Could not process screenshots: ${String(err)}`);
    }
  }

  private async openPicker(): Promise<void> {
    const result = await openRegionPicker({
      engine: this.engine,
      initial: this.view.regions,
    });
    if (result) {
      this.session.setRegions(result as RegionSet);
      this.setStatus("Reading areas updated.");
    }
  }

  private stepWindow(delta: number): void {
    const next = this.view.windowIndex + delta;
    if (next >= 0 && next < WINDOW_CHOICES_MINUTES.length) {
      this.session.setWindowIndex(next);
    }
  }

  private exportCsv(): void {
    if (this.view.records.length === 0) {
      this.setStatus("No screenshots to export yet.");
      return;
    }
    const csv = this.session.exportCsv();
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = h("a", { href: url, download: "exp_meso_export.csv" }) as HTMLAnchorElement;
    a.click();
    URL.revokeObjectURL(url);
    this.setStatus(`Exported ${this.view.records.length} row(s).`);
  }

  private confirmReset(): void {
    if (confirm("Clear all captured screenshots and start over? This cannot be undone.")) {
      this.session.reset();
      this.setStatus("Session reset.");
    }
  }

  private setStatus(text: string, busy = false): void {
    const el = this.refs.status;
    el.textContent = text;
    el.classList.toggle("busy", busy);
  }

  // ----------------------------------------------------------------- render
  private render(view: SessionView): void {
    this.view = view;

    // Character.
    this.refs.charName.textContent = view.latestName ?? "Unknown Mapler";
    clear(this.refs.charSub);
    this.refs.charSub.append(
      h("span", { text: `Level ${view.latestLevel ?? "-"}` }),
      h("span", { class: "sep", text: "\u2022" }),
      h("span", { class: "ms-meso" }, [
        h("span", { class: "ms-coin" }),
        h("span", { text: `${fmtInt(view.stats.mesoCurrent)} meso` }),
      ]),
    );

    // Session stats.
    const s = view.stats;
    this.refs.screenshots.textContent = String(s.screenshotCount);
    this.refs.elapsed.textContent = fmtDuration(s.elapsedSeconds);
    this.refs.expGained.textContent = fmtInt(s.expGained);
    this.refs.expPerHour.textContent = fmtInt(s.expPerHour);
    this.refs.mesoCurrent.textContent =
      s.mesoCurrent !== null ? fmtInt(s.mesoCurrent) : "-";
    this.refs.mesoGained.textContent = fmtInt(s.mesoGained);

    const last = view.latestRecord;
    this.refs.lastPercent.textContent =
      last && last.expPercent !== null ? fmtPercent(last.expPercent) : "-";
    this.refs.lastShot.textContent = last
      ? new Date(last.capturedAt * 1000).toLocaleTimeString([], { hour12: false })
      : "-";

    // Rolling window.
    const w = view.window;
    const mark = w.estimated ? "~" : "";
    this.refs.winCaption.textContent = `EXP in ${view.windowMinutes} min`;
    this.refs.winMinutes.textContent = `${view.windowMinutes}m`;
    if (!w.hasData) {
      this.refs.winExp.textContent = "-";
      this.refs.winRate.textContent = "-";
      this.refs.winEta.textContent = "-";
    } else {
      this.refs.winExp.textContent = mark + fmtInt(w.expGained);
      this.refs.winRate.textContent = mark + fmtInt(w.expPerHour);
      const eta = fmtEta(w.etaSeconds);
      this.refs.winEta.textContent = w.estimated && eta !== "-" ? mark + eta : eta;
    }
    this.refs.winShots.textContent = String(w.screenshotCount);
    this.refs.winExp.classList.toggle("est", w.estimated);
    this.refs.winRate.classList.toggle("est", w.estimated);

    // Level goal.
    const g = view.goal;
    if ((this.refs.desiredLevel as HTMLInputElement).value !== String(view.desiredLevel)) {
      (this.refs.desiredLevel as HTMLInputElement).value = String(view.desiredLevel);
    }
    this.refs.goalExp.textContent = g.goalRemaining !== null ? fmtInt(g.goalRemaining) : "-";
    this.refs.capExp.textContent = g.capRemaining !== null ? fmtInt(g.capRemaining) : "-";
    this.refs.goalEta.textContent = g.reached ? "reached" : fmtEta(g.goalEtaSeconds);
    this.refs.goalReached.textContent = g.reached
      ? "Reached"
      : g.goalRemaining !== null
        ? "In progress"
        : "-";

    // EXP bar.
    this.refs.levelBadge.textContent = `Lv. ${view.latestLevel ?? "-"}`;
    const pct = last && last.expPercent !== null ? last.expPercent : 0;
    this.refs.expFill.style.width = `${Math.max(0, Math.min(100, pct))}%`;
    this.refs.expText.textContent =
      last && last.expPercent !== null ? fmtPercent(last.expPercent) : "no data yet";
    const sideBits: string[] = [];
    if (w.hasData) {
      sideBits.push(`${mark}${fmtInt(w.expPerHour)}/hr`);
      const eta = fmtEta(w.etaSeconds);
      if (eta !== "-") {
        sideBits.push(`next lv ${w.estimated ? mark : ""}${eta}`);
      }
    }
    this.refs.expSide.textContent = sideBits.join("   ");

    // Records table.
    this.renderRecords(view);
  }

  private renderRecords(view: SessionView): void {
    const tbody = this.refs.tbody;
    clear(tbody);
    if (view.records.length === 0) {
      const emptyImg = h("img", {
        class: "ms-empty-img",
        src: assetUrl("assets/octopus.png"),
        alt: "",
      }) as HTMLImageElement;
      emptyImg.addEventListener("error", () => emptyImg.remove());
      tbody.append(
        h("tr", {}, [
          h("td", { class: "ms-empty", colspan: "8" }, [
            emptyImg,
            h("div", { text: "No screenshots yet. Drop some in above." }),
          ]),
        ]),
      );
      return;
    }
    for (const rec of view.records) {
      const timeInput = h("input", {
        type: "datetime-local",
        step: "1",
        value: toDateTimeLocal(rec.capturedAt),
        title: fmtDateTime(rec.capturedAt),
        onchange: (ev: Event) => {
          const secs = fromDateTimeLocal((ev.target as HTMLInputElement).value);
          if (secs !== null) {
            this.session.updateRecord(rec.id, { capturedAt: secs });
          }
        },
      });
      tbody.append(
        h("tr", {}, [
          h("td", {}, [timeInput]),
          h("td", { text: rec.fileName }),
          h("td", {}, [this.numCell(rec.id, "level", rec.level)]),
          h("td", {}, [this.numCell(rec.id, "exp", rec.exp)]),
          h("td", { text: rec.expPercent !== null ? rec.expPercent.toFixed(2) : "" }),
          h("td", {}, [this.numCell(rec.id, "meso", rec.meso)]),
          h("td", {}, [this.textCell(rec.id, rec.characterName)]),
          h("td", {}, [
            h("button", {
              class: "ms-del",
              text: "\u00d7",
              title: "Remove",
              onclick: () => this.session.removeRecord(rec.id),
            }),
          ]),
        ]),
      );
    }
  }

  private numCell(
    id: string,
    field: "level" | "exp" | "meso",
    value: number | null,
  ): HTMLElement {
    return h("input", {
      type: "text",
      inputmode: "numeric",
      value: value !== null ? String(value) : "",
      onchange: (ev: Event) => {
        const raw = (ev.target as HTMLInputElement).value.replace(/[^\d]/g, "");
        this.session.updateRecord(id, { [field]: raw === "" ? null : Number(raw) });
      },
    });
  }

  private textCell(id: string, value: string | null): HTMLElement {
    return h("input", {
      type: "text",
      value: value ?? "",
      onchange: (ev: Event) => {
        const v = (ev.target as HTMLInputElement).value.trim();
        this.session.updateRecord(id, { characterName: v === "" ? null : v });
      },
    });
  }
}
