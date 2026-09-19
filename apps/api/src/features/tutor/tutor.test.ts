import { createServer, type Server } from "node:http";
import { Writable } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  tutorRequestSchema,
  type ContextPacket,
  type TutorRequest,
} from "@practice-plus-plus/contracts";
import { createApp } from "../../application/app.js";
import { assertTutorHelp, type TutorStore } from "./tutor.js";
import { createLogger } from "../../shared/logger.js";
import { HttpError } from "../../shared/errors.js";
import type { ProviderAdapter, ProviderRequest } from "../../shared/providers.js";

const now = new Date("2026-09-13T12:00:00Z");
const attempt = {
  outcome: null,
  confirmedAt: null,
  timerSkippedAt: now,
  startedAt: now,
  assistance: [],
};
const input: TutorRequest = {
  selection: { providerId: "openai", model: "test-model" },
  apiKey: "private-key",
  attemptId: "10000000-0000-4000-8000-000000000001",
  help: { type: "CONCEPTUAL_HINT", hintLevel: 1 },
  messages: [{ role: "user", content: "private-code" }],
};
const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.closeAllConnections();
          server.close(() => resolve());
        }),
    ),
  );
});

async function setup(
  provider: ProviderAdapter = {
    async *streamText() {
      yield "A guiding question.";
    },
  },
) {
  let logs = "";
  const store = { check: vi.fn<TutorStore["check"]>().mockResolvedValue(undefined) };
  const assembler = {
    assemble: vi.fn().mockImplementation(
      async (_id, request) =>
        ({
          instructions: "Respect approved memories.",
          transition: "Continue tutoring.",
          policy: request.policy,
          messages: request.messages,
          current: { attempt: { id: input.attemptId } },
          patterns: ["private-pattern"],
        }) as unknown as ContextPacket,
    ),
  };
  const server = createServer(
    createApp({
      authentication: {
        verifier: { verify: vi.fn().mockResolvedValue({ subject: "verified-user" }) },
        profileStore: {
          resolveByAuthSubject: vi.fn().mockResolvedValue({ id: "application-user", role: "USER" }),
        },
        tutor: { assembler, provider, store },
      },
      logger: createLogger(
        new Writable({
          write(chunk, _encoding, callback) {
            logs += String(chunk);
            callback();
          },
        }),
      ),
    }),
  );
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  servers.push(server);
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No address");
  const url = `http://127.0.0.1:${address.port}/ai/tutor`;
  const post = (body: unknown = input, authenticated = true) =>
    fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(authenticated ? { authorization: "Bearer private-token" } : {}),
      },
      body: JSON.stringify(body),
    });
  return { post, store, assembler, logs: () => logs };
}

describe("attempt tutor", () => {
  it("enforces the timer, sequential guidance and explicit solution review", () => {
    expect(() => assertTutorHelp({ ...attempt, timerSkippedAt: null }, input.help, now)).toThrow(
      "timer",
    );
    expect(() =>
      assertTutorHelp(
        { ...attempt, timerSkippedAt: null },
        input.help,
        new Date(now.getTime() + 1800000),
      ),
    ).not.toThrow();
    expect(() => assertTutorHelp(attempt, { type: "CONCEPTUAL_HINT", hintLevel: 2 }, now)).toThrow(
      "in order",
    );
    expect(() =>
      assertTutorHelp(
        { ...attempt, assistance: [{ type: "CONCEPTUAL_HINT", hintLevel: 1 }] },
        { type: "CONCEPTUAL_HINT", hintLevel: 2 },
        now,
      ),
    ).not.toThrow();
    expect(() =>
      assertTutorHelp(
        {
          ...attempt,
          assistance: [
            { type: "CONCEPTUAL_HINT", hintLevel: 1 },
            { type: "CONCEPTUAL_HINT", hintLevel: 2 },
            { type: "CONCEPTUAL_HINT", hintLevel: 3 },
          ],
        },
        { type: "CONCEPTUAL_HINT", hintLevel: 4 },
        now,
      ),
    ).not.toThrow();
    expect(() => assertTutorHelp(attempt, { type: "SOLUTION_REVIEW" }, now)).toThrow("Give up");
    expect(() =>
      assertTutorHelp({ ...attempt, outcome: "GAVE_UP" }, { type: "SOLUTION_REVIEW" }, now),
    ).not.toThrow();
    expect(() =>
      assertTutorHelp(
        { ...attempt, outcome: "GAVE_UP", confirmedAt: now },
        { type: "SOLUTION_REVIEW" },
        now,
      ),
    ).toThrow("confirmed");
    expect(() =>
      assertTutorHelp({ ...attempt, outcome: "INDEPENDENT" }, { type: "DEBUGGING" }, now),
    ).toThrow("in progress");
    expect(() =>
      assertTutorHelp({ ...attempt, timerSkippedAt: null }, { type: "CLARIFICATION" }, now),
    ).not.toThrow();
    expect(
      tutorRequestSchema.safeParse({ ...input, help: { type: "CONCEPTUAL_HINT", hintLevel: 4 } })
        .success,
    ).toBe(true);
    expect(
      tutorRequestSchema.safeParse({ ...input, help: { type: "CONCEPTUAL_HINT", hintLevel: 5 } })
        .success,
    ).toBe(false);
  });

  it.each([
    [{ type: "CONCEPTUAL_HINT", hintLevel: 1 }, "without naming the pattern"],
    [{ type: "CONCEPTUAL_HINT", hintLevel: 2 }, "without the complete algorithm"],
    [{ type: "CONCEPTUAL_HINT", hintLevel: 3 }, "without complete code"],
    [{ type: "CONCEPTUAL_HINT", hintLevel: 4 }, "complete solution and explain why it works"],
    [{ type: "DEBUGGING" }, "local faults"],
    [{ type: "CLARIFICATION" }, "without solution clues"],
    [{ type: "OPTIMIZATION" }, "complexity analysis"],
    [{ type: "SOLUTION_REVIEW" }, "explicitly gave up"],
  ])(
    "streams only the selected policy (%j) and records metadata before text",
    async (help, boundary) => {
      let captured: ProviderRequest | undefined;
      const { post, store, assembler, logs } = await setup({
        async *streamText(request) {
          captured = request;
          yield "Guidance";
          yield " continued";
        },
      });
      const response = await post({ ...input, help });
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(await response.text()).toContain('"type":"done"');
      expect(store.check.mock.calls.map((call) => call[4])).toEqual([false, true]);
      expect(store.check).toHaveBeenLastCalledWith(
        "application-user",
        input.attemptId,
        help,
        expect.any(Date),
        true,
      );
      expect(assembler.assemble).toHaveBeenCalledWith(
        "application-user",
        expect.objectContaining({
          policy: expect.objectContaining({ mode: "ATTEMPT_TUTOR", attemptId: input.attemptId }),
        }),
        expect.any(Date),
      );
      expect(captured?.messages[0]?.content).toContain(boundary);
      expect(captured?.messages[0]?.content).not.toContain("level");
      expect(captured?.messages.at(-1)?.content).toBe("private-code");
      for (const secret of [
        "private-key",
        "private-code",
        "private-token",
        "private-pattern",
        "Guidance",
      ])
        expect(logs()).not.toContain(secret);
    },
  );

  it("rejects invalid and unauthorized requests without generation", async () => {
    const streamText = vi.fn<ProviderAdapter["streamText"]>();
    const { post, store, assembler } = await setup({ streamText });
    expect((await post(input, false)).status).toBe(401);
    expect((await post({ ...input, userId: "other-user" })).status).toBe(400);
    expect(
      (await post({ ...input, messages: [{ role: "user", content: "x".repeat(70000) }] })).status,
    ).toBe(400);
    store.check.mockRejectedValue(new HttpError(404, "Attempt not found."));
    expect((await post()).status).toBe(404);
    expect(assembler.assemble).not.toHaveBeenCalled();
    expect(streamText).not.toHaveBeenCalled();
  });

  it.each([false, true])(
    "retains only received assistance on provider failure (partial: %s)",
    async (partial) => {
      const { post, store, logs } = await setup({
        async *streamText() {
          if (partial) yield "Partial";
          throw new Error("private-code private-key upstream failure");
        },
      });
      const response = await post();
      const body = await response.text();
      expect(body).toContain("could not be completed");
      expect(store.check.mock.calls.filter((call) => call[4])).toHaveLength(partial ? 1 : 0);
      expect(body + logs()).not.toContain("private-code");
      expect(body + logs()).not.toContain("private-key");
    },
  );

  it("rechecks state before exposing text if the attempt changed during generation", async () => {
    const { post, store } = await setup();
    store.check
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new HttpError(409, "This attempt is already confirmed."));
    const response = await post();
    expect(response.status).toBe(409);
    expect(await response.text()).not.toContain("guiding question");
  });

  it("cancels the provider when the browser disconnects", async () => {
    let signal: AbortSignal | undefined;
    const { post } = await setup({
      async *streamText(request) {
        signal = request.signal;
        yield "Partial";
        await new Promise<void>((resolve) =>
          request.signal?.addEventListener("abort", () => resolve(), { once: true }),
        );
      },
    });
    const response = await post();
    const reader = response.body!.getReader();
    await reader.read();
    await reader.cancel();
    await vi.waitFor(() => expect(signal?.aborted).toBe(true));
  });
});
