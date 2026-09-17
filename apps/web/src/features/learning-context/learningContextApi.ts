import {
  learnerGoalInputSchema,
  learnerGoalSchema,
  learningContextInferenceSchema,
  learningContextResponseSchema,
  memoryReviewSchema,
  teachingPreferenceInputSchema,
  teachingPreferenceSchema,
  type LearnerGoal,
  type LearnerGoalInput,
  type LearningContextInference,
  type LearningContextResponse,
  type MemoryReview,
  type TeachingPreference,
  type TeachingPreferenceInput,
} from "@practice-plus-plus/contracts";

function url(apiUrl: string, path = ""): string {
  return `${apiUrl.replace(/\/$/u, "")}/learning-context${path}`;
}

async function request(
  apiUrl: string,
  token: string,
  path: string,
  options: RequestInit,
  fetcher: typeof fetch,
): Promise<Response> {
  const response = await fetcher(url(apiUrl, path), {
    cache: "no-store",
    ...options,
    headers: {
      authorization: `Bearer ${token}`,
      ...(options.body === undefined ? {} : { "content-type": "application/json" }),
    },
  });
  if (!response.ok) {
    let message = "Learning context could not be updated.";
    const body = (await response.json().catch(() => null)) as { error?: unknown } | null;
    if (typeof body?.error === "string") message = body.error;
    throw new Error(
      response.status === 401 ? "Sign in again to manage learning context." : message,
    );
  }
  return response;
}

export async function loadLearningContext(
  apiUrl: string,
  token: string,
  fetcher: typeof fetch = fetch,
): Promise<LearningContextResponse> {
  const response = await request(apiUrl, token, "", {}, fetcher);
  return learningContextResponseSchema.parse(await response.json());
}

export async function createGoal(
  apiUrl: string,
  token: string,
  input: LearnerGoalInput,
  fetcher: typeof fetch = fetch,
): Promise<LearnerGoal> {
  const body = learnerGoalInputSchema.parse(input);
  const response = await request(
    apiUrl,
    token,
    "/goals",
    { method: "POST", body: JSON.stringify(body) },
    fetcher,
  );
  return learnerGoalSchema.parse(await response.json());
}

export async function updateGoal(
  apiUrl: string,
  token: string,
  id: string,
  input: LearnerGoalInput,
  fetcher: typeof fetch = fetch,
): Promise<LearnerGoal> {
  const body = learnerGoalInputSchema.parse(input);
  const response = await request(
    apiUrl,
    token,
    `/goals/${encodeURIComponent(id)}`,
    { method: "PUT", body: JSON.stringify(body) },
    fetcher,
  );
  return learnerGoalSchema.parse(await response.json());
}

export async function removeGoal(
  apiUrl: string,
  token: string,
  id: string,
  fetcher: typeof fetch = fetch,
): Promise<void> {
  await request(apiUrl, token, `/goals/${encodeURIComponent(id)}`, { method: "DELETE" }, fetcher);
}

export async function createTeachingPreference(
  apiUrl: string,
  token: string,
  input: TeachingPreferenceInput,
  fetcher: typeof fetch = fetch,
): Promise<TeachingPreference> {
  const body = teachingPreferenceInputSchema.parse(input);
  const response = await request(
    apiUrl,
    token,
    "/teaching-preferences",
    { method: "POST", body: JSON.stringify(body) },
    fetcher,
  );
  return teachingPreferenceSchema.parse(await response.json());
}

export async function updateTeachingPreference(
  apiUrl: string,
  token: string,
  id: string,
  input: TeachingPreferenceInput,
  fetcher: typeof fetch = fetch,
): Promise<TeachingPreference> {
  const body = teachingPreferenceInputSchema.parse(input);
  const response = await request(
    apiUrl,
    token,
    `/teaching-preferences/${encodeURIComponent(id)}`,
    { method: "PUT", body: JSON.stringify(body) },
    fetcher,
  );
  return teachingPreferenceSchema.parse(await response.json());
}

export async function removeTeachingPreference(
  apiUrl: string,
  token: string,
  id: string,
  fetcher: typeof fetch = fetch,
): Promise<void> {
  await request(
    apiUrl,
    token,
    `/teaching-preferences/${encodeURIComponent(id)}`,
    { method: "DELETE" },
    fetcher,
  );
}

export async function reviewInference(
  apiUrl: string,
  token: string,
  id: string,
  review: MemoryReview,
  fetcher: typeof fetch = fetch,
): Promise<LearningContextInference> {
  const body = memoryReviewSchema.parse(review);
  const response = await request(
    apiUrl,
    token,
    `/inferences/${encodeURIComponent(id)}`,
    { method: "PATCH", body: JSON.stringify(body) },
    fetcher,
  );
  return learningContextInferenceSchema.parse(await response.json());
}

export async function removeInference(
  apiUrl: string,
  token: string,
  id: string,
  fetcher: typeof fetch = fetch,
): Promise<void> {
  await request(
    apiUrl,
    token,
    `/inferences/${encodeURIComponent(id)}`,
    { method: "DELETE" },
    fetcher,
  );
}

export function learningContextExport(context: LearningContextResponse): string {
  return `${JSON.stringify(learningContextResponseSchema.parse(context), null, 2)}\n`;
}
