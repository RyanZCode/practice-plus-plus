import type { Prisma } from "../../shared/generated/prisma/client.js";

const neutralReasons = {
  boundaryChange: "BOUNDARY_CHANGE",
  noPracticeAvailable: "NO_PRACTICE_AVAILABLE",
} as const;

type PlanBoundary = {
  practiceDate: Date;
  timeZone: string;
  resetMinutes: number;
};

type NewPlan = PlanBoundary & {
  target: number;
  itemCount: number;
};

export async function ensureDailyCompletion(
  tx: Prisma.TransactionClient,
  userProfileId: string,
  previousPlan: PlanBoundary | null,
  plan: NewPlan,
): Promise<void> {
  const practiceDate = date(plan.practiceDate);
  const existing = await tx.dailyCompletion.findUnique({
    where: {
      userProfileId_practiceDate: {
        userProfileId,
        practiceDate: toDate(practiceDate),
      },
    },
    select: { practiceDate: true },
  });
  if (existing !== null) return;

  const trackingStart = await tx.dailyCompletion.findFirst({
    where: { userProfileId },
    orderBy: { practiceDate: "asc" },
    select: { practiceDate: true },
  });
  if (
    trackingStart !== null &&
    previousPlan !== null &&
    (previousPlan.timeZone !== plan.timeZone || previousPlan.resetMinutes !== plan.resetMinutes)
  ) {
    const previousDate = date(previousPlan.practiceDate);
    const transitionDates = datesBetween(previousDate, practiceDate);
    if (transitionDates.length > 0) {
      await tx.dailyCompletion.createMany({
        data: transitionDates.map((transitionDate) => ({
          userProfileId,
          practiceDate: toDate(transitionDate),
          requiredCount: 0,
          completedCount: 0,
          state: "NEUTRAL" as const,
          neutralReason: neutralReasons.boundaryChange,
        })),
        skipDuplicates: true,
      });
    }
  }

  const requiredCount = Math.min(plan.target, plan.itemCount);
  await tx.dailyCompletion.create({
    data: {
      userProfileId,
      practiceDate: toDate(practiceDate),
      requiredCount,
      completedCount: 0,
      state: requiredCount === 0 ? "NEUTRAL" : "ACTIVE",
      neutralReason: requiredCount === 0 ? neutralReasons.noPracticeAvailable : null,
    },
  });
}

export async function updateDailyCompletionForAttempt(
  tx: Prisma.TransactionClient,
  userProfileId: string,
  attemptId: string,
  outcome: string,
  confirmedAt: Date,
): Promise<void> {
  if (outcome !== "INDEPENDENT" && outcome !== "ASSISTED" && outcome !== "GAVE_UP") return;

  const item = await tx.dailyPlanItem.findFirst({
    where: { userProfileId, attemptId },
    select: { plan: { select: { practiceDate: true } } },
  });
  if (item === null) return;

  const practiceDate = date(item.plan.practiceDate);
  const where = {
    userProfileId_practiceDate: {
      userProfileId,
      practiceDate: toDate(practiceDate),
    },
  } as const;
  const completion = await tx.dailyCompletion.findUnique({
    where,
    select: { state: true, requiredCount: true, completedCount: true },
  });
  if (completion === null || completion.state !== "ACTIVE") return;

  const completedCount = Math.min(completion.requiredCount, completion.completedCount + 1);
  await tx.dailyCompletion.update({
    where,
    data: {
      completedCount,
      ...(completedCount === completion.requiredCount
        ? { state: "FULFILLED" as const, fulfilledAt: confirmedAt }
        : {}),
    },
  });
}

function datesBetween(start: string, end: string): string[] {
  const dates: string[] = [];
  let current = addDays(start, 1);
  while (current < end) {
    dates.push(current);
    current = addDays(current, 1);
  }
  return dates;
}

function addDays(value: string, amount: number): string {
  const parsed = toDate(value);
  parsed.setUTCDate(parsed.getUTCDate() + amount);
  return date(parsed);
}

function toDate(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

function date(value: Date): string {
  return value.toISOString().slice(0, 10);
}
