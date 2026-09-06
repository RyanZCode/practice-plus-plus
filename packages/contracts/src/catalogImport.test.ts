import { describe, expect, it } from "vitest";

import {
  catalogImportRequestSchema,
  catalogImportRowSchema,
  catalogImportSourceSchema,
  mvpPatternNames,
} from "./index.js";

describe("catalog import contracts", () => {
  it("accepts the versioned envelope needed for the complete seed", () => {
    const rows = Array.from({ length: 150 }, (_, index) => ({ index }));

    expect(
      catalogImportRequestSchema.parse({
        version: 1,
        source: { kind: "CURATED", name: "NeetCode 150" },
        rows,
      }),
    ).toEqual({
      version: 1,
      source: { kind: "CURATED", name: "NeetCode 150" },
      rows,
    });
    expect(mvpPatternNames).toHaveLength(16);
  });

  it("rejects unsupported versions and oversized batches", () => {
    expect(
      catalogImportRequestSchema.safeParse({
        version: 2,
        source: { kind: "CURATED", name: "NeetCode 150" },
        rows: [{}],
      }).success,
    ).toBe(false);
    expect(
      catalogImportRequestSchema.safeParse({
        version: 1,
        source: { kind: "CURATED", name: "NeetCode 150" },
        rows: Array.from({ length: 201 }, () => ({})),
      }).success,
    ).toBe(false);
  });

  it("validates canonical problem metadata and defaults availability", () => {
    expect(
      catalogImportRowSchema.parse({
        leetcodeId: 1,
        slug: "two-sum",
        title: "Two Sum",
        difficulty: "EASY",
        url: "https://leetcode.com/problems/two-sum/",
        patterns: ["Arrays & Hashing"],
      }),
    ).toEqual({
      availability: "AVAILABLE",
      difficulty: "EASY",
      leetcodeId: 1,
      patterns: ["Arrays & Hashing"],
      slug: "two-sum",
      title: "Two Sum",
      url: "https://leetcode.com/problems/two-sum/",
    });
  });

  it("rejects mismatched URLs, duplicate tags, and noncanonical patterns", () => {
    expect(
      catalogImportRowSchema.safeParse({
        leetcodeId: 1,
        slug: "two-sum",
        title: "Two Sum",
        difficulty: "EASY",
        url: "https://leetcode.com/problems/three-sum/",
        patterns: ["Arrays & Hashing", "Arrays & Hashing"],
      }).success,
    ).toBe(false);
    expect(catalogImportSourceSchema.safeParse({ kind: "SCRAPED", name: "Unknown" }).success).toBe(
      false,
    );
  });
});
