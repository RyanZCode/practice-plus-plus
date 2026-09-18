import {
  patternEvidenceResponseSchema,
  streakCalendarResponseSchema,
  type PatternEvidenceResponse,
  type StreakCalendarResponse,
} from "@practice-plus-plus/contracts";

export async function loadAnalytics(
  apiUrl: string,
  token: string,
  fetcher: typeof fetch = fetch,
): Promise<PatternEvidenceResponse> {
  const response = await fetcher(`${apiUrl.replace(/\/$/, "")}/analytics/patterns`, {
    cache: "no-store",
    headers: { authorization: `Bearer ${token}` },
  });
  if (!response.ok) {
    if (response.status === 401) throw new Error("Your session expired. Sign in again.");
    throw new Error("Unable to load analytics. Please try again.");
  }
  return patternEvidenceResponseSchema.parse(await response.json());
}

export async function loadStreakCalendar(
  apiUrl: string,
  token: string,
  month?: string,
  fetcher: typeof fetch = fetch,
): Promise<StreakCalendarResponse> {
  const query = month === undefined ? "" : `?month=${encodeURIComponent(month)}`;
  const response = await fetcher(`${apiUrl.replace(/\/$/, "")}/analytics/streak${query}`, {
    cache: "no-store",
    headers: { authorization: `Bearer ${token}` },
  });
  if (!response.ok) {
    if (response.status === 401) throw new Error("Your session expired. Sign in again.");
    throw new Error("Unable to load your streak calendar. Please try again.");
  }
  return streakCalendarResponseSchema.parse(await response.json());
}
