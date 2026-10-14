import type { StreakCalendarResponse } from "@practice-plus-plus/contracts";
import { loadStreakCalendar } from "../analytics/analyticsApi";

export function previousPracticeDates(practiceDate: string): string[] {
  const end = new Date(`${practiceDate}T00:00:00Z`);
  return Array.from({ length: 7 }, (_, index) => {
    const day = new Date(end);
    day.setUTCDate(day.getUTCDate() + index - 7);
    return day.toISOString().slice(0, 10);
  });
}

export async function loadRecentPractice(
  apiUrl: string,
  token: string,
  fetcher: typeof fetch = fetch,
) {
  const calendar = await loadStreakCalendar(apiUrl, token, undefined, fetcher);
  const dates = previousPracticeDates(calendar.asOfPracticeDate);
  const previousMonth = dates[0]!.slice(0, 7);
  const earlier =
    previousMonth === calendar.month
      ? []
      : (await loadStreakCalendar(apiUrl, token, previousMonth, fetcher)).days;
  const days = new Map([...earlier, ...calendar.days].map((day) => [day.date, day]));
  return {
    practiceDate: calendar.asOfPracticeDate,
    currentStreak: calendar.currentStreak,
    days: dates.map((date) => days.get(date)!),
  };
}

export type RecentPractice = {
  practiceDate: string;
  currentStreak: number;
  days: StreakCalendarResponse["days"];
};

export function practiceDateLabel(date: string, options: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat(undefined, { ...options, timeZone: "UTC" }).format(
    new Date(`${date}T00:00:00Z`),
  );
}
