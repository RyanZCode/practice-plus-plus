import { createServer, type Server } from "node:http";
import type {
  CheckpointResponse,
  ContextPacket,
  MemorySuggestion,
} from "@practice-plus-plus/contracts";
import { Writable } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "./app.js";
import type { PrismaClient } from "./generated/prisma/client.js";
import { createLogger } from "./logger.js";
import type { ProviderAdapter, ProviderRequest } from "./providers.js";
import { createPrismaSummaryStore, summaryMessages, type SummaryStore } from "./summaries.js";

const userId = "25d64b95-b7cc-4fe5-91ac-ae296dc66383";
const summaryId = "d3b65a55-1a50-43e1-82e0-e23a263925a5";
const input = {
  selection: { providerId: "openai" as const, model: "test-model" },
  apiKey: "private-key",
  mode: "COACH" as const,
  attemptId: null,
  messages: [
    { role: "user" as const, content: "I keep rushing." },
    { role: "assistant" as const, content: "Pause to state an invariant." },
  ],
};
const output = {
  summary: {
    topics: "Pacing during practice",
    learningProgress: "The learner identified rushing as a recurring issue.",
    nextSteps: "State an invariant before implementation.",
  },
  attemptSummary: null,
  memorySuggestions: [
    {
      category: "Practice habit",
      content: "May benefit from pausing before implementation.",
      confidence: 0.7,
      lifecycleState: "ACTIVE" as const,
    },
  ],
};
const response: CheckpointResponse = {
  summary: {
    id: summaryId,
    mode: "COACH",
    attemptId: null,
    ...output.summary,
    updatedAt: "2026-09-13T12:00:00.000Z",
  },
  attemptSummary: null,
  memorySuggestions: [],
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

async function setup(provider: ProviderAdapter, store: SummaryStore) {
  let logs = "";
  const assembler = {
    assemble: vi.fn().mockImplementation(
      async (_userId, request) =>
        ({
          instructions: "Summarize without raw content.",
          transition: "Continue from the latest checkpoint.",
          messages: request.messages,
        }) as unknown as ContextPacket,
    ),
  };
  const server = createServer(
    createApp({
      logger: createLogger(
        new Writable({
          write(chunk, _encoding, callback) {
            logs += String(chunk);
            callback();
          },
        }),
      ),
      authentication: {
        verifier: { verify: vi.fn().mockResolvedValue({ subject: "subject" }) },
        profileStore: { resolveByAuthSubject: vi.fn().mockResolvedValue({ id: userId }) },
        summaries: { assembler, provider, store },
      },
    }),
  );
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No test address");
  return {
    assembler,
    logs: () => logs,
    url: `http://127.0.0.1:${address.port}/ai`,
  };
}

describe("learning checkpoints", () => {
  it("validates structured output before persisting it for the authenticated user", async () => {
    let providerRequest: ProviderRequest | undefined;
    const store: SummaryStore = {
      save: vi.fn().mockResolvedValue(response),
      pending: vi.fn().mockResolvedValue([]),
    };
    const { url, assembler } = await setup(
      {
        async *streamText(request) {
          providerRequest = request;
          yield JSON.stringify(output);
        },
      },
      store,
    );
    const result = await fetch(`${url}/checkpoints`, {
      method: "POST",
      headers: { authorization: "Bearer token", "content-type": "application/json" },
      body: JSON.stringify(input),
    });
    expect(result.status).toBe(200);
    expect(result.headers.get("cache-control")).toBe("no-store");
    expect(await result.json()).toEqual(response);
    expect(assembler.assemble).toHaveBeenCalledWith(
      userId,
      { policy: { mode: "COACH", purpose: "GENERAL" }, messages: input.messages },
      expect.any(Date),
    );
    expect(store.save).toHaveBeenCalledWith(
      userId,
      { mode: "COACH", attemptId: null },
      output,
      expect.any(Date),
    );
    expect(JSON.stringify(vi.mocked(store.save).mock.calls)).not.toMatch(
      /private-key|I keep rushing|Pause to state an invariant/,
    );
    expect(providerRequest?.apiKey).toBe("private-key");
    expect(providerRequest?.messages[0]?.content).toContain("Never quote messages");
  });

  it("does not persist invalid, prose, or code-bearing provider output", async () => {
    for (const generated of [
      "A prose summary",
      JSON.stringify({ ...output, summary: { ...output.summary, topics: "`const secret = 1`" } }),
    ]) {
      const store: SummaryStore = {
        save: vi.fn(),
        pending: vi.fn().mockResolvedValue([]),
      };
      const { url } = await setup(
        {
          async *streamText() {
            yield generated;
          },
        },
        store,
      );
      const result = await fetch(`${url}/checkpoints`, {
        method: "POST",
        headers: { authorization: "Bearer token", "content-type": "application/json" },
        body: JSON.stringify(input),
      });
      expect(result.status).toBe(502);
      expect(store.save).not.toHaveBeenCalled();
    }
  });

  it.each(["provider failure", "interrupted output"])(
    "keeps credentials and raw content out of persistence and logs after %s",
    async (failure) => {
      const store: SummaryStore = {
        save: vi.fn(),
        pending: vi.fn().mockResolvedValue([]),
      };
      const { url, logs } = await setup(
        {
          async *streamText() {
            if (failure === "interrupted output") yield '{"summary":';
            throw new Error("private-key I keep rushing private-provider-content");
          },
        },
        store,
      );
      const result = await fetch(`${url}/checkpoints`, {
        method: "POST",
        headers: { authorization: "Bearer private-token", "content-type": "application/json" },
        body: JSON.stringify(input),
      });
      expect(result.status).toBe(500);
      expect(store.save).not.toHaveBeenCalled();
      expect((await result.text()) + logs()).not.toMatch(
        /private-key|private-token|I keep rushing|private-provider-content/,
      );
    },
  );

  it("rejects content-bearing validation failures before generation or persistence", async () => {
    const provider = { streamText: vi.fn<ProviderAdapter["streamText"]>() };
    const store: SummaryStore = {
      save: vi.fn(),
      pending: vi.fn().mockResolvedValue([]),
    };
    const { url, assembler, logs } = await setup(provider, store);
    const result = await fetch(`${url}/checkpoints`, {
      method: "POST",
      headers: { authorization: "Bearer private-token", "content-type": "application/json" },
      body: JSON.stringify({ ...input, rawPrompt: "private-validation-content" }),
    });
    expect(result.status).toBe(400);
    expect(assembler.assemble).not.toHaveBeenCalled();
    expect(provider.streamText).not.toHaveBeenCalled();
    expect(store.save).not.toHaveBeenCalled();
    expect((await result.text()) + logs()).not.toMatch(/private-token|private-validation-content/);
  });

  it("returns the pending memory-review queue without accepting owner input", async () => {
    const suggestion = {
      id: summaryId,
      category: "Practice habit",
      content: "May benefit from pausing before implementation.",
      confidence: 0.7,
      lastObservedAt: "2026-09-13T12:00:00.000Z",
      lifecycleState: "ACTIVE",
      approvalState: "PENDING",
      reviewedAt: null,
      evidence: [{ type: "CONVERSATION_SUMMARY", conversationSummaryId: summaryId }],
    } as MemorySuggestion;
    const store: SummaryStore = {
      save: vi.fn(),
      pending: vi.fn().mockResolvedValue([suggestion]),
    };
    const { url } = await setup(
      {
        async *streamText() {
          yield "unused";
        },
      },
      store,
    );
    const result = await fetch(`${url}/memory-suggestions`, {
      headers: { authorization: "Bearer token" },
    });
    expect(await result.json()).toEqual({ memorySuggestions: [suggestion] });
    expect(store.pending).toHaveBeenCalledWith(userId, undefined);
    expect(
      (
        await fetch(`${url}/memory-suggestions?attemptId=other`, {
          headers: { authorization: "Bearer token" },
        })
      ).status,
    ).toBe(400);
  });
});

it("builds a checkpoint prompt that forbids transcript and code persistence", () => {
  const messages = summaryMessages(
    { messages: input.messages, profile: { secret: "context" } } as unknown as ContextPacket,
    "COACH",
  );
  expect(messages[0]?.content).toContain("Never quote messages");
  expect(messages[0]?.content).toContain("reproduce code");
  expect(messages[0]?.content).toContain("hidden pattern tags");
  expect(messages[0]?.content).toContain("help already requested");
  expect(messages[1]?.content).toContain("I keep rushing");
});

it("persists only structured tutor output with pending, user-scoped provenance", async () => {
  const attemptId = "6931f7d2-86fc-43de-b7db-dcc636528fc1";
  const now = new Date("2026-09-13T12:00:00.000Z");
  const conversation = {
    id: summaryId,
    userProfileId: userId,
    mode: "ATTEMPT_TUTOR",
    attemptId,
    ...output.summary,
    createdAt: now,
    updatedAt: now,
  };
  const memory = {
    id: "e4f94d00-a76f-4a20-af6c-4bb28c4af431",
    userProfileId: userId,
    ...output.memorySuggestions[0]!,
    lastObservedAt: now,
    approvalState: "PENDING",
    reviewedAt: null,
    createdAt: now,
    updatedAt: now,
    evidence: [
      {
        learnerGoalId: null,
        teachingPreferenceId: null,
        attemptId: null,
        assistanceEventId: null,
        assistanceAttemptId: null,
        attemptSummaryId: null,
        conversationSummaryId: summaryId,
      },
    ],
  };
  const tx = {
    attempt: { findFirst: vi.fn().mockResolvedValue({ id: attemptId }) },
    conversationSummary: { create: vi.fn().mockResolvedValue(conversation) },
    attemptSummary: { upsert: vi.fn().mockResolvedValue({}) },
    learnerMemory: {
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ id: memory.id }),
      findUniqueOrThrow: vi.fn().mockResolvedValue(memory),
    },
    learnerMemoryEvidence: { createMany: vi.fn().mockResolvedValue({ count: 2 }) },
  };
  const client = {
    $transaction: vi.fn().mockImplementation((work) => work(tx)),
  } as unknown as PrismaClient;
  const tutorOutput = {
    ...output,
    attemptSummary: {
      approach: "Tracked the active frontier.",
      stuckPoint: null,
      misconception: null,
      assistance: "Used a small nudge.",
      progressTrigger: null,
      finalUnderstanding: "Explained the invariant.",
      nextTeachingAction: "Ask for the invariant first.",
    },
  };
  await createPrismaSummaryStore(client).save(
    userId,
    { mode: "ATTEMPT_TUTOR", attemptId },
    tutorOutput,
    now,
  );
  expect(tx.conversationSummary.create).toHaveBeenCalledWith({
    data: expect.objectContaining({ userProfileId: userId, attemptId, mode: "ATTEMPT_TUTOR" }),
  });
  expect(tx.attemptSummary.upsert).toHaveBeenCalledWith(
    expect.objectContaining({
      create: expect.objectContaining({ userProfileId: userId, attemptId }),
      update: expect.objectContaining({ reviewedAt: null }),
    }),
  );
  expect(tx.learnerMemory.create).toHaveBeenCalledWith(
    expect.objectContaining({
      data: expect.objectContaining({
        userProfileId: userId,
      }),
    }),
  );
  expect(tx.learnerMemoryEvidence.createMany).toHaveBeenCalledWith({
    data: [
      { userProfileId: userId, memoryId: memory.id, conversationSummaryId: summaryId },
      { userProfileId: userId, memoryId: memory.id, attemptId },
    ],
  });
  expect(tx.learnerMemory.findUniqueOrThrow).toHaveBeenCalledWith({
    where: { id_userProfileId: { id: memory.id, userProfileId: userId } },
    select: expect.any(Object),
  });
  expect(tx.learnerMemory.create.mock.calls[0]?.[0].data.approvalState).toBeUndefined();
  expect(JSON.stringify(tx.learnerMemory.create.mock.calls)).not.toContain("I keep rushing");
});
