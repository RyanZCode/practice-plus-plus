import {
  checkpointRequestSchema,
  checkpointResponseSchema,
  memorySuggestionListResponseSchema,
  type CheckpointRequest,
  type CheckpointResponse,
  type CoachRequest,
  type MemorySuggestion,
} from "@practice-plus-plus/contracts";

export function checkpointMessages<T extends CoachRequest["messages"][number]>(
  messages: readonly T[],
): CoachRequest["messages"] {
  return messages.map(({ role, content }) => ({ role, content }));
}

function url(apiUrl: string, path: string): string {
  return `${apiUrl.replace(/\/$/, "")}/ai/${path}`;
}

export async function saveCheckpoint(
  apiUrl: string,
  token: string,
  input: CheckpointRequest,
  fetcher: typeof fetch = fetch,
): Promise<CheckpointResponse> {
  const request = checkpointRequestSchema.parse(input);
  const response = await fetcher(url(apiUrl, "checkpoints"), {
    method: "POST",
    cache: "no-store",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(request),
  });
  if (!response.ok)
    throw new Error(
      response.status === 401
        ? "Sign in again to save a learning checkpoint."
        : "The learning checkpoint could not be saved. Your conversation is still available in this tab.",
    );
  return checkpointResponseSchema.parse(await response.json());
}

export async function loadMemorySuggestions(
  apiUrl: string,
  token: string,
  attemptId?: string,
  fetcher: typeof fetch = fetch,
): Promise<MemorySuggestion[]> {
  const query = attemptId === undefined ? "" : `?attemptId=${encodeURIComponent(attemptId)}`;
  const response = await fetcher(url(apiUrl, `memory-suggestions${query}`), {
    cache: "no-store",
    headers: { authorization: `Bearer ${token}` },
  });
  if (!response.ok) throw new Error("Memory suggestions could not be loaded.");
  return memorySuggestionListResponseSchema.parse(await response.json()).memorySuggestions;
}

export function needsCheckpoint(messages: { content: string }[]): boolean {
  return (
    messages.length >= 10 ||
    new TextEncoder().encode(JSON.stringify(messages)).byteLength >= 40 * 1024
  );
}
