export { deriveReviewUrgency, type ReviewUrgency } from "./reviewUrgency.js";

export function getPracticeDate(timestamp: Date, timeZone: string, resetTime: string): string {
  if (Number.isNaN(timestamp.getTime())) {
    throw new RangeError("Invalid timestamp");
  }

  const resetMinutes = parseResetTime(resetTime);
  const local = localDateTime(timestamp, timeZone);
  const date =
    local.hour * 60 + local.minute < resetMinutes
      ? previousCalendarDate(local.year, local.month, local.day)
      : local;

  return `${date.year.toString().padStart(4, "0")}-${date.month
    .toString()
    .padStart(2, "0")}-${date.day.toString().padStart(2, "0")}`;
}

function localDateTime(timestamp: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
    minute: "2-digit",
    month: "2-digit",
    timeZone,
    year: "numeric",
  }).formatToParts(timestamp);

  return {
    day: partNumber(parts, "day"),
    hour: partNumber(parts, "hour"),
    minute: partNumber(parts, "minute"),
    month: partNumber(parts, "month"),
    year: partNumber(parts, "year"),
  };
}

function partNumber(parts: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes): number {
  const value = parts.find((part) => part.type === type)?.value;

  if (value === undefined) {
    throw new RangeError(`Unable to read local ${type}`);
  }

  return Number(value);
}

function parseResetTime(resetTime: string): number {
  const match = /^(?<hour>[01]\d|2[0-3]):(?<minute>[0-5]\d)$/.exec(resetTime);

  if (match?.groups === undefined) {
    throw new RangeError("Invalid reset time");
  }

  return Number(match.groups.hour) * 60 + Number(match.groups.minute);
}

function previousCalendarDate(year: number, month: number, day: number) {
  const date = new Date(Date.UTC(year, month - 1, day - 1));

  return {
    day: date.getUTCDate(),
    month: date.getUTCMonth() + 1,
    year: date.getUTCFullYear(),
  };
}
