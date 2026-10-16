import {
  streakCalendarResponseSchema,
  type StreakCalendarResponse,
} from "@practice-plus-plus/contracts";
import type { PrismaClient } from "../../shared/generated/prisma/client.js";
import { HttpError } from "../../shared/errors.js";
import { practiceDateFor } from "../daily-plan/dailyPlan.js";

export type DailyCompletionRecord = {
  practiceDate: string;
  requiredCount: number;
  completedCount: number;
};

export interface StreakStore {
  calendar(userProfileId: string, now: Date, month?: string): Promise<StreakCalendarResponse>;
}

export function buildStreakCalendar(
  records: readonly DailyCompletionRecord[],
  asOfPracticeDate: string,
  month?: string,
  fallbackRequiredCount?: number,
): StreakCalendarResponse {
  const asOfDay = calendarDay(asOfPracticeDate);
  const selectedMonth = month ?? asOfPracticeDate.slice(0, 7);
  const { year, monthNumber, daysInMonth } = parseMonth(selectedMonth);
  function quotaFor(date: string) {
    const known = findRequiredCount(records, date);
    return date === asOfPracticeDate
      ? (fallbackRequiredCount ?? known)
      : (known ?? fallbackRequiredCount);
  }
  const observed = records
    .filter((record) => calendarDay(record.practiceDate) <= asOfDay)
    .map((record) => ({
      ...record,
      requiredCount:
        record.requiredCount > 0 ? record.requiredCount : (quotaFor(record.practiceDate) ?? 0),
    }))
    .toSorted((left, right) => left.practiceDate.localeCompare(right.practiceDate));
  const trackingStartDate = observed[0]?.practiceDate ?? null;
  const recordByDate = new Map(observed.map((record) => [record.practiceDate, record]));
  const trackingStartDay = trackingStartDate === null ? null : calendarDay(trackingStartDate);

  return streakCalendarResponseSchema.parse({
    asOfPracticeDate,
    currentStreak: currentStreak(recordByDate, asOfDay, trackingStartDay),
    trackingStartDate,
    month: selectedMonth,
    days: Array.from({ length: daysInMonth }, (_, index) => {
      const date = `${year.toString().padStart(4, "0")}-${monthNumber
        .toString()
        .padStart(2, "0")}-${(index + 1).toString().padStart(2, "0")}`;
      const record = recordByDate.get(date);
      const day = calendarDay(date);
      const dayStatus = status(day, asOfDay, trackingStartDay, record);
      const inferredRequiredCount =
        (dayStatus === "MISSED" || dayStatus === "CURRENT") && record === undefined
          ? (quotaFor(date) ?? null)
          : null;
      return {
        date,
        status: dayStatus,
        isCurrent: date === asOfPracticeDate,
        requiredCount: record?.requiredCount ?? inferredRequiredCount,
        completedCount: record?.completedCount ?? (inferredRequiredCount === null ? null : 0),
        neutralReason: null,
      };
    }),
  });
}

export function createPrismaStreakStore(client: PrismaClient): StreakStore {
  const select = {
    practiceDate: true,
    requiredCount: true,
  } as const;

  return {
    async calendar(userProfileId, now, month) {
      const [settings, savedPlan] = await Promise.all([
        client.practiceSettings.findUnique({
          where: { userProfileId },
          select: { timeZone: true, resetMinutes: true, dailyTarget: true },
        }),
        client.dailyPlan.findUnique({
          where: { userProfileId },
          select: { practiceDate: true, timeZone: true, resetMinutes: true, target: true },
        }),
      ]);
      if (settings === null)
        throw new HttpError(409, "Save practice settings before viewing streaks.");
      const asOfPracticeDate =
        savedPlan !== null && practiceDateFor(now, savedPlan) === date(savedPlan.practiceDate)
          ? date(savedPlan.practiceDate)
          : practiceDateFor(now, settings);
      const [records, attempts] = await Promise.all([
        client.dailyCompletion.findMany({
          where: { userProfileId, practiceDate: { lte: toDate(asOfPracticeDate) } },
          orderBy: { practiceDate: "asc" },
          select,
        }),
        client.attempt.groupBy({
          by: ["practiceDate", "outcome"],
          where: {
            userProfileId,
            practiceDate: { lte: toDate(asOfPracticeDate) },
            confirmedAt: { not: null },
            outcome: { in: ["INDEPENDENT", "ASSISTED", "GAVE_UP", "INCOMPLETE"] },
          },
          _count: { _all: true },
        }),
      ]);
      const counts = new Map<string, number>();
      for (const attempt of attempts) {
        const practiceDate = date(attempt.practiceDate);
        counts.set(
          practiceDate,
          (counts.get(practiceDate) ?? 0) +
            (attempt.outcome === "INCOMPLETE" ? 0 : attempt._count._all),
        );
      }
      const history = records.map((record) => ({
        practiceDate: date(record.practiceDate),
        requiredCount: record.requiredCount,
        completedCount: counts.get(date(record.practiceDate)) ?? 0,
      }));
      const recordedDates = new Set(history.map((record) => record.practiceDate));
      for (const [practiceDate, completedCount] of counts) {
        if (!recordedDates.has(practiceDate))
          history.push({
            practiceDate,
            completedCount,
            requiredCount:
              practiceDate === asOfPracticeDate &&
              savedPlan !== null &&
              date(savedPlan.practiceDate) === asOfPracticeDate
                ? savedPlan.target
                : (findRequiredCount(history, practiceDate) ?? settings.dailyTarget),
          });
      }
      const target =
        savedPlan !== null && date(savedPlan.practiceDate) === asOfPracticeDate
          ? savedPlan.target
          : settings.dailyTarget;
      return buildStreakCalendar(history, asOfPracticeDate, month, target);
    },
  };
}

function currentStreak(
  records: ReadonlyMap<string, DailyCompletionRecord>,
  asOfDay: number,
  trackingStartDay: number | null,
): number {
  if (trackingStartDay === null) return 0;

  let streak = 0;
  let day = asOfDay;
  while (day >= trackingStartDay) {
    const record = records.get(dateFromDay(day));
    if (day === asOfDay && (record === undefined || record.completedCount < record.requiredCount)) {
      day -= 1;
      continue;
    }
    if (
      record !== undefined &&
      record.requiredCount > 0 &&
      record.completedCount >= record.requiredCount
    ) {
      streak += 1;
      day -= 1;
      continue;
    }
    break;
  }
  return streak;
}

function status(
  day: number,
  asOfDay: number,
  trackingStartDay: number | null,
  record: DailyCompletionRecord | undefined,
) {
  if (day > asOfDay) return "FUTURE" as const;
  if (
    record !== undefined &&
    record.requiredCount > 0 &&
    record.completedCount >= record.requiredCount
  )
    return "COMPLETED" as const;
  if (record !== undefined && record.completedCount > 0) return "PARTIAL" as const;
  if (day === asOfDay) return "CURRENT" as const;
  if (trackingStartDay === null || day < trackingStartDay) return "UNTRACKED" as const;
  return "MISSED" as const;
}

function findRequiredCount(records: readonly DailyCompletionRecord[], date: string): number | null {
  const known = records
    .filter((record) => record.requiredCount > 0)
    .toSorted((left, right) => left.practiceDate.localeCompare(right.practiceDate));
  return (
    known.filter((record) => record.practiceDate <= date).at(-1)?.requiredCount ??
    known[0]?.requiredCount ??
    null
  );
}

function parseMonth(value: string) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) throw new RangeError("Invalid calendar month.");
  const year = Number(value.slice(0, 4));
  const monthNumber = Number(value.slice(5, 7));
  return {
    year,
    monthNumber,
    daysInMonth: new Date(Date.UTC(year, monthNumber, 0)).getUTCDate(),
  };
}

function calendarDay(value: string): number {
  const parsed = toDate(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || parsed.toISOString().slice(0, 10) !== value) {
    throw new RangeError("Invalid practice date.");
  }
  return parsed.getTime() / 86_400_000;
}

function toDate(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

function date(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function dateFromDay(value: number): string {
  return new Date(value * 86_400_000).toISOString().slice(0, 10);
}
