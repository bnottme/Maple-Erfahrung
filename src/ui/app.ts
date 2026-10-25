/**
 * MapleStory-themed UI controller. Builds the HUD once, then re-renders from
 * SessionView whenever the session emits. Framework-free: all computation lives
 * in the engine; this layer only formats and displays.
 */

import { WINDOW_CHOICES_MINUTES } from "../core/calculations.js";
import type { RegionSet } from "../core/models.js";
import { ITEMS, itemById, type Item } from "../data/items.js";
import { MAP_REGIONS, MAPS, recommendMaps, type MapInfo } from "../data/maps.js";
import type { OcrEngine } from "../services/ocr.js";
import type { SessionView, TrackerSession } from "../app/session.js";
import { barRows, CHART_PALETTE, columnChart, donutChart, lineChart } from "./charts.js";
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

type SidebarPage = "menu" | "sessions" | "stats" | "links";

/** Themed confirm dialog (replaces window.confirm). Resolves true/false. */
function themedConfirm(opts: {
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  danger?: boolean;
}): Promise<boolean> {
  return new Promise((resolve) => {
    const overlay = h("div", { class: "ms-modal-overlay" });
    const cancelBtn = h("button", {
      class: "ms-btn secondary",
      type: "button",
      text: opts.cancelText ?? "Cancel",
    });
    const okBtn = h("button", {
      class: `ms-btn ${opts.danger ? "danger" : ""}`,
      type: "button",
      text: opts.confirmText ?? "OK",
    });
    const win = h("div", { class: "ms-window ms-dialog" }, [
      h("div", { class: "ms-window-title" }, [
        h("span", { text: opts.title }),
        h("span", { class: "nub" }),
      ]),
      h("div", { class: "ms-window-body" }, [
        h("p", { class: "ms-dialog-msg", text: opts.message }),
        h("div", { class: "ms-dialog-actions" }, [cancelBtn, okBtn]),
      ]),
    ]);
    const close = (v: boolean) => {
      document.removeEventListener("keydown", onKey);
      overlay.remove();
      resolve(v);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close(false);
      else if (e.key === "Enter") close(true);
    };
    cancelBtn.addEventListener("click", () => close(false));
    okBtn.addEventListener("click", () => close(true));
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) close(false);
    });
    document.addEventListener("keydown", onKey);
    overlay.append(win);
    document.body.append(overlay);
    okBtn.focus();
  });
}

/** Themed prompt dialog (replaces window.prompt). Resolves the text or null. */
function themedPrompt(opts: {
  title: string;
  message?: string;
  defaultValue?: string;
  confirmText?: string;
}): Promise<string | null> {
  return new Promise((resolve) => {
    const overlay = h("div", { class: "ms-modal-overlay" });
    const input = h("input", {
      class: "ms-dialog-input",
      type: "text",
      value: opts.defaultValue ?? "",
    }) as HTMLInputElement;
    const cancelBtn = h("button", {
      class: "ms-btn secondary",
      type: "button",
      text: "Cancel",
    });
    const okBtn = h("button", {
      class: "ms-btn",
      type: "button",
      text: opts.confirmText ?? "Save",
    });
    const win = h("div", { class: "ms-window ms-dialog" }, [
      h("div", { class: "ms-window-title" }, [
        h("span", { text: opts.title }),
        h("span", { class: "nub" }),
      ]),
      h("div", { class: "ms-window-body" }, [
        opts.message ? h("p", { class: "ms-dialog-msg", text: opts.message }) : null,
        input,
        h("div", { class: "ms-dialog-actions" }, [cancelBtn, okBtn]),
      ]),
    ]);
    const close = (v: string | null) => {
      document.removeEventListener("keydown", onKey);
      overlay.remove();
      resolve(v);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close(null);
      else if (e.key === "Enter") {
        e.preventDefault();
        close(input.value);
      }
    };
    cancelBtn.addEventListener("click", () => close(null));
    okBtn.addEventListener("click", () => close(input.value));
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) close(null);
    });
    document.addEventListener("keydown", onKey);
    overlay.append(win);
    document.body.append(overlay);
    input.focus();
    input.select();
  });
}

/** User-provided helpful links. */
const HELPFUL_LINKS: { label: string; url: string }[] = [
  { label: "MeowDB - MS Classic item database", url: "https://meowdb.com/msclassic" },
  { label: "Meso.watch - meso market tracker", url: "https://meso.watch/" },
  { label: "MaplePrices - item price lookup", url: "https://mapleprices.net/" },
  { label: "Cozy Markets - market listings", url: "https://cozy.markets/market" },
];

/** Short effect + cost label for an item, e.g. "HP +100 - 50 meso". */
function effectText(item: Item): string {
  const e = item.effect;
  const parts: string[] = [];
  if (e.hpFlat) parts.push(`HP +${e.hpFlat}`);
  if (e.hpPercent) parts.push(`HP +${e.hpPercent}%`);
  if (e.mpFlat) parts.push(`MP +${e.mpFlat}`);
  if (e.mpPercent) parts.push(`MP +${e.mpPercent}%`);
  const cost = item.mesoCost !== null ? ` \u00b7 ${item.mesoCost} meso` : "";
  return parts.join("  ") + cost;
}

export class TrackerUI {
  private view: SessionView;
  private refs: Record<string, HTMLElement> = {};
  private fileInput!: HTMLInputElement;
  private sidebarPage: SidebarPage = "menu";
  /** Which session the Overall Stats page shows: "current" or a saved id. */
  private statsSelection = "current";
  /** User-uploaded character icon (data URL), or null to use the default. */
  private portraitDataUrl: string | null = this.loadPortrait();

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

    // Paste screenshots straight from the clipboard (Ctrl/Cmd+V).
    document.addEventListener("paste", (ev: ClipboardEvent) => {
      const dt = ev.clipboardData;
      if (!dt) return;
      const files: File[] = [];
      const seen = new Set<string>();
      const add = (f: File | null) => {
        if (!f || !f.type.startsWith("image/")) return;
        const key = `${f.name}:${f.size}:${f.lastModified}`;
        if (seen.has(key)) return;
        seen.add(key);
        files.push(f);
      };
      // Copied files from the OS file manager arrive as a FileList (multiple).
      for (const f of Array.from(dt.files ?? [])) add(f);
      // Bitmaps (snip tools) and any extras arrive as items.
      for (const it of dt.items) {
        if (it.kind === "file" && it.type.startsWith("image/")) add(it.getAsFile());
      }
      if (files.length) {
        ev.preventDefault();
        void this.handleFiles(files);
      }
    });
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
      h("div", { class: "ms-row" }, [this.buildGoalWindow(), this.buildConsumablesWindow()]),
      this.buildMapWindow(),
      this.buildRecordsWindow(),
      this.buildExpBar(),
      this.buildSidebar(),
    );
  }

  private buildSidebar(): HTMLElement {
    const tab = h(
      "button",
      { class: "ms-sidebar-tab", type: "button", title: "Open panel", "aria-label": "Open panel" },
      [h("span", { class: "ms-sidebar-chevron", text: "\u203a" })],
    );

    this.refs.sidebarBack = h("button", {
      class: "ms-sidebar-back",
      type: "button",
      title: "Back",
      text: "\u2039",
    });
    this.refs.sidebarBack.addEventListener("click", () => this.navSidebar("menu"));

    this.refs.sidebarTitle = h("span", { class: "ms-sidebar-title", text: "More" });
    this.refs.sidebarNub = h("span", { class: "nub" });

    const closeBtn = h("button", {
      class: "ms-sidebar-close",
      type: "button",
      title: "Close",
      text: "\u00d7",
    });

    this.refs.sidebarContent = h("div", { class: "ms-sidebar-content" });

    const panel = h("aside", { class: "ms-sidebar" }, [
      tab,
      h("div", { class: "ms-sidebar-body" }, [
        h("div", { class: "ms-sidebar-head" }, [
          this.refs.sidebarBack,
          this.refs.sidebarNub,
          this.refs.sidebarTitle,
          closeBtn,
        ]),
        this.refs.sidebarContent,
      ]),
    ]);

    const backdrop = h("div", { class: "ms-sidebar-backdrop" });
    const wrap = h("div", { class: "ms-sidebar-wrap" }, [backdrop, panel]);
    this.refs.sidebarWrap = wrap;

    const setOpen = (open: boolean) => wrap.classList.toggle("open", open);
    tab.addEventListener("click", () => wrap.classList.toggle("open"));
    closeBtn.addEventListener("click", () => setOpen(false));
    backdrop.addEventListener("click", () => setOpen(false));
    document.addEventListener("keydown", (ev) => {
      if ((ev as KeyboardEvent).key === "Escape") {
        setOpen(false);
      }
    });

    this.renderSidebar();
    return wrap;
  }

  private navSidebar(page: SidebarPage): void {
    this.sidebarPage = page;
    this.renderSidebar();
  }

  private renderSidebar(): void {
    const title = this.refs.sidebarTitle;
    const content = this.refs.sidebarContent;
    const back = this.refs.sidebarBack;
    if (!content) {
      return;
    }
    clear(content);
    const onMenu = this.sidebarPage === "menu";
    back.style.visibility = onMenu ? "hidden" : "visible";
    this.refs.sidebarNub.style.display = onMenu ? "" : "none";

    if (onMenu) {
      title.textContent = "More";
      content.append(this.buildSidebarMenu());
    } else if (this.sidebarPage === "sessions") {
      title.textContent = "Saved Sessions";
      content.append(this.buildSessionsPage());
    } else if (this.sidebarPage === "stats") {
      title.textContent = "Overall Stats";
      content.append(this.buildStatsPage());
    } else if (this.sidebarPage === "links") {
      title.textContent = "Helpful Links";
      content.append(this.buildLinksPage());
    }
  }

  private buildSidebarMenu(): HTMLElement {
    const navBar = (label: string, note: string, page: SidebarPage): HTMLElement =>
      h("button", { class: "ms-nav-bar", type: "button", onclick: () => this.navSidebar(page) }, [
        h("div", {}, [
          h("div", { class: "ms-nav-label", text: label }),
          h("div", { class: "ms-nav-note", text: note }),
        ]),
        h("span", { class: "ms-nav-chevron", text: "\u203a" }),
      ]);

    const mascot = h("img", {
      class: "ms-sidebar-mascot",
      src: assetUrl("assets/slime.png"),
      alt: "",
    }) as HTMLImageElement;
    mascot.addEventListener("error", () => mascot.remove());

    return h("div", { class: "ms-nav" }, [
      navBar("Saved Sessions", "Revisit past grinds", "sessions"),
      navBar("Overall Stats", "Your lifetime dashboard", "stats"),
      navBar("Helpful Links", "Guides & tools", "links"),
      h("div", { class: "ms-sidebar-empty ms-nav-footer" }, [
        mascot,
        h("div", { class: "ms-sidebar-empty-title", text: "More coming soon" }),
        h("p", {
          class: "ms-sidebar-empty-note",
          text: "New features will show up here as they're added.",
        }),
      ]),
    ]);
  }

  private miniStat(label: string, value: string, cls = ""): HTMLElement {
    return h("div", { class: "ms-mini-stat" }, [
      h("div", { class: "ms-stat-label", text: label }),
      h("div", { class: `ms-mini-value ${cls}`, text: value }),
    ]);
  }

  /** Prompt for a name and snapshot the current grind as a saved session. */
  private async saveCurrentSessionFlow(): Promise<void> {
    if (this.view.records.length === 0) {
      this.setStatus("Nothing to save yet - add some screenshots first.");
      return;
    }
    const date = new Date().toLocaleDateString();
    const suggested = this.view.latestName
      ? `${this.view.latestName} - ${date}`
      : `Grind - ${date}`;
    const name = await themedPrompt({
      title: "Save session",
      message: "Name this session:",
      defaultValue: suggested,
      confirmText: "Save",
    });
    if (name === null) {
      return;
    }
    this.session.saveCurrentSession(name);
    this.setStatus("Session saved.");
  }

  private buildSessionsPage(): HTMLElement {
    const saveBtn = h("button", {
      class: "ms-btn",
      type: "button",
      text: "Save current session",
      onclick: () => void this.saveCurrentSessionFlow(),
    });

    const exportBtn = h("button", {
      class: "ms-btn secondary",
      type: "button",
      text: "Export backup",
      disabled: this.view.savedSessions.length === 0 ? "true" : undefined,
      onclick: () => this.exportSessionsBackup(),
    });

    const importInput = h("input", {
      type: "file",
      accept: "application/json,.json",
      style: "display:none;",
      onchange: () => {
        const f = importInput.files?.[0];
        if (f) void this.importSessionsBackup(f);
        importInput.value = "";
      },
    }) as HTMLInputElement;
    const importBtn = h("button", {
      class: "ms-btn secondary",
      type: "button",
      text: "Import",
      onclick: () => importInput.click(),
    });

    const list = h("div", { class: "ms-session-list" });
    const sessions = this.view.savedSessions;
    if (sessions.length === 0) {
      list.append(
        h("p", {
          class: "ms-sidebar-empty-note",
          text: "No saved sessions yet. Finish a grind and tap \u201cSave current session\u201d.",
        }),
      );
    } else {
      for (const s of sessions) {
        const sum = s.summary;
        const netCls = sum.netMeso >= 0 ? "pos" : "neg";
        list.append(
          h("div", { class: "ms-session-card" }, [
            h("div", { class: "ms-session-top" }, [
              h("div", { class: "ms-session-name", text: s.name }),
              h("button", {
                class: "ms-del",
                type: "button",
                text: "\u00d7",
                title: "Delete",
                onclick: async () => {
                  const ok = await themedConfirm({
                    title: "Delete session",
                    message: "Delete this saved session? This can't be undone.",
                    confirmText: "Delete",
                    danger: true,
                  });
                  if (ok) {
                    this.session.deleteSavedSession(s.id);
                  }
                },
              }),
            ]),
            h("div", { class: "ms-session-date" }, [
              h("span", { text: fmtDateTime(s.savedAt) }),
              sum.characterName
                ? h("span", { class: "ms-session-char", text: sum.characterName })
                : h("span"),
              sum.currentMapName
                ? h("span", { class: "ms-session-map", text: sum.currentMapName })
                : h("span"),
            ]),
            h("div", { class: "ms-session-stats" }, [
              this.miniStat("EXP gained", fmtInt(sum.expGained)),
              this.miniStat(
                "Net meso",
                (sum.netMeso >= 0 ? "+" : "") + fmtInt(sum.netMeso),
                netCls,
              ),
              this.miniStat("Time", fmtDuration(sum.elapsedSeconds)),
            ]),
            h("div", { class: "ms-session-note-row" }, [
              s.note
                ? h("span", { class: "ms-session-note", text: s.note })
                : h("span", { class: "ms-session-note empty", text: "No note" }),
              h("button", {
                class: "ms-note-edit",
                type: "button",
                text: s.note ? "Edit" : "Add note",
                onclick: async () => {
                  const note = await themedPrompt({
                    title: "Session note",
                    message: 'Add a note or tag (e.g. "2x EXP event"):',
                    defaultValue: s.note,
                    confirmText: "Save",
                  });
                  if (note !== null) this.session.setSessionNote(s.id, note);
                },
              }),
            ]),
            h("button", {
              class: "ms-btn secondary ms-session-load",
              type: "button",
              text: "Load",
              onclick: async () => {
                const ok = await themedConfirm({
                  title: "Load session",
                  message: "Load this session? It replaces your current grind.",
                  confirmText: "Load",
                });
                if (ok) {
                  this.session.loadSavedSession(s.id);
                  this.setStatus("Saved session loaded.");
                }
              },
            }),
          ]),
        );
      }
    }

    return h("div", { class: "ms-sidebar-page" }, [
      h("div", { class: "ms-page-actions" }, [saveBtn]),
      h("div", { class: "ms-page-actions" }, [exportBtn, importBtn, importInput]),
      list,
    ]);
  }

  private exportSessionsBackup(): void {
    const json = this.session.exportSessionsJson();
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const date = new Date().toISOString().slice(0, 10);
    const a = h("a", {
      href: url,
      download: `maple-erfahrung-sessions-${date}.json`,
    }) as HTMLAnchorElement;
    a.click();
    URL.revokeObjectURL(url);
    this.setStatus("Saved sessions exported.");
  }

  private async importSessionsBackup(file: File): Promise<void> {
    try {
      const text = await file.text();
      const { added, error } = this.session.importSessionsJson(text);
      if (error) {
        this.setStatus(`Import failed: ${error}`);
      } else if (added === 0) {
        this.setStatus("Nothing new to import (those sessions are already here).");
      } else {
        this.setStatus(`Imported ${added} session${added === 1 ? "" : "s"}.`);
      }
    } catch {
      this.setStatus("Couldn't read that file.");
    }
  }

  private buildStatsPage(): HTMLElement {
    const sessions = this.view.savedSessions;

    // Keep the selection valid (a saved session may have been deleted).
    if (
      this.statsSelection !== "current" &&
      !sessions.some((s) => s.id === this.statsSelection)
    ) {
      this.statsSelection = "current";
    }

    const select = h("select", {
      class: "ms-stats-select",
      onchange: (ev: Event) => {
        this.statsSelection = (ev.target as HTMLSelectElement).value;
        this.renderSidebar();
      },
    }) as HTMLSelectElement;
    select.append(h("option", { value: "current", text: "Current session" }));
    for (const s of sessions) {
      select.append(h("option", { value: s.id, text: s.name }));
    }
    select.value = this.statsSelection;

    // Gather the breakdown for the chosen session.
    let d: {
      screenshotCount: number;
      elapsedSeconds: number;
      expGained: number;
      expPerHour: number;
      mesoGained: number;
      mesoSpent: number;
      netMeso: number;
      mapName: string | null;
    };
    if (this.statsSelection === "current") {
      const s = this.view.stats;
      d = {
        screenshotCount: s.screenshotCount,
        elapsedSeconds: s.elapsedSeconds,
        expGained: s.expGained,
        expPerHour: s.expPerHour,
        mesoGained: s.mesoGained,
        mesoSpent: this.view.mesoSpent,
        netMeso: this.view.netMeso,
        mapName: this.view.currentMapName,
      };
    } else {
      const sm = sessions.find((s) => s.id === this.statsSelection)!.summary;
      d = {
        screenshotCount: sm.screenshotCount,
        elapsedSeconds: sm.elapsedSeconds,
        expGained: sm.expGained,
        expPerHour: sm.expPerHour,
        mesoGained: sm.mesoGained,
        mesoSpent: sm.mesoSpent,
        netMeso: sm.netMeso,
        mapName: sm.currentMapName,
      };
    }

    const netTile = h("div", { class: "ms-mini-stat span2" }, [
      h("div", { class: "ms-stat-label", text: "Meso gained \u2212 pot cost" }),
      h("div", {
        class: `ms-mini-value ${d.netMeso >= 0 ? "pos" : "neg"}`,
        text: (d.netMeso >= 0 ? "+" : "") + fmtInt(d.netMeso),
      }),
    ]);

    const mapM = d.mapName ? this.mapByName(d.mapName) : null;
    const mapTile = h("div", { class: "ms-mini-stat span2" }, [
      h("div", { class: "ms-stat-label", text: "Map" }),
      h("div", { class: "ms-mini-value ms-mini-map", text: d.mapName ?? "\u2014" }),
      mapM
        ? h("div", { class: "ms-mini-map-meta", text: this.mapMeta(mapM) })
        : h("span"),
    ]);

    const grid = h("div", { class: "ms-dash-grid" }, [
      mapTile,
      this.miniStat("Screenshots", String(d.screenshotCount)),
      this.miniStat("Time", fmtDuration(d.elapsedSeconds)),
      this.miniStat("EXP gained", fmtInt(d.expGained)),
      this.miniStat("EXP / hour", fmtInt(d.expPerHour)),
      this.miniStat("Meso gained", fmtInt(d.mesoGained)),
      this.miniStat("Pots spent", fmtInt(d.mesoSpent)),
      netTile,
    ]);

    return h("div", { class: "ms-sidebar-page" }, [
      h("div", { class: "ms-page-actions" }, [
        h("button", {
          class: "ms-btn",
          type: "button",
          text: "View full dashboard",
          onclick: () => this.openDashboard(),
        }),
      ]),
      h("div", { class: "ms-stats-select-wrap" }, [select]),
      grid,
    ]);
  }

  private buildLinksPage(): HTMLElement {
    if (HELPFUL_LINKS.length === 0) {
      return h("div", { class: "ms-sidebar-page" }, [
        h("p", {
          class: "ms-sidebar-empty-note",
          text: "Links coming soon. Send me the links you want here and I'll add them.",
        }),
      ]);
    }
    const list = h("div", { class: "ms-links-list" });
    for (const link of HELPFUL_LINKS) {
      list.append(
        h("a", {
          class: "ms-link-row",
          href: link.url,
          target: "_blank",
          rel: "noopener noreferrer",
        }, [
          h("span", { class: "ms-link-label", text: link.label }),
          h("span", { class: "ms-nav-chevron", text: "\u2197" }),
        ]),
      );
    }
    return h("div", { class: "ms-sidebar-page" }, [list]);
  }

  // ------------------------------------------------------------- dashboard
  private openDashboard(): void {
    const allSessions = this.view.savedSessions;
    const currentRecords = this.view.records;

    // Unified shape so saved grinds and the current live grind aggregate the
    // same way.
    type DashSession = {
      id: string;
      name: string;
      isLive: boolean;
      note: string;
      summary: {
        elapsedSeconds: number;
        expGained: number;
        expPerHour: number;
        mesoGained: number;
        mesoSpent: number;
        netMeso: number;
        characterName: string | null;
        currentMapName: string | null;
      };
      records: typeof currentRecords;
      consumables: { itemId: string; quantity: number }[];
    };

    const LIVE_ID = "__live__";
    const st = this.view.stats;
    const liveHasData =
      this.view.records.length > 0 || this.view.consumables.length > 0;
    const liveSession: DashSession = {
      id: LIVE_ID,
      name: "Current session (live)",
      isLive: true,
      note: "",
      summary: {
        elapsedSeconds: st.elapsedSeconds,
        expGained: st.expGained,
        expPerHour: st.expPerHour,
        mesoGained: st.mesoGained,
        mesoSpent: this.view.mesoSpent,
        netMeso: this.view.netMeso,
        characterName: this.view.latestName,
        currentMapName: this.view.currentMapName,
      },
      records: this.view.records,
      consumables: this.view.consumables,
    };

    const pool: DashSession[] = [];
    if (liveHasData) pool.push(liveSession);
    for (const s of allSessions) {
      pool.push({
        id: s.id,
        name: s.name,
        isLive: false,
        note: s.note,
        summary: {
          elapsedSeconds: s.summary.elapsedSeconds,
          expGained: s.summary.expGained,
          expPerHour: s.summary.expPerHour,
          mesoGained: s.summary.mesoGained,
          mesoSpent: s.summary.mesoSpent,
          netMeso: s.summary.netMeso,
          characterName: s.summary.characterName,
          currentMapName: s.summary.currentMapName,
        },
        records: s.records,
        consumables: s.consumables,
      });
    }

    // Everything starts selected.
    const selected = new Set<string>(pool.map((s) => s.id));

    // Per-character profiles: filter the pool down to one mapler.
    let charFilter = "all";
    const charOf = (s: DashSession) => s.summary.characterName ?? "Unknown";
    const charNames = Array.from(new Set(pool.map(charOf)));
    const visibleSessions = () =>
      charFilter === "all" ? pool : pool.filter((s) => charOf(s) === charFilter);

    // --- Session multi-select picker (lives outside the captured area) ---
    const picker = h("div", { class: "ms-dash-picker" });
    const renderPicker = () => {
      clear(picker);
      const visible = visibleSessions();
      if (!visible.length) {
        picker.append(
          h("span", { class: "ms-stat-label", text: "No sessions yet. Save a grind to compare." }),
        );
        return;
      }
      for (const s of visible) {
        const box = h("input", { type: "checkbox", class: "ms-dash-check" }) as HTMLInputElement;
        box.checked = selected.has(s.id);
        box.addEventListener("change", () => {
          if (box.checked) selected.add(s.id);
          else selected.delete(s.id);
          render();
        });
        picker.append(
          h("label", { class: `ms-dash-pick-row${s.isLive ? " live" : ""}` }, [
            box,
            h("span", { class: "ms-dash-pick-text" }, [
              h("span", { class: "ms-dash-pick-name", text: s.name }),
              s.summary.currentMapName || s.note
                ? h("span", { class: "ms-dash-pick-map" }, [
                    s.note ? h("span", { class: "ms-dash-pick-tag", text: s.note }) : h("span"),
                    s.summary.currentMapName
                      ? h("span", { text: s.summary.currentMapName })
                      : h("span"),
                  ])
                : h("span"),
            ]),
            h("span", {
              class: `ms-dash-pick-net ${s.summary.netMeso >= 0 ? "pos" : "neg"}`,
              text: (s.summary.netMeso >= 0 ? "+" : "") + fmtInt(s.summary.netMeso),
            }),
          ]),
        );
      }
    };
    renderPicker();

    const setAll = (on: boolean) => {
      for (const s of visibleSessions()) {
        if (on) selected.add(s.id);
        else selected.delete(s.id);
      }
      renderPicker();
      render();
    };
    const allBtn = h("button", {
      class: "ms-chip",
      type: "button",
      text: "Select all",
      onclick: () => setAll(true),
    });
    const noneBtn = h("button", {
      class: "ms-chip",
      type: "button",
      text: "Clear",
      onclick: () => setAll(false),
    });

    const charSelect = h("select", {
      class: "ms-dash-select",
      onchange: (ev: Event) => {
        charFilter = (ev.target as HTMLSelectElement).value;
        // Focus the view on the chosen character: select just their sessions.
        selected.clear();
        for (const s of visibleSessions()) selected.add(s.id);
        renderPicker();
        render();
      },
    }) as HTMLSelectElement;
    charSelect.append(h("option", { value: "all", text: "All characters" }));
    for (const n of charNames) charSelect.append(h("option", { value: n, text: n }));

    const pickerCtrl = h("div", { class: "ms-dash-ctrl grow" }, [
      h("div", { class: "ms-dash-ctrl-head" }, [
        h("span", { class: "ms-stat-label", text: "Sessions in overall stats" }),
        h("div", { class: "ms-dash-pick-actions" }, [allBtn, noneBtn]),
      ]),
      picker,
    ]);

    const controls = h("div", { class: "ms-dash-controls" }, [
      charNames.length > 1
        ? h("label", { class: "ms-dash-ctrl" }, [
            h("span", { class: "ms-stat-label", text: "Character" }),
            charSelect,
          ])
        : h("span"),
      pickerCtrl,
    ]);

    const capture = h("div", { class: "ms-dash-capture" });

    const tile = (label: string, value: string, cls = ""): HTMLElement =>
      h("div", { class: "ms-dash-tile" }, [
        h("div", { class: "ms-stat-label", text: label }),
        h("div", { class: `ms-dash-tile-val ${cls}`, text: value }),
      ]);
    const chartCard = (title: string, body: HTMLElement): HTMLElement =>
      h("div", { class: "ms-dash-chart" }, [
        h("div", { class: "ms-dash-chart-title", text: title }),
        body,
      ]);

    const render = () => {
      clear(capture);
      const sessions = pool.filter((s) => selected.has(s.id));

      let timeTotal = 0;
      let expTotal = 0;
      let gainedTotal = 0;
      let spentTotal = 0;
      let netTotal = 0;
      let bestRate = 0;
      let potsUsed = 0;
      const mapExp = new Map<string, number>();
      const mapNet = new Map<string, number>();
      for (const s of sessions) {
        timeTotal += s.summary.elapsedSeconds;
        expTotal += s.summary.expGained;
        gainedTotal += s.summary.mesoGained;
        spentTotal += s.summary.mesoSpent;
        netTotal += s.summary.netMeso;
        bestRate = Math.max(bestRate, s.summary.expPerHour);
        for (const c of s.consumables) potsUsed += c.quantity;
        const mn = s.summary.currentMapName;
        if (mn) {
          mapExp.set(mn, (mapExp.get(mn) ?? 0) + s.summary.expGained);
          mapNet.set(mn, (mapNet.get(mn) ?? 0) + s.summary.netMeso);
        }
      }
      const mapNames = [...mapExp.keys()];
      const hours = timeTotal / 3600;
      const avgRate = hours > 0 ? expTotal / hours : 0;
      const potEff = gainedTotal > 0 ? (spentTotal / gainedTotal) * 100 : 0;
      const margin = gainedTotal > 0 ? (netTotal / gainedTotal) * 100 : 0;
      const avgNet = sessions.length ? netTotal / sessions.length : 0;

      const mapsTile =
        mapNames.length === 1
          ? tile("Map", mapNames[0])
          : tile("Maps", mapNames.length ? String(mapNames.length) : "-");
      const tiles = h("div", { class: "ms-dash-tiles" }, [
        mapsTile,
        tile("Sessions", String(sessions.length)),
        tile("Total time", fmtDuration(timeTotal)),
        tile("Total EXP", fmtInt(expTotal)),
        tile("Avg EXP/hr", fmtInt(avgRate)),
        tile("Best EXP/hr", fmtInt(bestRate)),
        tile("Meso gained", fmtInt(gainedTotal)),
        tile("Meso/hr", hours > 0 ? fmtInt(gainedTotal / hours) : "-"),
        tile("Pots spent", fmtInt(spentTotal)),
        tile("Pots used", fmtInt(potsUsed)),
        tile("Net meso", (netTotal >= 0 ? "+" : "") + fmtInt(netTotal), netTotal >= 0 ? "pos" : "neg"),
        tile(
          "Net meso/hr",
          hours > 0 ? (netTotal >= 0 ? "+" : "") + fmtInt(netTotal / hours) : "-",
          netTotal >= 0 ? "pos" : "neg",
        ),
        tile("Avg net/session", (avgNet >= 0 ? "+" : "") + fmtInt(avgNet), avgNet >= 0 ? "pos" : "neg"),
        tile("Pots % of income", gainedTotal > 0 ? `${potEff.toFixed(1)}%` : "-"),
        tile("Profit margin", gainedTotal > 0 ? `${margin.toFixed(1)}%` : "-", margin >= 0 ? "pos" : "neg"),
      ]);

      const potTotals = new Map<string, number>();
      for (const s of sessions) {
        for (const c of s.consumables) {
          const item = itemById(c.itemId);
          const cost = (item?.mesoCost ?? 0) * c.quantity;
          if (cost > 0) potTotals.set(c.itemId, (potTotals.get(c.itemId) ?? 0) + cost);
        }
      }
      const potSlices = [...potTotals.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([id, cost], i) => ({
          label: itemById(id)?.name ?? id,
          value: cost,
          color: CHART_PALETTE[i % CHART_PALETTE.length],
        }));

      const kept = Math.max(0, gainedTotal - spentTotal);
      const mesoSplit = [
        { label: "Kept", value: kept, color: "var(--green)" },
        { label: "Pots", value: spentTotal, color: "var(--orange-deep)" },
      ];

      const chrono = [...sessions].reverse();
      // Combined per-session comparison: net meso (diverging) + EXP/hr as the
      // row's secondary value.
      const perSession = chrono.map((s) => ({
        label: s.name,
        value: s.summary.netMeso,
        sub: `${fmtInt(s.summary.expPerHour)} xp/hr`,
      }));

      let run = 0;
      const cumPoints = chrono.map((s, i) => {
        run += s.summary.netMeso;
        return { x: i, y: run };
      });

      const expMesoCols = chrono.map((s) => ({
        label: s.name,
        bars: [
          { value: s.summary.expGained, color: "var(--green)", name: "EXP" },
          { value: s.summary.mesoGained, color: "#e8a200", name: "Meso" },
        ],
      }));

      const charts: HTMLElement[] = [];
      if (potSlices.length)
        charts.push(
          chartCard(
            "Pot spend by item",
            donutChart(potSlices, 150, { centerValue: fmtInt(spentTotal), centerLabel: "spent" }),
          ),
        );
      if (gainedTotal > 0 || spentTotal > 0)
        charts.push(
          chartCard(
            "Where your meso went",
            donutChart(mesoSplit, 150, { centerValue: fmtInt(gainedTotal), centerLabel: "gained" }),
          ),
        );
      charts.push(
        chartCard(
          "Per session: net meso & EXP/hr",
          perSession.length >= 2
            ? barRows(perSession, { signed: true, diverging: true })
            : h("div", {
                class: "ms-chart-empty",
                text: "Select 2+ sessions to compare.",
              }),
        ),
      );
      if (mapNames.length >= 1) {
        const mapBars = [...mapExp.entries()]
          .sort((a, b) => b[1] - a[1])
          .map(([name, exp], i) => ({
            label: name,
            value: exp,
            color: CHART_PALETTE[i % CHART_PALETTE.length],
            sub: `${(mapNet.get(name) ?? 0) >= 0 ? "+" : ""}${fmtInt(mapNet.get(name) ?? 0)} net`,
          }));
        charts.push(chartCard("EXP by map", barRows(mapBars)));
      }
      if (cumPoints.length >= 2)
        charts.push(
          chartCard(
            "Cumulative net meso",
            lineChart(cumPoints, { zeroBaseline: true, color: "var(--accent)" }),
          ),
        );
      charts.push(
        chartCard(
          "EXP & meso per session",
          columnChart(expMesoCols, {
            legend: [
              { name: "EXP gained", color: "var(--green)" },
              { name: "Meso gained", color: "#e8a200" },
            ],
          }),
        ),
      );

      const showNote = sessions.length === 0;
      capture.append(
        h("div", { class: "ms-dash-head-line" }, [
          h("span", { class: "ms-dash-brand", text: "Maple Erfahrung" }),
          h("span", {
            class: "ms-dash-sub",
            text: `Overall Stats \u00b7 ${sessions.length} session${sessions.length === 1 ? "" : "s"}`,
          }),
        ]),
        tiles,
        showNote
          ? h("p", {
              class: "ms-sidebar-empty-note",
              style: "text-align:center;margin:12px auto;",
              text: pool.length
                ? "Select at least one session above."
                : "Save a grind (or start one) to populate your dashboard.",
            })
          : h("div", { class: "ms-dash-charts" }, charts),
      );
    };

    render();

    const downloadBtn = h("button", {
      class: "ms-btn",
      type: "button",
      text: "Copy image",
    });
    const closeBtn = h("button", {
      class: "ms-sidebar-close",
      type: "button",
      text: "\u00d7",
      title: "Close",
    });

    const card = h("div", { class: "ms-window ms-modal ms-dashboard" }, [
      h("div", { class: "ms-window-title" }, [
        h("span", { text: "Overall Stats" }),
        h("div", { class: "ms-dash-head-actions" }, [downloadBtn, closeBtn]),
      ]),
      h("div", { class: "ms-window-body ms-dash-body" }, [controls, capture]),
    ]);

    const overlay = h("div", { class: "ms-modal-overlay" });
    const close = () => {
      document.removeEventListener("keydown", onKey);
      overlay.remove();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) close();
    });
    closeBtn.addEventListener("click", close);
    downloadBtn.addEventListener("click", () => void this.copyDashboard(capture, downloadBtn));
    document.addEventListener("keydown", onKey);
    overlay.append(card);
    document.body.append(overlay);
  }

  private async copyDashboard(target: HTMLElement, btn: HTMLElement): Promise<void> {
    const original = btn.textContent;
    btn.textContent = "Rendering\u2026";
    (btn as HTMLButtonElement).disabled = true;
    const restore = (text: string) => {
      btn.textContent = text;
      window.setTimeout(() => {
        btn.textContent = original;
        (btn as HTMLButtonElement).disabled = false;
      }, 1500);
    };
    try {
      const bg =
        getComputedStyle(document.documentElement).getPropertyValue("--bg").trim() || "#ffffff";
      const { default: html2canvas } = await import("html2canvas");
      const canvas = await html2canvas(target, { backgroundColor: bg, scale: 2 });
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, "image/png"),
      );
      if (!blob) throw new Error("Could not render image.");

      // Prefer clipboard; fall back to a download if it's unavailable/denied.
      const clip = navigator.clipboard as Clipboard & {
        write?: (items: ClipboardItem[]) => Promise<void>;
      };
      if (typeof ClipboardItem !== "undefined" && clip?.write) {
        try {
          await clip.write([new ClipboardItem({ "image/png": blob })]);
          restore("Copied!");
          return;
        } catch {
          // fall through to download
        }
      }
      const url = URL.createObjectURL(blob);
      const a = h("a", { href: url, download: "maple-erfahrung-stats.png" }) as HTMLAnchorElement;
      a.click();
      URL.revokeObjectURL(url);
      restore("Downloaded");
    } catch (err) {
      this.setStatus(`Could not export image: ${String(err)}`);
      btn.textContent = original;
      (btn as HTMLButtonElement).disabled = false;
    }
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

  // ------------------------------------------------------------- portrait
  private static readonly PORTRAIT_KEY = "portrait";

  private loadPortrait(): string | null {
    try {
      return localStorage.getItem(TrackerUI.PORTRAIT_KEY);
    } catch {
      return null;
    }
  }

  /** Point the portrait img at the custom icon or the bundled default. */
  private applyPortrait(): void {
    const img = this.refs.portraitImg as HTMLImageElement | undefined;
    if (!img) return;
    img.style.visibility = "";
    img.src = this.portraitDataUrl ?? assetUrl("assets/portrait.png");
    const reset = this.refs.portraitReset;
    if (reset) reset.style.display = this.portraitDataUrl ? "" : "none";
  }

  private clearPortrait(): void {
    this.portraitDataUrl = null;
    try {
      localStorage.removeItem(TrackerUI.PORTRAIT_KEY);
    } catch {
      /* storage may be unavailable */
    }
    this.applyPortrait();
    this.setStatus("Character icon reset to default.");
  }

  /** Downscale an uploaded image to a small square icon and store it. */
  private async handlePortraitFile(file: File): Promise<void> {
    if (!file.type.startsWith("image/")) {
      this.setStatus("Please choose an image file.");
      return;
    }
    const url = URL.createObjectURL(file);
    try {
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const i = new Image();
        i.onload = () => resolve(i);
        i.onerror = () => reject(new Error("decode failed"));
        i.src = url;
      });
      const size = 128;
      const canvas = document.createElement("canvas");
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("no canvas context");
      // Cover-crop to a centered square so any aspect ratio looks right.
      const scale = Math.max(size / img.width, size / img.height);
      const w = img.width * scale;
      const hgt = img.height * scale;
      ctx.drawImage(img, (size - w) / 2, (size - hgt) / 2, w, hgt);
      const dataUrl = canvas.toDataURL("image/png");

      this.portraitDataUrl = dataUrl;
      try {
        localStorage.setItem(TrackerUI.PORTRAIT_KEY, dataUrl);
      } catch {
        this.setStatus("Icon set for now, but it couldn't be saved (storage full?).");
      }
      this.applyPortrait();
    } catch {
      this.setStatus("Couldn't read that image. Try a PNG or JPG.");
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  /** Small meso coin icon; falls back to a CSS dot if the art is missing. */
  private buildCoin(): HTMLElement {
    const img = h("img", {
      class: "ms-coin-img",
      src: assetUrl("assets/mesos.png"),
      alt: "",
    }) as HTMLImageElement;
    img.addEventListener("error", () => img.replaceWith(h("span", { class: "ms-coin" })));
    return img;
  }

  private buildCharWindow(): HTMLElement {
    this.refs.charName = h("div", { class: "ms-char-name", text: "-" });
    this.refs.charSub = h("div", { class: "ms-char-sub" });
    this.refs.charMap = h("div", { class: "ms-char-map" });

    // Character portrait. Defaults to the mushroom; players can upload their
    // own icon, stored in the browser (localStorage) as a small data URL.
    const portraitImg = h("img", { alt: "", class: "ms-portrait-img" }) as HTMLImageElement;
    this.refs.portraitImg = portraitImg;
    portraitImg.addEventListener("error", () => {
      // Only matters when the bundled default is missing and no custom icon.
      if (!this.portraitDataUrl) portraitImg.style.visibility = "hidden";
    });

    const picker = h("input", {
      type: "file",
      accept: "image/png,image/jpeg,image/webp,image/gif",
      style: "display:none;",
      onchange: () => {
        const f = picker.files?.[0];
        if (f) void this.handlePortraitFile(f);
        picker.value = "";
      },
    }) as HTMLInputElement;

    const portrait = h("div", { class: "ms-char-portrait" }, [portraitImg]);

    const changeIconBtn = h("button", {
      class: "ms-btn secondary ms-char-icon-btn",
      type: "button",
      text: "Change Icon",
      onclick: () => picker.click(),
    });
    this.refs.portraitReset = h("button", {
      class: "ms-btn secondary ms-char-icon-btn",
      type: "button",
      text: "Reset Icon",
      onclick: () => this.clearPortrait(),
    });
    this.applyPortrait();

    const body = h("div", { class: "ms-window-body" }, [
      h("div", { class: "ms-char" }, [
        portrait,
        h("div", { class: "ms-char-info" }, [
          this.refs.charName,
          this.refs.charSub,
          this.refs.charMap,
        ]),
        h("div", { class: "ms-char-actions" }, [
          h("button", {
            class: "ms-btn secondary ms-char-dash",
            type: "button",
            text: "Overall Stats",
            onclick: () => this.openDashboard(),
          }),
          h("button", {
            class: "ms-btn ms-char-save",
            type: "button",
            text: "Save Session",
            onclick: () => void this.saveCurrentSessionFlow(),
          }),
          changeIconBtn,
          this.refs.portraitReset,
          picker,
        ]),
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
          onclick: () => void this.confirmReset(),
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
        this.statTile("currentMap", "Map"),
        this.statTile("screenshots", "Screenshots"),
        this.statTile("elapsed", "Elapsed"),
        this.statTile("expGained", "EXP Gained"),
        this.statTile("expPerHour", "EXP / Hour"),
        this.statTile("mesoCurrent", "Current Meso"),
        this.statTile("mesoGained", "Meso Gained"),
        this.statTile("mesoPerHour", "Meso / Hour"),
        this.statTile("netMeso", "Meso Gained \u2212 Pot Cost"),
        this.statTile("netMesoPerHour", "Net Meso / Hour"),
        this.statTile("lastPercent", "Last EXP %"),
        this.statTile("lastShot", "Last Shot"),
      ]),
    ]);
    this.refs.currentMap.classList.add("ms-stat-map");
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
      (this.refs.goalProjection = h("div", { class: "ms-goal-projection" })),
    ]);
    return this.window("Level Goal", body);
  }

  /** "To reach Lv X: ~Yh, ~P pots, ~M meso" from the live rate + pot burn. */
  private renderGoalProjection(view: SessionView): void {
    const box = this.refs.goalProjection;
    if (!box) return;
    clear(box);
    const g = view.goal;
    const s = view.stats;
    if (g.reached) {
      box.append(h("span", { class: "ms-goal-proj-ok", text: "Goal reached \u2713" }));
      return;
    }
    const rate = view.window.expPerHour || s.expPerHour;
    if (g.goalRemaining === null || rate <= 0) {
      box.append(
        h("span", {
          class: "ms-goal-proj-hint",
          text: "Add a couple of screenshots to project time, pots and meso to your goal.",
        }),
      );
      return;
    }
    const hoursToGoal = g.goalRemaining / rate;
    const remaining = g.goalRemaining;

    // Scale consumption + income by EXP remaining (pots/meso per EXP this
    // session x EXP to go). This stays consistent with the EXP-to-goal figure,
    // unlike mixing a short-window rate with a whole-session time base.
    const expGained = s.expGained;
    const perExp = (total: number) => (expGained > 0 ? (total / expGained) * remaining : 0);

    const potsUsed = view.consumables.reduce((a, c) => a + c.quantity, 0);
    const projPots = Math.round(perExp(potsUsed));
    const projPotMeso = Math.round(perExp(view.mesoSpent));
    const projGained = Math.round(perExp(Math.max(0, s.mesoGained)));
    const projNet = projGained - projPotMeso;

    const part = (val: string, lbl: string, cls = ""): HTMLElement =>
      h("span", { class: "ms-goal-proj-part" }, [
        h("span", { class: `ms-goal-proj-val ${cls}`, text: val }),
        h("span", { class: "ms-goal-proj-lbl", text: lbl }),
      ]);

    const parts: HTMLElement[] = [part(fmtEta(hoursToGoal * 3600), "to go")];
    if (expGained > 0 && s.mesoGained > 0) {
      parts.push(part(`~${fmtInt(projGained)}`, "meso gained"));
    }
    if (expGained > 0 && potsUsed > 0) {
      parts.push(part(`~${fmtInt(projPots)}`, "pots"));
      parts.push(part(`~${fmtInt(projPotMeso)}`, "meso on pots"));
    }
    if (expGained > 0 && s.mesoGained > 0 && view.mesoSpent > 0) {
      parts.push(
        part(
          (projNet >= 0 ? "+" : "") + fmtInt(projNet),
          "net meso",
          projNet >= 0 ? "pos" : "neg",
        ),
      );
    }

    box.append(
      h("div", { class: "ms-goal-proj-head", text: `To reach Lv ${view.desiredLevel}` }),
      h("div", { class: "ms-goal-proj-row" }, parts),
    );
  }

  /** A searchable dropdown that shows item icons + effects; type to filter. */
  private buildItemCombobox(items: readonly Item[]): {
    wrap: HTMLElement;
    getSelected: () => Item | null;
    reset: () => void;
  } {
    let selected: Item | null = null;
    const input = h("input", {
      type: "text",
      class: "ms-combo-input",
      placeholder: "Select or type\u2026",
    }) as HTMLInputElement;
    const menu = h("div", { class: "ms-combo-menu" });
    menu.style.display = "none";
    const wrap = h("div", { class: "ms-combo" }, [input, menu]);

    const resolve = (text: string): Item | null => {
      const q = text.trim().toLowerCase();
      if (!q) return null;
      return (
        items.find((i) => i.name.toLowerCase() === q) ??
        items.find((i) => i.name.toLowerCase().startsWith(q)) ??
        items.find((i) => i.name.toLowerCase().includes(q)) ??
        null
      );
    };

    const renderMenu = () => {
      clear(menu);
      const q = input.value.trim().toLowerCase();
      const matches = items.filter((i) => !q || i.name.toLowerCase().includes(q));
      if (matches.length === 0) {
        menu.append(h("div", { class: "ms-combo-empty", text: "No match" }));
        return;
      }
      for (const it of matches) {
        const icon = h("img", {
          class: "ms-combo-icon",
          src: assetUrl(`assets/items/${it.id}.png`),
          alt: "",
        }) as HTMLImageElement;
        icon.addEventListener("error", () => icon.remove());
        const opt = h("div", { class: "ms-combo-opt" }, [
          icon,
          h("span", { class: "ms-combo-name", text: it.name }),
          h("span", { class: "ms-combo-meta", text: effectText(it) }),
        ]);
        // mousedown (not click) so it fires before the input's blur hides the menu.
        opt.addEventListener("mousedown", (ev) => {
          ev.preventDefault();
          selected = it;
          input.value = it.name;
          menu.style.display = "none";
        });
        menu.append(opt);
      }
    };

    input.addEventListener("focus", () => {
      renderMenu();
      menu.style.display = "block";
    });
    input.addEventListener("input", () => {
      selected = null;
      renderMenu();
      menu.style.display = "block";
    });
    input.addEventListener("blur", () => {
      window.setTimeout(() => (menu.style.display = "none"), 150);
    });
    input.addEventListener("keydown", (ev) => {
      const e = ev as KeyboardEvent;
      if (e.key === "Enter") {
        e.preventDefault();
        const hit = resolve(input.value);
        if (hit) {
          selected = hit;
          input.value = hit.name;
          menu.style.display = "none";
        }
      } else if (e.key === "Escape") {
        menu.style.display = "none";
      }
    });

    return {
      wrap,
      getSelected: () => selected ?? resolve(input.value),
      reset: () => {
        selected = null;
        input.value = "";
      },
    };
  }

  private buildConsumablesWindow(): HTMLElement {
    const hpItems = ITEMS.filter((i) => i.effect.hpFlat || i.effect.hpPercent);
    const mpItems = ITEMS.filter((i) => i.effect.mpFlat || i.effect.mpPercent);

    const makeBar = (label: string, cls: string, items: readonly Item[]): HTMLElement => {
      const combo = this.buildItemCombobox(items);
      const qty = h("input", {
        type: "number",
        min: "1",
        value: "1",
        class: "ms-qty-add",
      }) as HTMLInputElement;
      const add = () => {
        const item = combo.getSelected();
        if (!item) {
          this.setStatus("Pick an item from the list first.");
          return;
        }
        const n = Math.max(1, Math.floor(Number(qty.value) || 1));
        const existing = this.view.consumables.find((c) => c.itemId === item.id);
        this.session.setConsumable(item.id, (existing?.quantity ?? 0) + n);
        combo.reset();
        qty.value = "1";
      };
      return h("div", { class: `ms-add-row ${cls}` }, [
        h("span", { class: "ms-bar-label", text: label }),
        combo.wrap,
        qty,
        h("button", { class: "ms-btn", text: "Add", onclick: add }),
      ]);
    };

    this.refs.consumablesList = h("div", { class: "ms-consumables-list" });
    this.refs.consSpent = h("span", { class: "ms-cons-spent-val", text: "0" });

    const body = h("div", { class: "ms-window-body" }, [
      makeBar("HP", "hp", hpItems),
      makeBar("MP", "mp", mpItems),
      this.refs.consumablesList,
      h("div", { class: "ms-cons-spent" }, [
        h("span", { class: "ms-stat-label", text: "Total meso cost" }),
        this.refs.consSpent,
      ]),
    ]);
    return this.window("Consumables", body);
  }

  /** Short "Lv 21 - Victoria Island" style descriptor for a map option. */
  private mapMeta(m: MapInfo): string {
    const where = m.region;
    if (m.kind === "town") return `Town \u00b7 ${where}`;
    if (m.kind === "pq") return `PQ \u00b7 ${where}`;
    return m.avgLevel !== null ? `Lv ${m.avgLevel} \u00b7 ${where}` : where;
  }

  /** First map whose name matches (prefer one that has combat data). */
  private mapByName(name: string): MapInfo | null {
    const hits = MAPS.filter((m) => m.name === name);
    if (!hits.length) return null;
    return hits.find((m) => m.avgLevel !== null) ?? hits[0];
  }

  /**
   * "Current Map" picker: a searchable dropdown over the map DB. Selecting a
   * map records it on the session (so it's saved + shown in Overall Stats) and
   * reveals the stats we have for that map.
   */
  private buildMapWindow(): HTMLElement {
    const input = h("input", {
      type: "text",
      class: "ms-combo-input",
      placeholder: "Search for a map\u2026",
    }) as HTMLInputElement;
    const menu = h("div", { class: "ms-combo-menu" });
    menu.style.display = "none";
    const combo = h("div", { class: "ms-combo" }, [input, menu]);
    this.refs.mapInput = input;

    const commit = (name: string | null) => {
      this.session.setCurrentMapName(name);
      menu.style.display = "none";
    };

    const renderMenu = () => {
      clear(menu);
      const q = input.value.trim().toLowerCase();
      const matches = MAPS.filter((m) => !q || m.name.toLowerCase().includes(q)).slice(0, 60);
      if (matches.length === 0) {
        menu.append(h("div", { class: "ms-combo-empty", text: "No match" }));
        return;
      }
      for (const m of matches) {
        const opt = h("div", { class: "ms-combo-opt" }, [
          h("span", { class: "ms-combo-name", text: m.name }),
          h("span", { class: "ms-combo-meta", text: this.mapMeta(m) }),
        ]);
        opt.addEventListener("mousedown", (ev) => {
          ev.preventDefault();
          input.value = m.name;
          commit(m.name);
        });
        menu.append(opt);
      }
    };

    input.addEventListener("focus", () => {
      renderMenu();
      menu.style.display = "block";
    });
    input.addEventListener("input", () => {
      renderMenu();
      menu.style.display = "block";
    });
    input.addEventListener("blur", () => {
      window.setTimeout(() => (menu.style.display = "none"), 150);
    });
    input.addEventListener("keydown", (ev) => {
      const e = ev as KeyboardEvent;
      if (e.key === "Enter") {
        e.preventDefault();
        const q = input.value.trim().toLowerCase();
        const hit =
          MAPS.find((m) => m.name.toLowerCase() === q) ??
          MAPS.find((m) => m.name.toLowerCase().startsWith(q)) ??
          MAPS.find((m) => m.name.toLowerCase().includes(q));
        if (hit) {
          input.value = hit.name;
          commit(hit.name);
        }
      } else if (e.key === "Escape") {
        menu.style.display = "none";
      }
    });

    const clearBtn = h("button", {
      class: "ms-btn secondary",
      type: "button",
      text: "Clear",
      onclick: () => {
        input.value = "";
        commit(null);
      },
    });

    this.refs.mapInfo = h("div", { class: "ms-map-info" });
    this.refs.mapRecs = h("div", { class: "ms-map-recs" });

    const browseBtn = h("button", {
      class: "ms-btn secondary ms-map-browse",
      type: "button",
      text: "Browse all maps",
      onclick: () => this.openMapBrowser(),
    });

    const body = h("div", { class: "ms-window-body" }, [
      h("div", { class: "ms-add-row" }, [
        h("span", { class: "ms-bar-label", text: "Map" }),
        combo,
        clearBtn,
      ]),
      this.refs.mapInfo,
      this.refs.mapRecs,
      browseBtn,
    ]);
    return this.window("Current Map", body);
  }

  /** Full, searchable/filterable list of every map the player can pick. */
  private openMapBrowser(): void {
    let query = "";
    let region = "all";
    let huntableOnly = true;
    let sort: "level" | "exp" | "name" = "exp";

    const listBox = h("div", { class: "ms-mapbrowser-list" });
    const countEl = h("span", { class: "ms-mapbrowser-count" });

    const render = () => {
      clear(listBox);
      const q = query.trim().toLowerCase();
      let rows = MAPS.filter((m) => {
        if (huntableOnly && !(m.kind === "map" && m.avgLevel !== null)) return false;
        if (region !== "all" && m.region !== region) return false;
        if (q && !m.name.toLowerCase().includes(q)) return false;
        return true;
      });
      rows = [...rows].sort((a, b) => {
        if (sort === "name") return a.name.localeCompare(b.name);
        if (sort === "level") return (a.avgLevel ?? 0) - (b.avgLevel ?? 0);
        return (b.expPerKill ?? 0) - (a.expPerKill ?? 0); // exp
      });

      countEl.textContent = `${rows.length} map${rows.length === 1 ? "" : "s"}`;
      if (!rows.length) {
        listBox.append(h("div", { class: "ms-chart-empty", text: "No maps match." }));
        return;
      }
      for (const m of rows) {
        const isActive = this.view.currentMapName === m.name;
        const row = h("button", {
          class: `ms-mapbrowser-row${isActive ? " active" : ""}`,
          type: "button",
          onclick: () => {
            this.session.setCurrentMapName(m.name);
            close();
          },
        }, [
          h("span", { class: "ms-mapbrowser-name", text: m.name }),
          h("span", { class: "ms-mapbrowser-region", text: m.region }),
          h("span", { class: "ms-mapbrowser-num", text: m.avgLevel !== null ? `Lv ${m.avgLevel}` : "\u2014" }),
          h("span", { class: "ms-mapbrowser-num", text: m.mobs !== null ? `${m.mobs} mob` : "\u2014" }),
          h("span", {
            class: "ms-mapbrowser-num",
            text: m.expPerKill !== null ? `${fmtInt(m.expPerKill)}/kill` : "\u2014",
          }),
        ]);
        listBox.append(row);
      }
    };

    const searchInput = h("input", {
      type: "text",
      class: "ms-combo-input",
      placeholder: "Search maps\u2026",
      oninput: (ev: Event) => {
        query = (ev.target as HTMLInputElement).value;
        render();
      },
    }) as HTMLInputElement;

    const regionSelect = h("select", {
      class: "ms-dash-select",
      onchange: (ev: Event) => {
        region = (ev.target as HTMLSelectElement).value;
        render();
      },
    }) as HTMLSelectElement;
    regionSelect.append(h("option", { value: "all", text: "All regions" }));
    for (const r of MAP_REGIONS) regionSelect.append(h("option", { value: r, text: r }));

    const sortSelect = h("select", {
      class: "ms-dash-select",
      onchange: (ev: Event) => {
        sort = (ev.target as HTMLSelectElement).value as typeof sort;
        render();
      },
    }) as HTMLSelectElement;
    sortSelect.append(
      h("option", { value: "exp", text: "Sort: EXP/kill" }),
      h("option", { value: "level", text: "Sort: Level" }),
      h("option", { value: "name", text: "Sort: Name" }),
    );

    const huntableBox = h("input", { type: "checkbox", class: "ms-dash-check" }) as HTMLInputElement;
    huntableBox.checked = true;
    huntableBox.addEventListener("change", () => {
      huntableOnly = huntableBox.checked;
      render();
    });

    const closeBtn = h("button", {
      class: "ms-sidebar-close",
      type: "button",
      text: "\u00d7",
      title: "Close",
    });

    const controls = h("div", { class: "ms-mapbrowser-controls" }, [
      searchInput,
      regionSelect,
      sortSelect,
      h("label", { class: "ms-mapbrowser-toggle" }, [huntableBox, h("span", { text: "Mob only" })]),
    ]);

    const card = h("div", { class: "ms-window ms-modal ms-mapbrowser" }, [
      h("div", { class: "ms-window-title" }, [
        h("span", {}, [h("span", { text: "All Maps  " }), countEl]),
        closeBtn,
      ]),
      h("div", { class: "ms-window-body" }, [controls, listBox]),
    ]);

    const overlay = h("div", { class: "ms-modal-overlay" });
    const close = () => {
      document.removeEventListener("keydown", onKey);
      overlay.remove();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) close();
    });
    closeBtn.addEventListener("click", close);
    document.addEventListener("keydown", onKey);

    render();
    overlay.append(card);
    document.body.append(overlay);
    searchInput.focus();
  }

  /** "Good maps for Lv X" suggestions, ranked by EXP density. */
  private renderMapRecs(level: number | null): void {
    const box = this.refs.mapRecs;
    if (!box) return;
    clear(box);
    if (level === null) {
      box.append(
        h("div", { class: "ms-map-recs-head", text: "Add a screenshot to get map suggestions." }),
      );
      return;
    }
    const recs = recommendMaps(level, { limit: 6 });
    box.append(h("div", { class: "ms-map-recs-head", text: `Good maps for Lv ${level}` }));
    if (!recs.length) {
      box.append(h("div", { class: "ms-map-empty", text: "No ranked maps near this level." }));
      return;
    }
    const list = h("div", { class: "ms-map-recs-list" });
    for (const m of recs) {
      const row = h("button", {
        class: "ms-map-rec",
        type: "button",
        title: `Set current map to ${m.name}`,
        onclick: () => {
          const input = this.refs.mapInput as HTMLInputElement | undefined;
          if (input) input.value = m.name;
          this.session.setCurrentMapName(m.name);
        },
      }, [
        h("span", { class: "ms-map-rec-name", text: m.name }),
        h("span", {
          class: "ms-map-rec-meta",
          text: `Lv ${m.avgLevel} \u00b7 ${fmtInt(m.expPerKill)}/kill \u00b7 ${m.mobs} mobs`,
        }),
      ]);
      list.append(row);
    }
    box.append(list);
  }

  private renderMapInfo(name: string | null): void {
    const info = this.refs.mapInfo;
    if (!info) return;
    clear(info);
    if (!name) {
      info.append(
        h("span", { class: "ms-map-empty", text: "No map selected yet." }),
      );
      return;
    }
    const m = this.mapByName(name);
    if (!m) {
      info.append(h("span", { class: "ms-map-empty", text: name }));
      return;
    }
    const chip = (label: string, value: string): HTMLElement =>
      h("div", { class: "ms-map-chip" }, [
        h("span", { class: "ms-map-chip-label", text: label }),
        h("span", { class: "ms-map-chip-val", text: value }),
      ]);
    const chips: HTMLElement[] = [
      chip("Region", m.region),
      chip("Street", m.street),
    ];
    if (m.avgLevel !== null) chips.push(chip("Avg Lv", String(m.avgLevel)));
    if (m.mobs !== null) chips.push(chip("Mobs", String(m.mobs)));
    if (m.types !== null) chips.push(chip("Types", String(m.types)));
    if (m.mobRate !== null) chips.push(chip("Mob rate", `${m.mobRate}x`));
    if (m.expPerKill !== null) chips.push(chip("EXP / kill", String(m.expPerKill)));
    info.append(h("div", { class: "ms-map-chips" }, chips));
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

  private async confirmReset(): Promise<void> {
    const ok = await themedConfirm({
      title: "Reset session",
      message: "Clear all captured screenshots and start over? This cannot be undone.",
      confirmText: "Reset",
      danger: true,
    });
    if (ok) {
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
        this.buildCoin(),
        h("span", { text: `${fmtInt(view.stats.mesoCurrent)} meso` }),
      ]),
    );
    clear(this.refs.charMap);
    if (view.currentMapName) {
      const m = this.mapByName(view.currentMapName);
      this.refs.charMap.append(
        h("span", { class: "ms-char-map-pin", text: "\u{1F4CD}" }),
        h("span", { class: "ms-char-map-name", text: view.currentMapName }),
        m ? h("span", { class: "ms-char-map-meta", text: this.mapMeta(m) }) : h("span"),
      );
    }

    // Session stats.
    const s = view.stats;
    this.refs.currentMap.textContent = view.currentMapName ?? "-";
    this.refs.screenshots.textContent = String(s.screenshotCount);
    this.refs.elapsed.textContent = fmtDuration(s.elapsedSeconds);
    this.refs.expGained.textContent = fmtInt(s.expGained);
    this.refs.expPerHour.textContent = fmtInt(s.expPerHour);
    this.refs.mesoCurrent.textContent =
      s.mesoCurrent !== null ? fmtInt(s.mesoCurrent) : "-";
    this.refs.mesoGained.textContent = fmtInt(s.mesoGained);
    this.refs.mesoPerHour.textContent = fmtInt(s.mesoPerHour);
    this.refs.netMeso.textContent = (view.netMeso >= 0 ? "+" : "") + fmtInt(view.netMeso);
    this.refs.netMeso.classList.toggle("pos", view.netMeso >= 0);
    this.refs.netMeso.classList.toggle("neg", view.netMeso < 0);
    const hrs = s.elapsedSeconds / 3600;
    const netPerHr = hrs > 0 ? view.netMeso / hrs : 0;
    this.refs.netMesoPerHour.textContent = (netPerHr >= 0 ? "+" : "") + fmtInt(netPerHr);
    this.refs.netMesoPerHour.classList.toggle("pos", netPerHr > 0);
    this.refs.netMesoPerHour.classList.toggle("neg", netPerHr < 0);

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
    this.renderGoalProjection(view);

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

    // Consumables / net meso.
    this.renderConsumables(view);

    // Current map.
    const mapInput = this.refs.mapInput as HTMLInputElement | undefined;
    if (mapInput && document.activeElement !== mapInput) {
      mapInput.value = view.currentMapName ?? "";
    }
    this.renderMapInfo(view.currentMapName);
    this.renderMapRecs(view.latestLevel);

    // Records table.
    this.renderRecords(view);

    // Sidebar pages that depend on data (saved sessions / dashboard).
    this.renderSidebar();
  }

  private renderConsumables(view: SessionView): void {
    const list = this.refs.consumablesList;
    clear(list);

    if (view.consumables.length === 0) {
      list.append(
        h("div", {
          class: "ms-empty",
          text: "No consumables added. Search an item above and enter how many you used this session.",
        }),
      );
    } else {
      for (const line of view.consumables) {
        const item = itemById(line.itemId);
        const name = item?.name ?? line.itemId;
        const cost = item && item.mesoCost !== null ? item.mesoCost : null;
        const subtotal = cost !== null ? cost * line.quantity : null;

        const icon = h("img", {
          class: "ms-consumable-icon",
          src: assetUrl(`assets/items/${line.itemId}.png`),
          alt: "",
        }) as HTMLImageElement;
        icon.addEventListener("error", () => icon.remove());

        const qtyInput = h("input", {
          type: "number",
          min: "0",
          value: String(line.quantity),
          class: "ms-consumable-qty",
          onchange: (ev: Event) => {
            const v = Math.max(0, Math.floor(Number((ev.target as HTMLInputElement).value) || 0));
            this.session.setConsumable(line.itemId, v);
          },
        });

        const calc = h("div", { class: "ms-consumable-calc" }, [
          qtyInput,
          h("span", { class: "ms-consumable-op", text: "\u00d7" }),
          h("span", {
            class: "ms-consumable-cost",
            text: cost !== null ? fmtInt(cost) : "?",
          }),
          h("span", { class: "ms-consumable-op", text: "=" }),
          h("span", {
            class: "ms-consumable-sub",
            text: subtotal !== null ? fmtInt(subtotal) : "\u2014",
          }),
        ]);
        list.append(
          h("div", { class: "ms-consumable-row" }, [
            icon,
            h("span", { class: "ms-consumable-name", text: name }),
            calc,
            h("button", {
              class: "ms-del",
              text: "\u00d7",
              title: "Remove",
              onclick: () => this.session.removeConsumable(line.itemId),
            }),
          ]),
        );
      }
    }

    this.refs.consSpent.textContent = fmtInt(view.mesoSpent);
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
