import { describe, expect, it } from "vitest";

import { parseLeetcodeCsv } from "./leetcodeCsv.js";

const source = {
  name: "User-supplied LeetCode metadata",
  datasetVersion: "2026-09-18",
  license: "User-authorized private dogfood use",
};

describe("LeetCode CSV conversion", () => {
  it("converts links, paid status, topics, and category fallbacks", () => {
    const manifest = parseLeetcodeCsv(
      [
        "ID,Title,Difficulty,Link,Topics,Premium Only,Category",
        '1,"Two Sum, Revised",Easy,https://leetcode.com/problems/two-sum/,"Array, Hash Table",False,Algorithms',
        "2,Database Task,Hard,https://leetcode.com/problems/database-task/,,True,Database",
      ].join("\n"),
      source,
    );

    expect(manifest.rows).toEqual([
      {
        leetcodeId: "1",
        slug: "two-sum",
        title: "Two Sum, Revised",
        difficulty: "Easy",
        url: "https://leetcode.com/problems/two-sum/",
        isPaidOnly: false,
        tags: ["Array", "Hash Table"],
      },
      {
        leetcodeId: "2",
        slug: "database-task",
        title: "Database Task",
        difficulty: "Hard",
        url: "https://leetcode.com/problems/database-task/",
        isPaidOnly: true,
        tags: ["Database"],
      },
    ]);
  });

  it("uses an array fallback when a row has no topic or category", () => {
    const manifest = parseLeetcodeCsv(
      [
        "ID,Title,Difficulty,Link,Topics,Premium Only,Category",
        "1,No Topics,Easy,https://leetcode.com/problems/no-topics/,,False,",
      ].join("\n"),
      source,
    );

    expect(manifest.rows[0]).toMatchObject({ tags: ["array"] });
  });

  it("rejects a CSV without required metadata columns", () => {
    expect(() => parseLeetcodeCsv("ID,Title\n1,Incomplete", source)).toThrow(
      "LeetCode CSV is missing the required column: Difficulty",
    );
  });
});
