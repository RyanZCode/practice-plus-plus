import {
  coachEventSchema,
  type CoachRequest,
  type TutorRequest,
} from "@practice-plus-plus/contracts";

export async function streamCoach(
  apiUrl: string,
  token: string,
  input: CoachRequest,
  signal: AbortSignal,
  onText: (text: string) => void,
  fetcher: typeof fetch = fetch,
): Promise<void> {
  return streamChat("coach", apiUrl, token, input, signal, onText, fetcher);
}

export async function streamTutor(
  apiUrl: string,
  token: string,
  input: TutorRequest,
  signal: AbortSignal,
  onText: (text: string) => void,
  fetcher: typeof fetch = fetch,
): Promise<void> {
  return streamChat("tutor", apiUrl, token, input, signal, onText, fetcher);
}

async function streamChat(
  mode: "coach" | "tutor",
  apiUrl: string,
  token: string,
  input: CoachRequest | TutorRequest,
  signal: AbortSignal,
  onText: (text: string) => void,
  fetcher: typeof fetch,
): Promise<void> {
  const response = await fetcher(`${apiUrl.replace(/\/$/, "")}/ai/${mode}`, {
    method: "POST",
    signal,
    cache: "no-store",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!response.ok || response.body === null) {
    throw new Error(
      response.status === 401
        ? `Sign in again to use the ${mode}.`
        : `The ${mode} request failed. Check your key and model, then try again.`,
    );
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let buffer = "";
  let bytes = 0;
  try {
    while (true) {
      const part = await reader.read();
      bytes += part.value?.byteLength ?? 0;
      if (bytes > 2 * 1024 * 1024) throw new Error(`The ${mode} response was too long.`);
      buffer += decoder.decode(part.value, { stream: !part.done });
      let newline: number;
      while ((newline = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        let value: unknown;
        try {
          value = JSON.parse(line);
        } catch {
          throw new Error(`The ${mode} response was interrupted. Try again.`);
        }
        const parsed = coachEventSchema.safeParse(value);
        if (!parsed.success) throw new Error(`The ${mode} returned an invalid response.`);
        const event = parsed.data;
        if (event.type === "done") return;
        if (event.type === "error") throw new Error(event.error);
        onText(event.text);
      }
      if (part.done) throw new Error(`The ${mode} response was interrupted. Try again.`);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

export function recentCoachMessages(messages: CoachRequest["messages"]): CoachRequest["messages"] {
  const recent: CoachRequest["messages"] = [];
  let bytes = 0;
  for (const message of messages.slice(-12).reverse()) {
    const size = new TextEncoder().encode(JSON.stringify(message)).byteLength;
    if (message.content.length > 16000 || bytes + size > 48 * 1024) break;
    recent.unshift(message);
    bytes += size;
  }
  return recent;
}
