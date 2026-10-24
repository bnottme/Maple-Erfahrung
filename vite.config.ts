import { defineConfig } from "vite";

// Static, client-only site. No backend: OCR, calculations and storage all run
// in the browser. `base` is relative so the built site works on GitHub Pages,
// Cloudflare Pages, Netlify, or any static host regardless of sub-path.
export default defineConfig({
  base: '/Maple-Erfahrung/',
  build: {
    target: "es2020",
    outDir: "dist",
    sourcemap: true,
  },
});
