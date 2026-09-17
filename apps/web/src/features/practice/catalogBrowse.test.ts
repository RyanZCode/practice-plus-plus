import type { CatalogProblem } from "@practice-plus-plus/contracts";
import { describe, expect, it } from "vitest";

import { browseCatalog, type CatalogBrowseOptions } from "./catalogBrowse";

const problems: CatalogProblem[] = [
  problem(217, "Contains Duplicate", "EASY", "AVAILABLE"),
  problem(1, "Two Sum", "EASY", "PAID_ONLY"),
  problem(33, "Search in Rotated Sorted Array", "MEDIUM", "AVAILABLE"),
  problem(4, "Median of Two Sorted Arrays", "HARD", "UNAVAILABLE"),
];

const defaults: CatalogBrowseOptions = {
  availability: [],
  difficulty: [],
  hidePaid: false,
  query: "",
  sort: "LEETCODE_ID",
  sortDirection: "ASC",
};

describe("catalog browsing", () => {
  it("searches case-insensitive titles and exact LeetCode numbers", () => {
    expect(
      browseCatalog(problems, { ...defaults, query: "sorted" }).map((item) => item.leetcodeId),
    ).toEqual([4, 33]);
    expect(browseCatalog(problems, { ...defaults, query: "217" })).toEqual([problems[0]]);
    expect(browseCatalog(problems, { ...defaults, query: "21" })).toEqual([]);
  });

  it("combines difficulty, availability, and paid-preference filters", () => {
    expect(
      browseCatalog(problems, {
        ...defaults,
        availability: ["AVAILABLE"],
        difficulty: ["EASY"],
      }),
    ).toEqual([problems[0]]);
    expect(
      browseCatalog(problems, { ...defaults, hidePaid: true }).map((item) => item.leetcodeId),
    ).toEqual([4, 33, 217]);
    expect(
      browseCatalog(problems, {
        ...defaults,
        difficulty: ["EASY", "HARD"],
      }).map((item) => item.leetcodeId),
    ).toEqual([1, 4, 217]);
  });

  it("sorts by number by default and supports title and difficulty order", () => {
    expect(browseCatalog(problems, defaults).map((item) => item.leetcodeId)).toEqual([
      1, 4, 33, 217,
    ]);
    expect(
      browseCatalog(problems, { ...defaults, sort: "TITLE" }).map((item) => item.title),
    ).toEqual([
      "Contains Duplicate",
      "Median of Two Sorted Arrays",
      "Search in Rotated Sorted Array",
      "Two Sum",
    ]);
    expect(
      browseCatalog(problems, { ...defaults, sort: "DIFFICULTY" }).map((item) => item.leetcodeId),
    ).toEqual([1, 217, 33, 4]);
    expect(
      browseCatalog(problems, { ...defaults, sortDirection: "DESC" }).map(
        (item) => item.leetcodeId,
      ),
    ).toEqual([217, 33, 4, 1]);
  });
});

function problem(
  leetcodeId: number,
  title: string,
  difficulty: CatalogProblem["difficulty"],
  availability: CatalogProblem["availability"],
): CatalogProblem {
  return {
    availability,
    difficulty,
    id: `00000000-0000-4000-8000-${String(leetcodeId).padStart(12, "0")}`,
    leetcodeId,
    slug: title.toLocaleLowerCase().replaceAll(" ", "-"),
    title,
    url: `https://leetcode.com/problems/${leetcodeId}/`,
  };
}
