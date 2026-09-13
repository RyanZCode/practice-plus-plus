import { describe, expect, it, vi } from "vitest";
import { type CoachRequest } from "@practice-plus-plus/contracts";
import { recentCoachMessages, streamCoach } from "./coachApi";

const input: CoachRequest = {
  selection: { providerId: "openai", model: "test-model" },
  apiKey: "private-key",
  purpose: "GENERAL",
  messages: [{ role: "user", content: "Hello" }],
};
function response(text: string) {
  return new Response(
    new ReadableStream({
      start(controller) {
        for (const byte of new TextEncoder().encode(text))
          controller.enqueue(new Uint8Array([byte]));
        controller.close();
      },
    }),
  );
}
describe("coach streaming client", () => {
  it("decodes fragmented Unicode and sends credentials only with the active request", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(response('{"type":"text","text":"Hello 👋"}\n{"type":"done"}\n'));
    const onText = vi.fn();
    const signal = new AbortController().signal;
    await streamCoach("https://api.example.com", "session-token", input, signal, onText, fetcher);
    expect(onText).toHaveBeenCalledWith("Hello 👋");
    expect(fetcher).toHaveBeenCalledWith(
      "https://api.example.com/ai/coach",
      expect.objectContaining({ signal, cache: "no-store", body: JSON.stringify(input) }),
    );
  });
  it.each([
    '{"type":"text","text":"Partial"}\n',
    '{"type":"unknown"}\n',
    "not json\n",
    '{"type":"error","error":"Provider unavailable"}\n',
  ])("rejects incomplete, invalid and failed streams", async (text) => {
    await expect(
      streamCoach(
        "https://api.example.com",
        "token",
        input,
        new AbortController().signal,
        vi.fn(),
        vi.fn<typeof fetch>().mockResolvedValue(response(text)),
      ),
    ).rejects.toThrow();
  });
  it("never exposes an HTTP error body", async () => {
    await expect(
      streamCoach(
        "https://api.example.com",
        "token",
        input,
        new AbortController().signal,
        vi.fn(),
        vi
          .fn<typeof fetch>()
          .mockResolvedValue(new Response("private upstream content", { status: 502 })),
      ),
    ).rejects.toThrow("Check your key and model");
  });
  it("sends a contiguous recent suffix within item, message and byte limits", () => {
    const messages = Array.from({ length: 30 }, (_, i) => ({
      role: "user" as const,
      content: `${i}: ${"界".repeat(10000)}`,
    }));
    expect(recentCoachMessages(messages)).toEqual(messages.slice(-1));
    expect(
      recentCoachMessages([
        { role: "assistant", content: "x".repeat(16001) },
        { role: "user", content: "Next question" },
      ]),
    ).toEqual([{ role: "user", content: "Next question" }]);
    expect(
      recentCoachMessages(Array.from({ length: 30 }, () => ({ role: "user", content: "hello" }))),
    ).toHaveLength(12);
  });
});
