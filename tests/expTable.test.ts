import { describe, it, expect } from "vitest";

import {
  EXP_TO_NEXT,
  expToNext,
  expToReachLevel,
  LEVEL_CAP,
  MAX_TABLE_LEVEL,
} from "../src/core/expTable.js";

describe("exp table constants", () => {
  it("covers levels 1..99 with the cap at 100", () => {
    expect(MAX_TABLE_LEVEL).toBe(99);
    expect(LEVEL_CAP).toBe(100);
    expect(expToNext(1)).toBe(15);
    expect(expToNext(99)).toBe(9482161548);
    expect(expToNext(100)).toBeNull();
  });

  it("all table values are safe integers", () => {
    for (const value of Object.values(EXP_TO_NEXT)) {
      expect(Number.isSafeInteger(value)).toBe(true);
    }
  });
});

describe("expToReachLevel", () => {
  it("is 0 when already at or past the target", () => {
    expect(expToReachLevel(10, 0, 10)).toBe(0);
    expect(expToReachLevel(10, 0, 5)).toBe(0);
  });

  it("subtracts in-level exp from the current level requirement", () => {
    // From level 1 (needs 15) with 5 already earned -> 10 to reach level 2.
    expect(expToReachLevel(1, 5, 2)).toBe(10);
  });

  it("sums the current level remainder plus full intermediate levels", () => {
    // From level 1 with 0 exp to level 3 = (15 - 0) + 34 = 49.
    expect(expToReachLevel(1, 0, 3)).toBe(49);
  });

  it("clamps noisy in-level exp that exceeds the requirement", () => {
    // in-level exp larger than the level requirement -> current level done.
    expect(expToReachLevel(1, 999, 3)).toBe(EXP_TO_NEXT[2]);
  });

  it("returns null outside the table", () => {
    expect(expToReachLevel(0, 0, 10)).toBeNull();
    expect(expToReachLevel(50, 0, 101)).toBeNull();
  });
});
