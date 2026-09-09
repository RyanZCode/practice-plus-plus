import { describe, expect, it } from "vitest";
import { calculateDueDate } from "./index.js";

describe("calculateDueDate", () => {
  const intervals = { high: 2, medium: 5, low: 12 };
  it.each([
    ["HIGH", "2026-09-10"],
    ["MEDIUM", "2026-09-13"],
    ["LOW", "2026-09-20"],
  ] as const)("uses the configured %s interval", (urgency, expected) => {
    expect(calculateDueDate("2026-09-08", urgency, intervals)).toBe(expected);
  });
  it.each([
    ["2028-02-28", "2028-03-01"],
    ["2026-12-31", "2027-01-02"],
    ["2026-03-07", "2026-03-09"],
    ["2026-10-31", "2026-11-02"],
  ])("adds calendar days across boundaries from %s", (date, expected) => {
    expect(calculateDueDate(date, "HIGH", intervals)).toBe(expected);
  });
  it("rejects invalid dates and intervals", () => {
    for (const date of ["2026-02-29", "invalid", "2026-1-1"]) {
      expect(() => calculateDueDate(date, "HIGH", intervals)).toThrow(RangeError);
    }
    for (const high of [0, 91, 1.5]) {
      expect(() => calculateDueDate("2026-09-08", "HIGH", { ...intervals, high })).toThrow(
        RangeError,
      );
    }
  });
});
