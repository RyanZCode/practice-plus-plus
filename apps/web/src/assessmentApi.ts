import {
  attemptAssessmentDraftResponseSchema,
  attemptAssessmentDraftSchema,
  attemptAssessmentRequestSchema,
  type AttemptAssessmentDraft,
  type AttemptAssessmentRequest,
} from "@practice-plus-plus/contracts";

function url(apiUrl: string, path: string): string {
  return `${apiUrl.replace(/\/$/, "")}/ai/assessment-drafts${path}`;
}

export async function loadAssessmentDraft(
  apiUrl: string,
  token: string,
  attemptId: string,
  fetcher: typeof fetch = fetch,
): Promise<AttemptAssessmentDraft | null> {
  const response = await fetcher(url(apiUrl, `/${encodeURIComponent(attemptId)}`), {
    cache: "no-store",
    headers: { authorization: `Bearer ${token}` },
  });
  if (!response.ok) throw new Error("The assessment draft could not be loaded.");
  return attemptAssessmentDraftResponseSchema.parse(await response.json()).draft;
}

export async function generateAssessmentDraft(
  apiUrl: string,
  token: string,
  input: AttemptAssessmentRequest,
  fetcher: typeof fetch = fetch,
): Promise<AttemptAssessmentDraft> {
  const request = attemptAssessmentRequestSchema.parse(input);
  const response = await fetcher(url(apiUrl, ""), {
    method: "POST",
    cache: "no-store",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(request),
  });
  if (!response.ok)
    throw new Error(
      response.status === 401
        ? "Sign in again to draft an assessment."
        : "The assessment draft could not be generated. Your attempt was not changed.",
    );
  return attemptAssessmentDraftSchema.parse(await response.json());
}
