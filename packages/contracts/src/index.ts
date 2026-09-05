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

function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en", { timeZone }).format();
    return true;
  } catch {
    return false;
  }
}
