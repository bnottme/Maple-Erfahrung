/**
 * Lightweight, dependency-free charts that match the app theme.
 * - donutChart: SVG ring with slice gaps + a center total, plus an HTML legend.
 * - barRows: horizontal CSS bars; optional diverging mode (profit right / loss
 *   left of a center line).
 * - lineChart: responsive SVG line with gradient area fill, gridlines and
 *   min/max labels.
 *
 * Datasets are tiny, so hand-drawn SVG/CSS keeps the bundle small and on-theme.
 */

import { h } from "./dom.js";
import { fmtInt } from "./format.js";

const SVG_NS = "http://www.w3.org/2000/svg";

function el(name: string): SVGElement {
  return document.createElementNS(SVG_NS, name);
}

export interface Slice {
  label: string;
  value: number;
  color: string;
}

/** A pleasant, theme-friendly palette for category charts. */
export const CHART_PALETTE = [
  "#f5811f",
  "#2f6fe0",
  "#3fa34d",
  "#e8a200",
  "#e5564a",
  "#8b5cf6",
  "#14b8a6",
  "#ec4899",
  "#64748b",
  "#a3621f",
];

/** Donut chart (SVG, with slice gaps + optional center text) + HTML legend. */
export function donutChart(
  slices: Slice[],
  size = 150,
  opts: { centerValue?: string; centerLabel?: string } = {},
): HTMLElement {
  const stroke = size * 0.2;
  const r = (size - stroke) / 2;
  const cx = size / 2;
  const cy = size / 2;
  const circ = 2 * Math.PI * r;
  const visible = slices.filter((s) => s.value > 0);
  const total = visible.reduce((a, s) => a + s.value, 0);
  const gap = visible.length > 1 ? circ * 0.014 : 0;

  const svg = el("svg");
  svg.setAttribute("viewBox", `0 0 ${size} ${size}`);
  svg.setAttribute("width", String(size));
  svg.setAttribute("height", String(size));
  svg.classList.add("ms-donut");

  const ring = (color: string, dash: number, offset: number) => {
    const c = el("circle");
    c.setAttribute("cx", String(cx));
    c.setAttribute("cy", String(cy));
    c.setAttribute("r", String(r));
    c.setAttribute("fill", "none");
    c.setAttribute("stroke", color);
    c.setAttribute("stroke-width", String(stroke));
    c.setAttribute("stroke-dasharray", `${Math.max(0, dash)} ${circ}`);
    c.setAttribute("stroke-dashoffset", String(offset));
    c.setAttribute("transform", `rotate(-90 ${cx} ${cy})`);
    return c;
  };

  // Base ring (shows through the gaps between slices).
  const base = ring("var(--line)", circ, 0);
  svg.appendChild(base);

  if (total > 0) {
    let acc = 0;
    for (const s of visible) {
      const seg = (s.value / total) * circ;
      svg.appendChild(ring(s.color, seg - gap, -acc));
      acc += seg;
    }
  }

  if (opts.centerValue) {
    const v = el("text");
    v.setAttribute("x", String(cx));
    v.setAttribute("y", String(cy - 1));
    v.setAttribute("text-anchor", "middle");
    v.setAttribute("dominant-baseline", "middle");
    v.setAttribute("font-size", String(Math.round(size * 0.14)));
    v.setAttribute("font-weight", "700");
    v.setAttribute("fill", "var(--ink)");
    v.textContent = opts.centerValue;
    svg.appendChild(v);
    if (opts.centerLabel) {
      const l = el("text");
      l.setAttribute("x", String(cx));
      l.setAttribute("y", String(cy + size * 0.11));
      l.setAttribute("text-anchor", "middle");
      l.setAttribute("dominant-baseline", "middle");
      l.setAttribute("font-size", String(Math.round(size * 0.08)));
      l.setAttribute("fill", "var(--ink-faint)");
      l.textContent = opts.centerLabel;
      svg.appendChild(l);
    }
  }

  const legend = h("div", { class: "ms-chart-legend" });
  for (const s of visible) {
    const pct = total > 0 ? Math.round((s.value / total) * 100) : 0;
    legend.append(
      h("div", { class: "ms-legend-row" }, [
        h("span", { class: "ms-legend-dot", style: `background:${s.color}` }),
        h("span", { class: "ms-legend-label", text: s.label }),
        h("span", { class: "ms-legend-val", text: `${fmtInt(s.value)} (${pct}%)` }),
      ]),
    );
  }

  const wrap = h("div", { class: "ms-donut-wrap" });
  wrap.append(svg as unknown as Node, legend);
  return wrap;
}

export interface Bar {
  label: string;
  value: number;
  color?: string;
  formatted?: string;
  /** Optional secondary value shown muted under the main value. */
  sub?: string;
}

/**
 * Horizontal bars scaled to the largest magnitude.
 * - default: left-anchored fill, colour per sign.
 * - diverging: a center line with positive bars extending right (green) and
 *   negative left (red) - ideal for profit/loss per session.
 */
export function barRows(
  bars: Bar[],
  opts: { signed?: boolean; diverging?: boolean } = {},
): HTMLElement {
  const maxAbs = Math.max(1, ...bars.map((b) => Math.abs(b.value)));
  const wrap = h("div", { class: "ms-chart-bars" });
  for (const b of bars) {
    const color = b.color ?? (b.value >= 0 ? "var(--green)" : "var(--red)");
    const valueText =
      b.formatted ?? (opts.signed && b.value >= 0 ? "+" : "") + fmtInt(b.value);

    let fill: HTMLElement;
    if (opts.diverging) {
      const halfPct = (Math.abs(b.value) / maxAbs) * 50;
      const left = b.value >= 0 ? 50 : 50 - halfPct;
      fill = h("div", {
        class: "ms-chart-bar-fill diverging",
        style: `left:${left}%;width:${halfPct}%;background:${color}`,
      });
    } else {
      const pct = (Math.abs(b.value) / maxAbs) * 100;
      fill = h("div", {
        class: "ms-chart-bar-fill",
        style: `width:${pct}%;background:${color}`,
      });
    }
    const track = h(
      "div",
      { class: `ms-chart-bar-track${opts.diverging ? " diverging" : ""}` },
      [fill],
    );
    const valueCell = h("div", { class: `ms-chart-bar-value${b.value < 0 ? " neg" : ""}` }, [
      h("span", { text: valueText }),
    ]);
    if (b.sub) valueCell.append(h("span", { class: "ms-chart-bar-sub", text: b.sub }));
    wrap.append(
      h("div", { class: "ms-chart-bar-row" }, [
        h("div", { class: "ms-chart-bar-label", title: b.label, text: b.label }),
        track,
        valueCell,
      ]),
    );
  }
  return wrap;
}

/** Compact number for bar-top labels, e.g. 1.9M / 460k. */
function compact(n: number): string {
  const a = Math.abs(n);
  if (a >= 1e6) return `${(n / 1e6).toFixed(1).replace(/\.0$/, "")}M`;
  if (a >= 1e3) return `${(n / 1e3).toFixed(1).replace(/\.0$/, "")}k`;
  return String(Math.round(n));
}

export interface Column {
  /** Group label shown underneath the bars (e.g. a session name). */
  label: string;
  /** One or more bars per group (e.g. EXP + meso). */
  bars: { value: number; color: string; name: string }[];
}

/**
 * Grouped vertical bar chart. Each group renders its bars side by side, scaled
 * to the largest value across the whole chart, with the group label beneath.
 * Optional legend maps colours to series names.
 */
export function columnChart(
  groups: Column[],
  opts: { height?: number; legend?: { name: string; color: string }[] } = {},
): HTMLElement {
  if (groups.length === 0) {
    return h("div", { class: "ms-chart-empty", text: "No sessions selected." });
  }
  const H = opts.height ?? 150;
  const max = Math.max(1, ...groups.flatMap((g) => g.bars.map((b) => Math.abs(b.value))));

  const plot = h("div", { class: "ms-col-plot", style: `height:${H}px` });
  for (const g of groups) {
    const bars = h("div", { class: "ms-col-bars" });
    for (const b of g.bars) {
      const pct = (Math.abs(b.value) / max) * 100;
      bars.append(
        h("div", { class: "ms-col-bar-wrap", title: `${b.name}: ${fmtInt(b.value)}` }, [
          h("span", { class: "ms-col-bar-top", text: compact(b.value) }),
          h("div", {
            class: "ms-col-bar",
            style: `height:${pct}%;background:${b.color}`,
          }),
        ]),
      );
    }
    plot.append(
      h("div", { class: "ms-col-group" }, [
        bars,
        h("div", { class: "ms-col-label", title: g.label, text: g.label }),
      ]),
    );
  }

  const wrap = h("div", { class: "ms-col-chart" });
  if (opts.legend && opts.legend.length) {
    const legend = h("div", { class: "ms-col-legend" });
    for (const s of opts.legend) {
      legend.append(
        h("div", { class: "ms-legend-row" }, [
          h("span", { class: "ms-legend-dot", style: `background:${s.color}` }),
          h("span", { class: "ms-legend-label", text: s.name }),
        ]),
      );
    }
    wrap.append(legend);
  }
  wrap.append(plot);
  return wrap;
}

export interface Point {
  x: number;
  y: number;
}

/**
 * Responsive SVG line chart with a gradient area fill, faint gridlines and
 * min/max labels. Stretches to container width (preserveAspectRatio none) with
 * non-scaling strokes so lines stay crisp; `currentColor` drives the theme.
 */
export function lineChart(
  points: Point[],
  opts: { color?: string; height?: number; zeroBaseline?: boolean } = {},
): HTMLElement {
  if (points.length < 2) {
    return h("div", { class: "ms-chart-empty", text: "Not enough data yet." });
  }
  const W = 300;
  const H = opts.height ?? 128;
  const pad = 8;
  const color = opts.color ?? "var(--accent)";

  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  let minX = Math.min(...xs);
  let maxX = Math.max(...xs);
  let minY = Math.min(...ys);
  let maxY = Math.max(...ys);
  if (opts.zeroBaseline) {
    minY = Math.min(minY, 0);
    maxY = Math.max(maxY, 0);
  }
  if (maxX === minX) maxX = minX + 1;
  if (maxY === minY) maxY = minY + 1;

  const sx = (x: number) => pad + ((x - minX) / (maxX - minX)) * (W - 2 * pad);
  const sy = (y: number) => pad + (1 - (y - minY) / (maxY - minY)) * (H - 2 * pad);

  const svg = el("svg");
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.setAttribute("preserveAspectRatio", "none");
  svg.classList.add("ms-line");
  (svg as unknown as HTMLElement).style.color = color;

  // Gradient area fill (uses currentColor so it follows the theme).
  const gid = `ln${Math.random().toString(36).slice(2)}`;
  const defs = el("defs");
  const grad = el("linearGradient");
  grad.setAttribute("id", gid);
  grad.setAttribute("x1", "0");
  grad.setAttribute("y1", "0");
  grad.setAttribute("x2", "0");
  grad.setAttribute("y2", "1");
  const s0 = el("stop");
  s0.setAttribute("offset", "0");
  s0.setAttribute("stop-color", "currentColor");
  s0.setAttribute("stop-opacity", "0.28");
  const s1 = el("stop");
  s1.setAttribute("offset", "1");
  s1.setAttribute("stop-color", "currentColor");
  s1.setAttribute("stop-opacity", "0");
  grad.appendChild(s0);
  grad.appendChild(s1);
  defs.appendChild(grad);
  svg.appendChild(defs);

  // Gridlines.
  for (const k of [0.25, 0.5, 0.75]) {
    const gy = pad + (H - 2 * pad) * k;
    const line = el("line");
    line.setAttribute("x1", String(pad));
    line.setAttribute("x2", String(W - pad));
    line.setAttribute("y1", String(gy));
    line.setAttribute("y2", String(gy));
    line.setAttribute("stroke", "var(--line)");
    line.setAttribute("stroke-width", "1");
    line.setAttribute("vector-effect", "non-scaling-stroke");
    svg.appendChild(line);
  }

  const linePts = points.map((p) => `${sx(p.x).toFixed(1)},${sy(p.y).toFixed(1)}`).join(" ");
  const baseY = H - pad;
  const area = el("polygon");
  area.setAttribute(
    "points",
    `${sx(points[0].x).toFixed(1)},${baseY} ${linePts} ${sx(points[points.length - 1].x).toFixed(1)},${baseY}`,
  );
  area.setAttribute("fill", `url(#${gid})`);
  svg.appendChild(area);

  const poly = el("polyline");
  poly.setAttribute("points", linePts);
  poly.setAttribute("fill", "none");
  poly.setAttribute("stroke", "currentColor");
  poly.setAttribute("stroke-width", "2");
  poly.setAttribute("stroke-linejoin", "round");
  poly.setAttribute("stroke-linecap", "round");
  poly.setAttribute("vector-effect", "non-scaling-stroke");
  svg.appendChild(poly);

  const wrap = h("div", { class: "ms-line-wrap" }, [
    svg as unknown as Node,
    h("span", { class: "ms-line-axis top", text: fmtInt(maxY) }),
    h("span", { class: "ms-line-axis bottom", text: fmtInt(minY) }),
  ]);
  return wrap;
}
