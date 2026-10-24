/**
 * One-off asset cleaner. Reads raw sprite images from assets_raw/, keys out the
 * light "transparency checkerboard" / white background via an edge flood-fill
 * (MapleStory sprites have solid dark outlines, so interior whites are kept),
 * trims to the sprite's bounding box, and writes transparent PNGs to
 * public/assets/. Also emits a small favicon from the mushroom.
 *
 * Run: node scripts/crop-assets.mjs
 */
import Jimp from "jimp";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const RAW = join(root, "assets_raw");
const OUT = join(root, "public", "assets");

// input file -> output name (without extension), capped to `max` px on the
// long edge (sprites display small, so there's no need to ship full-res).
// MsSlime.jpg / pig1.jpg are intentionally omitted: the slime's gloss is open
// to its background so auto-keying leaks; add them back with cleaner sources.
const JOBS = [
  { in: "mushroom1.jpg", out: "portrait", max: 240 },
  { in: "octo1.png", out: "octopus", max: 240 },
];

// A pixel counts as background if it's already transparent, or light and nearly
// grey (white / checkerboard grey), which is never true of the dark sprite
// outline or the saturated/cream interior.
function isBackground(r, g, b, a) {
  if (a < 16) return true;
  const lum = 0.299 * r + 0.587 * g + 0.114 * b;
  const spread = Math.max(r, g, b) - Math.min(r, g, b);
  return lum >= 190 && spread <= 30;
}

async function processImage(job) {
  const img = await Jimp.read(join(RAW, job.in));
  const { width: w, height: h, data } = img.bitmap;
  const idx = (x, y) => (y * w + x) * 4;

  const visited = new Uint8Array(w * h);
  const stack = [];
  const pushBorder = () => {
    for (let x = 0; x < w; x++) {
      stack.push([x, 0], [x, h - 1]);
    }
    for (let y = 0; y < h; y++) {
      stack.push([0, y], [w - 1, y]);
    }
  };
  pushBorder();

  while (stack.length) {
    const [x, y] = stack.pop();
    if (x < 0 || y < 0 || x >= w || y >= h) continue;
    const p = y * w + x;
    if (visited[p]) continue;
    visited[p] = 1;
    const i = idx(x, y);
    if (!isBackground(data[i], data[i + 1], data[i + 2], data[i + 3])) continue;
    data[i + 3] = 0; // clear alpha
    stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
  }

  // Bounding box of remaining (visible) pixels.
  let minX = w, minY = h, maxX = -1, maxY = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (data[idx(x, y) + 3] > 0) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) {
    throw new Error(`${job.in}: nothing left after background removal`);
  }
  const pad = 2;
  minX = Math.max(0, minX - pad);
  minY = Math.max(0, minY - pad);
  maxX = Math.min(w - 1, maxX + pad);
  maxY = Math.min(h - 1, maxY + pad);
  img.crop(minX, minY, maxX - minX + 1, maxY - minY + 1);

  if (job.max && (img.bitmap.width > job.max || img.bitmap.height > job.max)) {
    img.scaleToFit(job.max, job.max);
  }

  await img.writeAsync(join(OUT, `${job.out}.png`));
  console.log(`${job.in} -> public/assets/${job.out}.png (${img.bitmap.width}x${img.bitmap.height})`);
  return img;
}

async function main() {
  await Jimp.read(join(RAW, JOBS[0].in)); // fail fast if raw folder missing
  let mushroom = null;
  for (const job of JOBS) {
    try {
      const out = await processImage(job);
      if (job.out === "portrait") mushroom = out;
    } catch (err) {
      console.warn(`skip ${job.in}: ${err.message}`);
    }
  }
  if (mushroom) {
    const fav = mushroom.clone().contain(64, 64);
    await fav.writeAsync(join(OUT, "favicon.png"));
    console.log("favicon.png (64x64) from mushroom");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
