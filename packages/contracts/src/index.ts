import { z } from "zod";

const wholeDaysSchema = z.number().int().min(1).max(90);

export const practiceSettingsSchema = z
  .strictObject({
    dailyTarget: z.number().int().min(1).max(10),
    redoIntervals: z.strictObject({
      high: wholeDaysSchema,
      low: wholeDaysSchema,
      medium: wholeDaysSchema,
    }),
    resetTime: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/),
    timeZone: z
      .string()
      .trim()
      .min(1)
      .max(100)
      .refine(isValidTimeZone, { message: "Invalid time zone" }),
  })
  .refine((settings) => settings.redoIntervals.high <= settings.redoIntervals.medium, {
    message: "Medium interval must be at least the high interval",
    path: ["redoIntervals", "medium"],
  })
  .refine((settings) => settings.redoIntervals.medium <= settings.redoIntervals.low, {
    message: "Low interval must be at least the medium interval",
    path: ["redoIntervals", "low"],
  });

export const practiceSettingsResponseSchema = z.strictObject({
  settings: practiceSettingsSchema.nullable(),
});

export type PracticeSettings = z.infer<typeof practiceSettingsSchema>;
export type PracticeSettingsResponse = z.infer<typeof practiceSettingsResponseSchema>;

export const mvpPatternNames = [
  "Arrays & Hashing",
  "Two Pointers",
  "Sliding Window",
  "Stack",
  "Binary Search",
  "Linked List",
  "Trees",
  "Heap / Priority Queue",
  "Backtracking",
  "Tries",
  "Graphs",
  "Dynamic Programming",
  "Greedy",
  "Intervals",
  "Math",
  "Bit Manipulation",
] as const;

export const catalogImportSourceSchema = z.strictObject({
  kind: z.enum(["CURATED", "LLM_GENERATED"]),
  name: z.string().trim().min(1).max(255),
});

export const catalogImportRequestSchema = z.strictObject({
  version: z.literal(1),
  source: catalogImportSourceSchema,
  rows: z.array(z.unknown()).min(1).max(200),
});

export const catalogImportRowSchema = z
  .strictObject({
    leetcodeId: z.number().int().positive(),
    slug: z
      .string()
      .trim()
      .min(1)
      .max(255)
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    title: z.string().trim().min(1).max(255),
    difficulty: z.enum(["EASY", "MEDIUM", "HARD"]),
    url: z.string().url().max(500),
    availability: z.enum(["AVAILABLE", "PAID_ONLY", "UNAVAILABLE"]).default("AVAILABLE"),
    patterns: z
      .array(z.enum(mvpPatternNames))
      .min(1)
      .max(3)
      .refine((patterns) => new Set(patterns).size === patterns.length, {
        message: "Pattern names must be unique",
      }),
  })
  .superRefine((row, context) => {
    if (row.url !== `https://leetcode.com/problems/${row.slug}/`) {
      context.addIssue({
        code: "custom",
        message: "URL must be the canonical LeetCode URL for the slug",
        path: ["url"],
      });
    }
  });

export const catalogImportErrorSchema = z.strictObject({
  row: z.number().int().positive(),
  code: z.enum(["INVALID_ROW", "DUPLICATE_LEETCODE_ID", "DUPLICATE_SLUG", "UNKNOWN_PATTERN"]),
  message: z.string().min(1),
});

export const catalogImportResponseSchema = z.strictObject({
  batchId: z.string().uuid().nullable(),
  importedCount: z.number().int().nonnegative(),
  errors: z.array(catalogImportErrorSchema),
});

export type CatalogImportError = z.infer<typeof catalogImportErrorSchema>;
export type CatalogImportRow = z.infer<typeof catalogImportRowSchema>;
export type CatalogImportSource = z.infer<typeof catalogImportSourceSchema>;
export type CatalogImportResponse = z.infer<typeof catalogImportResponseSchema>;

function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en", { timeZone }).format();
    return true;
  } catch {
    return false;
  }
}
