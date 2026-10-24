import { defineConfig } from "vitest/config";

// The core/ logic is pure and runs in a plain Node environment for tests.
// Modules that touch the DOM (image.ts, ocr.ts, storage.ts) are exercised in
// the browser, not here; core math is what we unit-test.
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
});
