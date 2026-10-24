import { describe, it, expect } from "vitest";

import {
  computeExpGained,
  computeMesoGained,
  computeStats,
  latestMeso,
  latestRecordWithExpPercent,
  overallExpRate,
  parseIntFromText,
  parsePercentFromText,
  remainingExpToLevel,
  windowedStats,
} from "../src/core/calculations.js";
import type { ScreenshotRecord } from "../src/core/models.js";

function rec(
  capturedAt: number,
  fields: Partial<ScreenshotRecord> = {},
): ScreenshotRecord {
  return {
    id: `r${capturedAt}`,
    fileName: `s${capturedAt}.png`,
    capturedAt,
    exp: null,
    meso: null,
    expPercent: null,
    level: null,
    characterName: null,
    ocrText: "",
    ...fields,
  };
}

describe("parseIntFromText", () => {
  it("returns null for empty/no-digit text", () => {
    expect(parseIntFromText("")).toBeNull();
    expect(parseIntFromText("no numbers here")).toBeNull();
  });

  it("strips grouping separators and takes the largest run", () => {
    expect(parseIntFromText("EXP 1,234,567 abc")).toBe(1234567);
    expect(parseIntFromText("12 and 3,456")).toBe(3456);
  });

  it("reads a single digit", () => {
    expect(parseIntFromText("7")).toBe(7);
  });
});

describe("parsePercentFromText", () => {
  it("pulls a percentage with decimals", () => {
    expect(parsePercentFromText("12.34%")).toBeCloseTo(12.34);
  });

  it("accepts comma decimals", () => {
    expect(parsePercentFromText("5,50 %")).toBeCloseTo(5.5);
  });

  it("returns null when absent", () => {
    expect(parsePercentFromText("1234")).toBeNull();
    expect(parsePercentFromText("")).toBeNull();
  });
});

describe("computeExpGained", () => {
  it("sums only positive deltas so a level-up reset does not subtract", () => {
    const records = [
      rec(0, { exp: 900 }),
      rec(10, { exp: 1000 }), // +100
      rec(20, { exp: 50 }), // level-up reset, ignored
      rec(30, { exp: 200 }), // +150
    ];
    expect(computeExpGained(records)).toBe(250);
  });

  it("skips records without exp", () => {
    const records = [rec(0, { exp: 100 }), rec(10), rec(20, { exp: 300 })];
    expect(computeExpGained(records)).toBe(200);
  });
});

describe("meso helpers", () => {
  it("computeMesoGained is net last-minus-first", () => {
    const records = [rec(0, { meso: 1000 }), rec(10, { meso: 2500 })];
    expect(computeMesoGained(records)).toBe(1500);
  });

  it("computeMesoGained is 0 with fewer than two readings", () => {
    expect(computeMesoGained([rec(0, { meso: 1000 })])).toBe(0);
  });

  it("latestMeso returns the most recent meso", () => {
    const records = [rec(10, { meso: 2500 }), rec(0, { meso: 1000 })];
    expect(latestMeso(records)).toBe(2500);
  });
});

describe("overallExpRate", () => {
  it("is exp/hour over the span", () => {
    // 3600s span, 1000 exp gained -> 1000/hour
    const records = [rec(0, { exp: 0 }), rec(3600, { exp: 1000 })];
    expect(overallExpRate(records)).toBeCloseTo(1000);
  });

  it("returns 0 when span is below the reliability threshold", () => {
    const records = [rec(0, { exp: 0 }), rec(2, { exp: 1000 })];
    expect(overallExpRate(records)).toBe(0);
  });

  it("returns 0 with fewer than two readings", () => {
    expect(overallExpRate([rec(0, { exp: 10 })])).toBe(0);
  });
});

describe("remainingExpToLevel", () => {
  it("infers remaining from exp + percent", () => {
    // 50 exp at 50% -> full level 100 -> remaining 50
    expect(remainingExpToLevel(rec(0, { exp: 50, expPercent: 50 }))).toBe(50);
  });

  it("returns null at boundary percents", () => {
    expect(remainingExpToLevel(rec(0, { exp: 50, expPercent: 0 }))).toBeNull();
    expect(remainingExpToLevel(rec(0, { exp: 50, expPercent: 100 }))).toBeNull();
  });
});

describe("latestRecordWithExpPercent", () => {
  it("returns most recent with both exp and positive percent", () => {
    const records = [
      rec(0, { exp: 10, expPercent: 5 }),
      rec(10, { exp: 20, expPercent: 10 }),
      rec(20, { exp: 30 }),
    ];
    expect(latestRecordWithExpPercent(records)?.capturedAt).toBe(10);
  });
});

describe("computeStats", () => {
  it("returns empty stats for no records", () => {
    const s = computeStats([]);
    expect(s.screenshotCount).toBe(0);
    expect(s.expGained).toBe(0);
  });

  it("summarizes a session", () => {
    const records = [
      rec(0, { exp: 0, meso: 1000 }),
      rec(3600, { exp: 1000, meso: 2000 }),
    ];
    const s = computeStats(records);
    expect(s.screenshotCount).toBe(2);
    expect(s.elapsedSeconds).toBe(3600);
    expect(s.expGained).toBe(1000);
    expect(s.expPerHour).toBeCloseTo(1000);
    expect(s.mesoCurrent).toBe(2000);
    expect(s.mesoGained).toBe(1000);
  });
});

describe("windowedStats", () => {
  it("has no data with fewer than two exp readings", () => {
    const w = windowedStats([rec(0, { exp: 10 })], 900);
    expect(w.hasData).toBe(false);
    expect(w.etaSeconds).toBeNull();
  });

  it("measures the rate inside a populated window", () => {
    // Two readings 3600s apart, +3600 exp -> 3600/hour; window 3600s.
    const records = [
      rec(0, { exp: 0, expPercent: 50 }),
      rec(3600, { exp: 3600, expPercent: 50 }),
    ];
    const w = windowedStats(records, 3600);
    expect(w.estimated).toBe(false);
    expect(w.expPerHour).toBeCloseTo(3600);
    expect(w.hasData).toBe(true);
  });
});
