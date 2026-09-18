import {
  streakCalendarResponseSchema,
  type DailyCompletionNeutralReason,
  type DailyCompletionState,
  type StreakCalendarResponse,
} from "@practice-plus-plus/contracts";
import type { PrismaClient, Prisma } from "../../shared/generated/prisma/client.js";
import { HttpError } from "../../shared/errors.js";
import { practiceDateFor } from "../daily-plan/dailyPlan.js";

export type DailyCompletionRecord = {
  practiceDate: string;
  requiredCount: number;
  completedCount: number;
  state: DailyCompletionState;
  neutralReason: DailyCompletionNeutralReason | null;
};

export interface StreakStore {
  calendar(userProfileId: string, now: Date, month?: string): Promise<StreakCalendarResponse>;
}

export function buildStreakCalendar(
  records: readonly DailyCompletionRecord[],
  asOfPracticeDate: string,
  month?: string,
): StreakCalendarResponse {
  const asOfDay = calendarDay(asOfPracticeDate);
  const selectedMonth = month ?? asOfPracticeDate.slice(0, 7);
  const { year, monthNumber, daysInMonth } = parseMonth(selectedMonth);
  const observed = records
    .filter((record) => calendarDay(record.practiceDate) <= asOfDay)
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
      return {
        date,
        status: status(day, asOfDay, trackingStartDay, record),
        isCurrent: date === asOfPracticeDate,
        requiredCount: record?.requiredCount ?? null,
        completedCount: record?.completedCount ?? null,
        neutralReason: record?.neutralReason ?? null,
      };
    }),
  });
}

export function createPrismaStreakStore(client: PrismaClient): StreakStore {
  const select = {
    practiceDate: true,
    requiredCount: true,
    completedCount: true,
    state: true,
    neutralReason: true,
  } as const;
  type Record = Prisma.DailyCompletionGetPayload<{ select: typeof select }>;

  return {
    async calendar(userProfileId, now, month) {
      const [settings, savedPlan] = await Promise.all([
        client.practiceSettings.findUnique({
          where: { userProfileId },
          select: { timeZone: true, resetMinutes: true },
        }),
        client.dailyPlan.findUnique({
          where: { userProfileId },
          select: { practiceDate: true, timeZone: true, resetMinutes: true },
        }),
      ]);
      if (settings === null)
        throw new HttpError(409, "Save practice settings before viewing streaks.");
      const asOfPracticeDate =
        savedPlan !== null && practiceDateFor(now, savedPlan) === date(savedPlan.practiceDate)
          ? date(savedPlan.practiceDate)
          : practiceDateFor(now, settings);
      const records = await client.dailyCompletion.findMany({
        where: {
          userProfileId,
          practiceDate: { lte: toDate(asOfPracticeDate) },
        },
        orderBy: { practiceDate: "asc" },
        select,
      });
      return buildStreakCalendar(records.map(toRecord), asOfPracticeDate, month);
    },
  };

  function toRecord(record: Record): DailyCompletionRecord {
    return {
      practiceDate: date(record.practiceDate),
      requiredCount: record.requiredCount,
      completedCount: record.completedCount,
      state: record.state,
      neutralReason: isNeutralReason(record.neutralReason) ? record.neutralReason : null,
    };
  }
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
    if (day === asOfDay && (record === undefined || record.state === "ACTIVE")) {
      day -= 1;
      continue;
    }
    if (record?.state === "NEUTRAL") {
      day -= 1;
      continue;
    }
    if (record?.state === "FULFILLED") {
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
  if (record?.state === "NEUTRAL") return "NEUTRAL" as const;
  if (record?.state === "FULFILLED") return "COMPLETED" as const;
  if (day === asOfDay) return "CURRENT" as const;
  if (trackingStartDay === null || day < trackingStartDay) return "UNTRACKED" as const;
  return "MISSED" as const;
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

function isNeutralReason(value: string | null): value is DailyCompletionNeutralReason {
  return value === "NO_PRACTICE_AVAILABLE" || value === "BOUNDARY_CHANGE";
}
