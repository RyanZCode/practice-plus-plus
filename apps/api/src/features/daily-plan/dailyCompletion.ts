import type { Prisma } from "../../shared/generated/prisma/client.js";

export async function ensureDailyCompletion(
  tx: Prisma.TransactionClient,
  userProfileId: string,
  plan: { practiceDate: Date; target: number },
): Promise<void> {
  const where = { userProfileId_practiceDate: { userProfileId, practiceDate: plan.practiceDate } };
  const existing = await tx.dailyCompletion.findUnique({ where, select: { requiredCount: true } });
  if (existing !== null && existing.requiredCount > 0) return;
  await tx.dailyCompletion.upsert({
    where,
    create: {
      userProfileId,
      practiceDate: plan.practiceDate,
      requiredCount: plan.target,
      completedCount: 0,
      state: "ACTIVE",
    },
    update: { requiredCount: plan.target, state: "ACTIVE", neutralReason: null },
  });
}

export async function updateDailyCompletionForAttempt(
  tx: Prisma.TransactionClient,
  userProfileId: string,
  practiceDate: Date,
  confirmedAt: Date,
): Promise<void> {
  const where = { userProfileId_practiceDate: { userProfileId, practiceDate } };
  const completion = await tx.dailyCompletion.findUnique({
    where,
    select: { requiredCount: true, fulfilledAt: true },
  });
  let requiredCount = completion?.requiredCount ?? 0;
  if (requiredCount === 0) {
    const plan = await tx.dailyPlan.findUnique({
      where: { userProfileId },
      select: { practiceDate: true, target: true },
    });
    if (plan !== null && plan.practiceDate.getTime() === practiceDate.getTime()) {
      requiredCount = plan.target;
    } else {
      const settings = await tx.practiceSettings.findUniqueOrThrow({
        where: { userProfileId },
        select: { dailyTarget: true },
      });
      requiredCount = settings.dailyTarget;
    }
  }
  const completedCount = await tx.attempt.count({
    where: {
      userProfileId,
      practiceDate,
      confirmedAt: { not: null },
      outcome: { in: ["INDEPENDENT", "ASSISTED", "GAVE_UP"] },
    },
  });
  const data = {
    requiredCount,
    completedCount,
    state: completedCount >= requiredCount ? ("FULFILLED" as const) : ("ACTIVE" as const),
    fulfilledAt: completedCount >= requiredCount ? (completion?.fulfilledAt ?? confirmedAt) : null,
    neutralReason: null,
  };
  await tx.dailyCompletion.upsert({
    where,
    create: { userProfileId, practiceDate, ...data },
    update: data,
  });
}
