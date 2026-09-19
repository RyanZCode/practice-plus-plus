import { describe, expect, it } from "vitest";

import {
  normalizeCatalog,
  parseCatalogSourceManifest,
  parseCatalogTagMapping,
} from "./catalogOfflineImport.js";

const mapping = parseCatalogTagMapping({
  version: 1,
  mapped: {
    array: ["Arrays & Hashing"],
    "hash table": ["Arrays & Hashing"],
    "two pointers": ["Two Pointers"],
  },
  ignored: ["interview"],
});

function manifest(rows: unknown[]) {
  return parseCatalogSourceManifest({
    version: 1,
    source: {
      kind: "CURATED",
      name: "Licensed problem metadata",
      datasetVersion: "2026-09-18",
      license: "Example license",
    },
    rows,
  });
}

describe("offline catalog import normalization", () => {
  it("normalizes source tags and preserves only catalog metadata", () => {
    const result = normalizeCatalog(
      manifest([
        {
          leetcodeId: "1",
          slug: "two-sum",
          title: "Two Sum",
          difficulty: "Easy",
          isPaidOnly: false,
          tags: ["array", "hash-table", "interview"],
          statement: "This must never appear in quarantine output",
        },
      ]),
      mapping,
    );

    expect(result.rows).toEqual([
      {
        row: 1,
        value: {
          availability: "AVAILABLE",
          difficulty: "EASY",
          leetcodeId: 1,
          patterns: ["Arrays & Hashing"],
          slug: "two-sum",
          title: "Two Sum",
          url: "https://leetcode.com/problems/two-sum/",
        },
      },
    ]);
    expect(result.quarantine).toEqual([]);
  });

  it("quarantines incomplete and ambiguous rows", () => {
    const result = normalizeCatalog(
      manifest([
        {
          leetcodeId: 1,
          slug: "one",
          title: "One",
          difficulty: "Easy",
          isPaidOnly: false,
          tags: ["unknown-topic"],
        },
        {
          leetcodeId: 2,
          slug: "two",
          title: "Two",
          difficulty: "Medium",
          tags: ["array"],
        },
        {
          leetcodeId: 3,
          slug: "three",
          title: "Three",
          difficulty: "Hard",
          availability: "AVAILABLE",
          isPaidOnly: true,
          tags: ["array"],
        },
      ]),
      mapping,
    );

    expect(result.rows).toEqual([]);
    expect(result.quarantine.map(({ code }) => code)).toEqual([
      "UNKNOWN_PATTERN_TAG",
      "UNKNOWN_AVAILABILITY",
      "CONFLICTING_AVAILABILITY",
    ]);
  });

  it("accepts already classified rows without requiring a tag mapping", () => {
    const result = normalizeCatalog(
      manifest([
        {
          leetcodeId: 1,
          slug: "two-sum",
          title: "Two Sum",
          difficulty: "EASY",
          availability: "AVAILABLE",
          patterns: ["Arrays & Hashing"],
        },
      ]),
      parseCatalogTagMapping({ version: 1, mapped: {}, ignored: [] }),
    );

    expect(result.rows[0]?.value.patterns).toEqual(["Arrays & Hashing"]);
  });

  it("keeps the first three source-ordered patterns when a row has more tags", () => {
    const result = normalizeCatalog(
      manifest([
        {
          leetcodeId: 1,
          slug: "many-tags",
          title: "Many Tags",
          difficulty: "Easy",
          isPaidOnly: false,
          tags: ["array", "two pointers", "binary search", "greedy"],
        },
      ]),
      parseCatalogTagMapping({
        version: 1,
        mapped: {
          array: ["Arrays & Hashing"],
          "two pointers": ["Two Pointers"],
          "binary search": ["Binary Search"],
          greedy: ["Greedy"],
        },
        ignored: [],
      }),
    );

    expect(result.quarantine).toEqual([]);
    expect(result.rows[0]?.value.patterns).toEqual([
      "Arrays & Hashing",
      "Two Pointers",
      "Binary Search",
    ]);
  });

  it("quarantines duplicate IDs and slugs without importing the duplicate row", () => {
    const result = normalizeCatalog(
      manifest([
        {
          leetcodeId: 1,
          slug: "two-sum",
          title: "Two Sum",
          difficulty: "Easy",
          availability: "AVAILABLE",
          patterns: ["Arrays & Hashing"],
        },
        {
          leetcodeId: 1,
          slug: "two-sum-copy",
          title: "Two Sum Copy",
          difficulty: "Easy",
          availability: "AVAILABLE",
          patterns: ["Arrays & Hashing"],
        },
      ]),
      mapping,
    );

    expect(result.rows).toHaveLength(1);
    expect(result.quarantine[0]?.code).toBe("DUPLICATE_LEETCODE_ID");
  });
});
