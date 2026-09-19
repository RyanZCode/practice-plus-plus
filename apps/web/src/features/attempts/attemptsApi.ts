import {
  dailyPlanSchema,
  savedDailyPlanResponseSchema,
  activeAttemptResponseSchema,
  attemptHistoryResponseSchema,
  type AttemptHistoryQuery,
  attemptSchema,
  catalogResponseSchema,
  type Attempt,
  type CatalogProblem,
  type ConfirmAttempt,
  type ReportAttempt,
} from "@practice-plus-plus/contracts";

async function request(
  apiUrl: string,
  token: string,
  path: string,
  body?: object,
  method?: "PUT",
): Promise<unknown> {
  const response = await fetch(`${apiUrl.replace(/\/$/, "")}${path}`, {
    method: method ?? (body === undefined ? "GET" : "POST"),
    headers: {
      authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!response.ok) {
    if (response.status === 401) throw new Error("Your session expired. Sign in again.");
    if (response.status === 409)
      throw new Error(
        "The attempt changed or conflicts with recorded help. Reload practice and check your outcome.",
      );
    throw new Error("Unable to load or update practice. Please try again.");
  }
  return response.json();
}
export async function loadProblems(apiUrl: string, token: string): Promise<CatalogProblem[]> {
  return catalogResponseSchema.parse(await request(apiUrl, token, "/catalog/problems")).problems;
}

export async function loadActiveAttempt(apiUrl: string, token: string): Promise<Attempt | null> {
  return activeAttemptResponseSchema.parse(await request(apiUrl, token, "/attempts/active"))
    .attempt;
}
export async function loadAttemptHistory(
  apiUrl: string,
  token: string,
  query: AttemptHistoryQuery,
) {
  const params = new URLSearchParams();
  if (query.before !== undefined) params.set("before", query.before);
  if (query.beforeId !== undefined) params.set("beforeId", query.beforeId);
  return attemptHistoryResponseSchema.parse(await request(apiUrl, token, `/attempts?${params}`));
}
export async function startAttempt(
  apiUrl: string,
  token: string,
  problemId: string,
): Promise<Attempt> {
  return attemptSchema.parse(await request(apiUrl, token, "/attempts", { problemId }));
}
export async function skipTimer(
  apiUrl: string,
  token: string,
  attemptId: string,
): Promise<Attempt> {
  return attemptSchema.parse(await request(apiUrl, token, `/attempts/${attemptId}/skip-timer`, {}));
}

export async function pauseTimer(
  apiUrl: string,
  token: string,
  attemptId: string,
): Promise<Attempt> {
  return attemptSchema.parse(
    await request(apiUrl, token, `/attempts/${attemptId}/pause-timer`, {}),
  );
}

export async function resumeTimer(
  apiUrl: string,
  token: string,
  attemptId: string,
): Promise<Attempt> {
  return attemptSchema.parse(
    await request(apiUrl, token, `/attempts/${attemptId}/resume-timer`, {}),
  );
}

export async function reviewSolution(
  apiUrl: string,
  token: string,
  attemptId: string,
): Promise<Attempt> {
  return attemptSchema.parse(
    await request(apiUrl, token, `/attempts/${attemptId}/review-solution`, { giveUp: true }),
  );
}

export async function confirmAttempt(
  apiUrl: string,
  token: string,
  attemptId: string,
  input: ConfirmAttempt,
): Promise<Attempt> {
  return attemptSchema.parse(await request(apiUrl, token, `/attempts/${attemptId}/confirm`, input));
}

export async function reportAttempt(
  apiUrl: string,
  token: string,
  attemptId: string,
  input: ReportAttempt,
): Promise<Attempt> {
  return attemptSchema.parse(
    await request(apiUrl, token, `/attempts/${attemptId}/report-result`, input),
  );
}

export async function overrideReview(
  apiUrl: string,
  token: string,
  attemptId: string,
  manualDueDate: string | null,
): Promise<Attempt> {
  return attemptSchema.parse(
    await request(apiUrl, token, `/attempts/${attemptId}/review`, { manualDueDate }, "PUT"),
  );
}

export async function loadDailyPlan(apiUrl: string, token: string) {
  return dailyPlanSchema.parse(await request(apiUrl, token, "/daily-plan"));
}

export async function loadSavedDailyPlan(apiUrl: string, token: string) {
  return savedDailyPlanResponseSchema.parse(await request(apiUrl, token, "/daily-plan/saved")).plan;
}
