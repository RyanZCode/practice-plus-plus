import { describe, expect, it } from "vitest";

import {
  catalogImportBatchReviewSchema,
  catalogProblemInputSchema,
  catalogReviewDecisionRequestSchema,
} from "./index.js";

describe("catalog review contracts", () => {
  it("validates editable problem metadata and canonical tags", () => {
    expect(
      catalogProblemInputSchema.parse({
        leetcodeId: 1,
        slug: "two-sum",
        title: "Two Sum",
        difficulty: "EASY",
        url: "https://leetcode.com/problems/two-sum/",
        patterns: ["Arrays & Hashing"],
      }),
    ).toMatchObject({ availability: "AVAILABLE", patterns: ["Arrays & Hashing"] });
  });

  it("accepts only explicit approval or rejection decisions", () => {
    expect(catalogReviewDecisionRequestSchema.parse({ decision: "APPROVED" })).toEqual({
      decision: "APPROVED",
    });
    expect(catalogReviewDecisionRequestSchema.safeParse({ decision: "DRAFT" }).success).toBe(false);
  });

  it("requires review and publication provenance fields in inspection results", () => {
    const result = catalogImportBatchReviewSchema.safeParse({
      id: "2be016de-58c9-4ca2-8f96-8cc03c980958",
      version: 1,
      source: { kind: "CURATED", name: "NeetCode 150" },
      createdAt: "2026-09-05T12:00:00.000Z",
      createdByUserProfileId: "61a6afc6-d4de-4a61-879c-7ca6bdb5f6b1",
      problems: [
        {
          id: "53a735b6-58cc-4ce3-b58a-44ac67ca23c2",
          importBatchId: "2be016de-58c9-4ca2-8f96-8cc03c980958",
          leetcodeId: 1,
          slug: "two-sum",
          title: "Two Sum",
          difficulty: "EASY",
          url: "https://leetcode.com/problems/two-sum/",
          availability: "AVAILABLE",
          patterns: ["Arrays & Hashing"],
          reviewStatus: "APPROVED",
          published: false,
          reviewedAt: "2026-09-05T13:00:00.000Z",
          reviewedByUserProfileId: "61a6afc6-d4de-4a61-879c-7ca6bdb5f6b1",
          publishedAt: null,
          publishedByUserProfileId: null,
        },
      ],
    });

    expect(result.success).toBe(true);
  });
});
