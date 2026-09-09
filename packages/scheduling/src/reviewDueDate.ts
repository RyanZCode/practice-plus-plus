import type { PracticeSettings } from "@practice-plus-plus/contracts";
import type { ReviewUrgency } from "./reviewUrgency.js";

export function calculateDueDate(
  practiceDate: string,
  urgency: ReviewUrgency,
  intervals: PracticeSettings["redoIntervals"],
): string {
  const date = new Date(`${practiceDate}T00:00:00.000Z`);
  const days = { HIGH: intervals.high, MEDIUM: intervals.medium, LOW: intervals.low }[urgency];
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(practiceDate) ||
    Number.isNaN(date.getTime()) ||
    date.toISOString().slice(0, 10) !== practiceDate ||
    !Number.isInteger(days) ||
    days < 1 ||
    days > 90
  ) {
    throw new RangeError("Invalid review date or interval.");
  }
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
