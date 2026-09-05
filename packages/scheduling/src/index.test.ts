import { describe, expect, it } from "vitest";

import { getPracticeDate } from "./index.js";

describe("getPracticeDate", () => {
  it("uses the previous date immediately before reset", () => {
    expect(getPracticeDate(new Date("2026-01-15T08:59:59.999Z"), "America/Toronto", "04:00")).toBe(
      "2026-01-14",
    );
  });

  it("uses the current date at reset", () => {
    expect(getPracticeDate(new Date("2026-01-15T09:00:00.000Z"), "America/Toronto", "04:00")).toBe(
      "2026-01-15",
    );
  });

  it.each([
    ["before the spring transition reset", "2026-03-08T07:59:59.999Z", "2026-03-07"],
    ["at the spring transition reset", "2026-03-08T08:00:00.000Z", "2026-03-08"],
    ["before the fall transition reset", "2026-11-01T08:59:59.999Z", "2026-10-31"],
    ["at the fall transition reset", "2026-11-01T09:00:00.000Z", "2026-11-01"],
  ])("handles %s", (_description, timestamp, expected) => {
    expect(getPracticeDate(new Date(timestamp), "America/Toronto", "04:00")).toBe(expected);
  });

  it("uses the requested timezone rather than the server-local timezone", () => {
    const timestamp = new Date("2026-01-01T02:00:00.000Z");

    expect(getPracticeDate(timestamp, "Pacific/Kiritimati", "04:00")).toBe("2026-01-01");
    expect(getPracticeDate(timestamp, "America/Los_Angeles", "04:00")).toBe("2025-12-31");
  });

  it("rejects invalid timestamps and reset times", () => {
    expect(() => getPracticeDate(new Date(Number.NaN), "UTC", "04:00")).toThrow(
      "Invalid timestamp",
    );
    expect(() => getPracticeDate(new Date(), "UTC", "24:00")).toThrow("Invalid reset time");
  });
});
