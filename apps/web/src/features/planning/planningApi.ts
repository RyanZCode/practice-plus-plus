import {
  activeAttemptResponseSchema,
  dailyPlanSchema,
  planningPreviewSchema,
  planningRecommendationSchema,
  type DailyPlan,
  type Attempt,
  type PlanningPreview,
  type ProviderSelection,
} from "@practice-plus-plus/contracts";

async function post(
  apiUrl: string,
  token: string,
  path: string,
  body: unknown,
  conflictMessage = "That recommendation is stale or invalid. Create a new planning export.",
  failureMessage = "Unable to personalize the plan. Please try again.",
): Promise<unknown> {
  const response = await fetch(`${apiUrl.replace(/\/$/, "")}${path}`, {
    method: "POST",
    cache: "no-store",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    if (response.status === 401) throw new Error("Your session expired. Sign in again.");
    if (response.status === 409) throw new Error(conflictMessage);
    throw new Error(failureMessage);
  }
  return response.json();
}

export async function generateIntegratedPlan(
  apiUrl: string,
  token: string,
  selection: ProviderSelection,
  apiKey: string,
): Promise<DailyPlan> {
  return dailyPlanSchema.parse(
    await post(apiUrl, token, "/ai/planning/integrated", {
      selection,
      apiKey,
    }),
  );
}

export async function generateExtraPracticeWithAi(
  apiUrl: string,
  token: string,
  selection: ProviderSelection,
  apiKey: string,
): Promise<Attempt | null> {
  return activeAttemptResponseSchema.parse(
    await post(
      apiUrl,
      token,
      "/ai/planning/extra",
      {
        selection,
        apiKey,
      },
      "Unable to choose extra practice with AI. Try again or continue without AI.",
      "Unable to choose extra practice with AI. Try again or continue without AI.",
    ),
  ).attempt;
}

export async function validateExternalPlan(
  apiUrl: string,
  token: string,
  recommendation: unknown,
): Promise<PlanningPreview> {
  const parsed = planningRecommendationSchema.parse(recommendation);
  return planningPreviewSchema.parse(
    await post(apiUrl, token, "/ai/planning/external/validate", parsed),
  );
}

export async function confirmExternalPlan(
  apiUrl: string,
  token: string,
  recommendation: unknown,
): Promise<DailyPlan> {
  const parsed = planningRecommendationSchema.parse(recommendation);
  return dailyPlanSchema.parse(await post(apiUrl, token, "/ai/planning/external/confirm", parsed));
}
