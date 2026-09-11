import { Writable } from "node:stream";

import { afterEach, describe, expect, it, vi } from "vitest";

import { createLogger } from "./logger.js";
import { createProviderAdapter, ProviderError, type ProviderRequest } from "./providers.js";

const request: ProviderRequest = {
  selection: { providerId: "openai", model: "chosen-model" },
  apiKey: "private-key",
  messages: [{ role: "user", content: "private-prompt" }],
};

const chunk = (content: string | null, finish: string | null = null) =>
  `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content }, finish_reason: finish }] })}\n\n`;
const complete = `${chunk("Hello 👋")}${chunk(null, "stop")}data: [DONE]\n\n`;

function streamResponse(text: string, split = false): Response {
  const bytes = new TextEncoder().encode(text);
  return new Response(
    new ReadableStream({
      start(controller) {
        if (split) {
          for (const byte of bytes) controller.enqueue(new Uint8Array([byte]));
        } else controller.enqueue(bytes);
        controller.close();
      },
    }),
    { headers: { "content-type": "text/event-stream; charset=utf-8" } },
  );
}

async function collect(fetcher: typeof fetch, input = request): Promise<string[]> {
  const result: string[] = [];
  for await (const text of createProviderAdapter(fetcher).streamText(input)) result.push(text);
  return result;
}

afterEach(() => vi.useRealTimers());

describe("provider adapter", () => {
  it.each(["\n", "\r\n", "\r"])(
    "streams fragmented UTF-8 and %j event boundaries",
    async (newline) => {
      const fetcher = vi
        .fn<typeof fetch>()
        .mockResolvedValue(
          streamResponse(`: heartbeat\n\n${complete}`.replaceAll("\n", newline), true),
        );
      expect(await collect(fetcher)).toEqual(["Hello 👋"]);
      expect(fetcher).toHaveBeenCalledOnce();
      const [url, options] = fetcher.mock.calls[0]!;
      expect(url).toBe("https://api.openai.com/v1/chat/completions");
      expect(options).toMatchObject({
        method: "POST",
        redirect: "manual",
        headers: { authorization: "Bearer private-key" },
      });
      expect(JSON.parse(options!.body as string)).toEqual({
        model: "chosen-model",
        messages: request.messages,
        stream: true,
        store: false,
        max_completion_tokens: 4096,
      });
    },
  );

  it.each([301, 302, 303, 307, 308])(
    "rejects redirect status %i without another request",
    async (status) => {
      const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
        new Response("private-key", {
          status,
          headers: { location: "https://api.openai.com/other" },
        }),
      );
      await expect(collect(fetcher)).rejects.toMatchObject({ code: "redirect_rejected" });
      expect(fetcher).toHaveBeenCalledOnce();
    },
  );

  it.each([
    { ...request, selection: { ...request.selection, baseUrl: "http://127.0.0.1" } },
    { ...request, selection: { ...request.selection, providerId: "constructor" } },
    { ...request, apiKey: "key\r\ninjected" },
    { ...request, messages: [] },
    { ...request, messages: [{ role: "user", content: "x".repeat(65_536) }] },
  ])("rejects invalid input before outbound requests", async (input) => {
    const fetcher = vi.fn<typeof fetch>();
    await expect(collect(fetcher, input as ProviderRequest)).rejects.toMatchObject({
      code: "invalid_request",
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each([
    [401, "invalid_credentials"],
    [403, "invalid_credentials"],
    [400, "unsupported_request"],
    [404, "unsupported_request"],
    [422, "unsupported_request"],
    [429, "rate_limited"],
    [500, "unavailable"],
    [503, "unavailable"],
  ])("normalizes status %i without reading or logging its error body", async (status, code) => {
    const response = new Response("private-key private-prompt private-response", {
      status: Number(status),
    });
    const read = vi.spyOn(response, "text");
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response);
    const error = await collect(fetcher).catch((error: unknown) => error);
    expect(error).toBeInstanceOf(ProviderError);
    expect(error).toMatchObject({ code });
    let logs = "";
    const logger = createLogger(
      new Writable({
        write(data, _encoding, callback) {
          logs += data.toString();
          callback();
        },
      }),
    );
    logger.error({ err: error });
    expect(logs).not.toMatch(/private-key|private-prompt|private-response/);
    expect(read).not.toHaveBeenCalled();
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it.each([
    "data: private-key invalid JSON\n\n",
    'data: {"error":{"message":"private-key"}}\n\n',
    'data: {"choices":[{"index":0,"delta":{"content":42}}]}\n\n',
    "data: [DONE]\n\n",
    chunk("partial"),
    chunk(null, "stop"),
    `${chunk(null, "stop")}data: [DONE]\n\n`,
    `${chunk(null, "tool_calls")}data: [DONE]\n\n`,
  ])("rejects malformed or incomplete streams safely", async (text) => {
    await expect(
      collect(vi.fn<typeof fetch>().mockResolvedValue(streamResponse(text))),
    ).rejects.toMatchObject({ code: "invalid_response" });
  });

  it("handles multiline events and empty usage chunks", async () => {
    const text = complete
      .replace('"choices":', '\n"choices":')
      .replaceAll('\n"choices":', '\ndata: "choices":');
    const withUsage = text.replace("data: [DONE]", 'data: {"choices":[]}\n\ndata: [DONE]');
    expect(
      await collect(vi.fn<typeof fetch>().mockResolvedValue(streamResponse(withUsage))),
    ).toEqual(["Hello 👋"]);
  });

  it("returns provider refusal text", async () => {
    const text = complete.replace('"content":"Hello 👋"', '"refusal":"Unable to help"');
    expect(await collect(vi.fn<typeof fetch>().mockResolvedValue(streamResponse(text)))).toEqual([
      "Unable to help",
    ]);
  });

  it("normalizes a connection failure after partial output", async () => {
    let reads = 0;
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        new ReadableStream({
          pull(controller) {
            if (reads++ === 0) controller.enqueue(new TextEncoder().encode(chunk("partial")));
            else controller.error(new Error("private-key private-response"));
          },
        }),
        { headers: { "content-type": "text/event-stream" } },
      ),
    );
    await expect(collect(fetcher)).rejects.toEqual(new ProviderError("unavailable"));
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it.each([chunk(null, "length"), `: ${"x".repeat(2 * 1024 * 1024)}`])(
    "bounds provider output",
    async (text) => {
      await expect(
        collect(vi.fn<typeof fetch>().mockResolvedValue(streamResponse(text))),
      ).rejects.toMatchObject({ code: "output_limit" });
    },
  );

  it("rejects non-stream responses", async () => {
    await expect(
      collect(vi.fn<typeof fetch>().mockResolvedValue(new Response("private-response"))),
    ).rejects.toMatchObject({ code: "invalid_response" });
  });

  it("sanitizes network exceptions and does not retry", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new Error("private-key private-prompt"));
    await expect(collect(fetcher)).rejects.toEqual(new ProviderError("unavailable"));
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it("does not send a cancelled request", async () => {
    const fetcher = vi.fn<typeof fetch>();
    await expect(
      collect(fetcher, { ...request, signal: AbortSignal.abort("private-key") }),
    ).rejects.toMatchObject({ code: "cancelled" });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each(["timeout", "cancelled"])("aborts a pending stream on %s", async (code) => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const fetcher = vi.fn<typeof fetch>().mockImplementation(
      async (_url, options) =>
        new Response(
          new ReadableStream({
            start(stream) {
              options!.signal!.addEventListener("abort", () =>
                stream.error(new Error("private-key")),
              );
            },
          }),
          { headers: { "content-type": "text/event-stream" } },
        ),
    );
    const result = collect(fetcher, { ...request, signal: controller.signal });
    const assertion = expect(result).rejects.toMatchObject({ code });
    if (code === "timeout") await vi.advanceTimersByTimeAsync(120_000);
    else controller.abort("private-key");
    await assertion;
    expect(fetcher.mock.calls[0]![1]!.signal!.aborted).toBe(true);
  });

  it("cancels the upstream body when the consumer stops reading", async () => {
    const cancel = vi.fn();
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode(chunk("first")));
          },
          cancel,
        }),
        { headers: { "content-type": "text/event-stream" } },
      ),
    );
    for await (const text of createProviderAdapter(fetcher).streamText(request)) {
      expect(text).toBe("first");
      break;
    }
    expect(cancel).toHaveBeenCalledOnce();
    expect(fetcher.mock.calls[0]![1]!.signal!.aborted).toBe(true);
  });
});
