/**
 * MapleStory EXP table and level-distance math. Pure data + logic.
 *
 * EXP_TO_NEXT[level] is the EXP required to advance FROM `level` to `level + 1`
 * (column 2 of the in-game chart). The table is defined for levels 1..99, i.e.
 * it covers everything needed to reach the level cap of 100.
 *
 * Direct port of core/exp_table.py. All values are < Number.MAX_SAFE_INTEGER
 * (9.0e15) and cumulative sums to the cap stay well within it, so plain JS
 * numbers are safe here.
 */

// EXP required to go from a level to the next (level -> EXP-to-next).
export const EXP_TO_NEXT: Readonly<Record<number, number>> = {
  1: 15, 2: 34, 3: 57, 4: 92, 5: 135, 6: 372, 7: 560, 8: 840, 9: 1242,
  10: 1716, 11: 2360, 12: 3216, 13: 4200, 14: 5460, 15: 7050, 16: 8840,
  17: 11040, 18: 13716, 19: 16680, 20: 20216, 21: 24402, 22: 28980,
  23: 34320, 24: 40512, 25: 47216, 26: 54900, 27: 63666, 28: 73080,
  29: 83720, 30: 95700, 31: 108480, 32: 122760, 33: 138666, 34: 155540,
  35: 174216, 36: 194832, 37: 216600, 38: 240500, 39: 266682, 40: 294216,
  41: 324240, 42: 356916, 43: 391160, 44: 428280, 45: 468450, 46: 510420,
  47: 555680, 48: 604416, 49: 655200, 50: 709716, 51: 748608, 52: 789631,
  53: 832902, 54: 878545, 55: 926689, 56: 977471, 57: 1031036, 58: 1087536,
  59: 1147132, 60: 1209994, 61: 1276301, 62: 1346242, 63: 1420016,
  64: 1497832, 65: 1579913, 66: 1666492, 67: 1757815, 68: 1854143,
  69: 1955750, 70: 2062925, 71: 2175973, 72: 2295216, 73: 2420993,
  74: 2553663, 75: 2693603, 76: 2841212, 77: 2996910, 78: 3161140,
  79: 3334370, 80: 3517093, 81: 3709829, 82: 3913127, 83: 4127566,
  84: 4353756, 85: 4592341, 86: 4844001, 87: 5109452, 88: 5389449,
  89: 5684790, 90: 11938059, 91: 25069923, 92: 52646838, 93: 110558359,
  94: 232172553, 95: 487562361, 96: 1023880958, 97: 2150150011,
  98: 4515315023, 99: 9482161548,
};

// Highest level that has a defined EXP-to-next entry.
export const MAX_TABLE_LEVEL = Math.max(
  ...Object.keys(EXP_TO_NEXT).map((k) => Number(k)),
); // 99

// Highest level a character can reach using this table.
export const LEVEL_CAP = MAX_TABLE_LEVEL + 1; // 100

/** EXP needed to go from `level` to the next. null if out of table. */
export function expToNext(level: number): number | null {
  return EXP_TO_NEXT[level] ?? null;
}

/**
 * Total EXP still needed to go from the current position to `targetLevel`.
 *
 * `expInLevel` is the EXP already earned within the current level (the absolute
 * current-level EXP shown in game). Returns null when the levels are outside
 * the known table. Returns 0 when already at or past the target.
 */
export function expToReachLevel(
  currentLevel: number,
  expInLevel: number,
  targetLevel: number,
): number | null {
  if (currentLevel < 1 || targetLevel < 1) {
    return null;
  }
  if (targetLevel <= currentLevel) {
    return 0;
  }
  // We need every level from currentLevel up to targetLevel - 1.
  if (targetLevel - 1 > MAX_TABLE_LEVEL || currentLevel > MAX_TABLE_LEVEL) {
    return null;
  }

  // Finish the current level first (clamp against OCR noise).
  const currentTnl = EXP_TO_NEXT[currentLevel];
  let remaining = Math.max(0, currentTnl - Math.max(0, expInLevel));

  // Then full levels in between.
  for (let lvl = currentLevel + 1; lvl < targetLevel; lvl++) {
    remaining += EXP_TO_NEXT[lvl];
  }
  return remaining;
}
