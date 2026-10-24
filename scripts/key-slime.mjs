/**
 * Keyer for slime3.png (green slime + yellow sparkles on a WHITE background).
 *
 * Removes the background with an edge flood-fill that treats light, low-
 * saturation pixels (white AND the grey shading/antialiasing in the stem-loop
 * area) as background. The slime body (saturated green), its outline (dark),
 * and the sparkle stars (saturated yellow) are all kept, including the slime's
 * own light shine, which is interior and never reached from the border.
 *
 * Run: node scripts/key-slime.mjs
 */
import Jimp from "jimp";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const SRC = join(root, "assets_raw", "slime3.png");
const OUT = join(root, "public", "assets", "slime.png");

const img = await Jimp.read(SRC);
const { width: w, height: h, data } = img.bitmap;
const n = w * h;
const at = (p) => p * 4;

// Background = transparent already, or light & nearly neutral (white or grey).
// Saturated colours (green slime, yellow sparkles, pink blush) never match, and
// the dark outline is too dark to match, so only backdrop pixels are removed.
function isBackground(p) {
  const i = at(p);
  if (data[i + 3] < 16) return true;
  const lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
  const spread = Math.max(data[i], data[i + 1], data[i + 2]) -
    Math.min(data[i], data[i + 1], data[i + 2]);
  return lum >= 170 && spread <= 34;
}

const visited = new Uint8Array(n);
const stack = [];
for (let x = 0; x < w; x++) stack.push(x, (h - 1) * w + x);
for (let y = 0; y < h; y++) stack.push(y * w, y * w + (w - 1));
while (stack.length) {
  const p = stack.pop();
  if (p < 0 || p >= n || visited[p]) continue;
  visited[p] = 1;
  if (!isBackground(p)) continue;
  data[at(p) + 3] = 0;
  const x = p % w;
  if (x > 0) stack.push(p - 1);
  if (x < w - 1) stack.push(p + 1);
  if (p >= w) stack.push(p - w);
  if (p < n - w) stack.push(p + w);
}

// Any light pocket fully enclosed by the stem loop (never reached from the
// border) would otherwise remain as a grey blob. Clear enclosed background
// pockets that are NOT surrounded by the green body, i.e. pockets bordered
// mainly by the dark stem / transparency - these are backdrop seen through the
// loop, not the slime's own shine.
const enclosed = new Uint8Array(n);
for (let p = 0; p < n; p++) {
  if (!visited[p] && isBackground(p)) enclosed[p] = 1;
}
const seen = new Uint8Array(n);
for (let start = 0; start < n; start++) {
  if (!enclosed[start] || seen[start]) continue;
  const comp = [];
  const q = [start];
  seen[start] = 1;
  let greenBorder = 0;
  let otherBorder = 0;
  while (q.length) {
    const p = q.pop();
    comp.push(p);
    const x = p % w;
    const neigh = [];
    if (x > 0) neigh.push(p - 1);
    if (x < w - 1) neigh.push(p + 1);
    if (p >= w) neigh.push(p - w);
    if (p < n - w) neigh.push(p + w);
    for (const np of neigh) {
      if (enclosed[np]) {
        if (!seen[np]) {
          seen[np] = 1;
          q.push(np);
        }
      } else {
        // classify the bordering (non-pocket) pixel
        const i = at(np);
        if (data[i + 3] === 0) {
          otherBorder++;
        } else {
          const g = data[i + 1];
          const spread = Math.max(data[i], data[i + 1], data[i + 2]) -
            Math.min(data[i], data[i + 1], data[i + 2]);
          if (spread > 34 && g >= data[i] && g >= data[i + 2]) greenBorder++;
          else otherBorder++;
        }
      }
    }
  }
  // If the pocket is mostly NOT green-bordered, it's loop backdrop -> clear it.
  if (greenBorder < otherBorder) {
    for (const p of comp) data[at(p) + 3] = 0;
  }
}

// Blend the pale cap / shine on the body into the slime's own green so it no
// longer reads as a white patch - no holes, no leftover outline. Sample a
// representative slime green, then map each pale body pixel onto that green
// while preserving its relative brightness.
let tr = 0, tg = 0, tb = 0, tc = 0;
for (let p = 0; p < n; p++) {
  const i = at(p);
  if (data[i + 3] === 0) continue;
  const spread = Math.max(data[i], data[i + 1], data[i + 2]) -
    Math.min(data[i], data[i + 1], data[i + 2]);
  if (spread > 60 && data[i + 1] === Math.max(data[i], data[i + 1], data[i + 2]) && data[i + 1] > 140) {
    tr += data[i]; tg += data[i + 1]; tb += data[i + 2]; tc++;
  }
}
if (tc > 0) {
  tr = Math.round(tr / tc);
  tg = Math.round(tg / tc);
  tb = Math.round(tb / tc);
  const targetLum = 0.299 * tr + 0.587 * tg + 0.114 * tb || 1;
  for (let p = 0; p < n; p++) {
    const i = at(p);
    if (data[i + 3] === 0) continue;
    const r = data[i], g = data[i + 1], b = data[i + 2];
    const lum = 0.299 * r + 0.587 * g + 0.114 * b;
    const isYellow = r > 170 && g > 170 && b < 130; // sparkle stars - keep
    // Light cap / shine: bright and not a sparkle. Recolour to slime green.
    if (lum >= 190 && !isYellow) {
      let scale = lum / targetLum;
      scale = scale < 0.8 ? 0.8 : scale > 1.12 ? 1.12 : scale;
      data[i] = Math.min(255, Math.round(tr * scale));
      data[i + 1] = Math.min(255, Math.round(tg * scale));
      data[i + 2] = Math.min(255, Math.round(tb * scale));
    }
  }
}

// Trim to the visible bounding box.
let minX = w, minY = h, maxX = -1, maxY = -1;
for (let y = 0; y < h; y++) {
  for (let x = 0; x < w; x++) {
    if (data[at(y * w + x) + 3] > 0) {
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
}
const pad = 2;
minX = Math.max(0, minX - pad);
minY = Math.max(0, minY - pad);
maxX = Math.min(w - 1, maxX + pad);
maxY = Math.min(h - 1, maxY + pad);
img.crop(minX, minY, maxX - minX + 1, maxY - minY + 1);
if (img.bitmap.width > 360 || img.bitmap.height > 360) img.scaleToFit(360, 360);
await img.writeAsync(OUT);
console.log(`slime3 -> public/assets/slime.png (${img.bitmap.width}x${img.bitmap.height})`);
