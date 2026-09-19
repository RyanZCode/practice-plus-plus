import { createServer, type Server } from "node:http";
import type {
  AttemptAssessmentDraft,
  AttemptAssessmentDraftInput,
  ContextPacket,
} from "@practice-plus-plus/contracts";
import { Writable } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  assessmentMessages,
  createPrismaAssessmentStore,
  type AssessmentStore,
} from "./assessments.js";
import { createApp } from "../../application/app.js";
import type { PrismaClient } from "../../shared/generated/prisma/client.js";
import { createLogger } from "../../shared/logger.js";
import type { ProviderAdapter, ProviderRequest } from "../../shared/providers.js";

const userId = "25d64b95-b7cc-4fe5-91ac-ae296dc66383";
const attemptId = "6931f7d2-86fc-43de-b7db-dcc636528fc1";
const draftId = "d3b65a55-1a50-43e1-82e0-e23a263925a5";
const now = new Date("2026-09-14T12:00:00.000Z");
const generated = {
  outcome: "ASSISTED" as const,
  confidence: "SHAKY" as const,
  optimality: null,
  timeSpentSeconds: null,
  approach: "Tracked a moving frontier.",
  notes: "A small nudge helped identify the invariant.",
  reproducedFromMemory: null,
  summary: {
    approach: "Tracked a moving frontier.",
    stuckPoint: "Did not identify the invariant initially.",
    misconception: null,
    assistance: "Used a small nudge.",
    progressTrigger: "Stated the invariant explicitly.",
    finalUnderstanding: "Can explain why the frontier moves once.",
    nextTeachingAction: "Ask for the invariant before discussing implementation.",
  },
  evidence: ["ATTEMPT" as const, "ASSISTANCE_EVENTS" as const, "ATTEMPT_SUMMARY" as const],
};
const saved: AttemptAssessmentDraft = {
  id: draftId,
  attemptId,
  ...generated,
  createdAt: now.toISOString(),
  updatedAt: now.toISOString(),
};
const packet = {
  current: {
    attempt: {
      id: attemptId,
      type: "FRESH",
      practiceDate: "2026-09-14",
      outcome: "ASSISTED",
      confidence: null,
      optimality: null,
      approach: null,
      problem: { leetcodeId: 1, title: "Two Sum", difficulty: "EASY" },
      assistance: [
        {
          id: "e4f94d00-a76f-4a20-af6c-4bb28c4af431",
          type: "CONCEPTUAL_HINT",
          hintLevel: 1,
          source: "INTEGRATED_AI",
        },
      ],
      assistanceOmitted: 0,
      summary: generated.summary,
      timerSkipped: true,
      solutionReviewed: false,
      reproducedFromMemory: null,
    },
  },
  messages: [],
  history: [],
  summary: {
    id: "db09a1fb-f853-42fe-9cd4-5e82eb319b72",
    mode: "ATTEMPT_TUTOR",
    attemptId,
    topics: "Structured checkpoint",
    learningProgress: null,
    nextSteps: null,
    updatedAt: now.toISOString(),
  },
} as unknown as ContextPacket;
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
  provider: ProviderAdapter,
  store: AssessmentStore,
  contextPacket: ContextPacket = packet,
) {
  let logs = "";
  const assembler = { assemble: vi.fn().mockResolvedValue(contextPacket) };
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
        assessments: { assembler, provider, store },
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
    url: `http://127.0.0.1:${address.port}/ai/assessment-drafts`,
  };
}

describe("attempt assessment drafts", () => {
  it("generates and saves a validated draft from result-phase structured evidence", async () => {
    let providerRequest: ProviderRequest | undefined;
    const store: AssessmentStore = {
      find: vi.fn(),
      save: vi.fn().mockResolvedValue(saved),
    };
    const { assembler, url } = await setup(
      {
        async *streamText(request) {
          providerRequest = request;
          yield JSON.stringify(generated);
        },
      },
      store,
    );
    const response = await fetch(url, {
      method: "POST",
      headers: { authorization: "Bearer token", "content-type": "application/json" },
      body: JSON.stringify({
        selection: { providerId: "openai", model: "test-model" },
        apiKey: "private-key",
        attemptId,
        completedCode: "const answer = solve(input);",
        tutorMessages: [
          { role: "user", content: "I was stuck on maintaining the moving frontier." },
        ],
      }),
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual(saved);
    expect(assembler.assemble).toHaveBeenCalledWith(
      userId,
      {
        policy: { mode: "ATTEMPT_TUTOR", attemptId, phase: "RESULT" },
        messages: [{ role: "user", content: "I was stuck on maintaining the moving frontier." }],
      },
      expect.any(Date),
    );
    expect(store.save).toHaveBeenCalledWith(userId, attemptId, {
      ...generated,
      optimality: "UNKNOWN",
    });
    expect(providerRequest?.apiKey).toBe("private-key");
    expect(JSON.stringify(providerRequest?.format)).not.toContain("uniqueItems");
    expect(providerRequest?.messages[0]?.content).toContain("structured evidence");
    expect(providerRequest?.messages[0]?.content).toContain("solution quality");
    expect(providerRequest?.messages[1]?.content).toContain("const answer = solve(input);");
    expect(providerRequest?.messages[1]?.content).not.toContain("private-key");
  });

  it("accepts completed code as transient assessment evidence", async () => {
    const generatedWithCode = {
      ...generated,
      evidence: ["ATTEMPT", "ASSISTANCE_EVENTS", "ATTEMPT_SUMMARY", "COMPLETED_CODE"],
    };
    const store: AssessmentStore = {
      find: vi.fn(),
      save: vi.fn().mockResolvedValue(saved),
    };
    const { url } = await setup(
      {
        async *streamText() {
          yield JSON.stringify(generatedWithCode);
        },
      },
      store,
    );
    const response = await fetch(url, {
      method: "POST",
      headers: { authorization: "Bearer token", "content-type": "application/json" },
      body: JSON.stringify({
        selection: { providerId: "openai", model: "test-model" },
        apiKey: "private-key",
        attemptId,
        completedCode: "const answer = solve(input);",
      }),
    });
    expect(response.status).toBe(200);
    expect(store.save).toHaveBeenCalledWith(userId, attemptId, {
      ...generatedWithCode,
      optimality: "UNKNOWN",
    });
  });

  it("uses unknown solution quality when supplied code cannot be classified", async () => {
    let savedDraft: AttemptAssessmentDraftInput | undefined;
    const store: AssessmentStore = {
      find: vi.fn(),
      save: vi.fn().mockImplementation(async (_userId, _attemptId, draft) => {
        savedDraft = draft;
        return saved;
      }),
    };
    const { url } = await setup(
      {
        async *streamText() {
          yield JSON.stringify({ ...generated, optimality: null });
        },
      },
      store,
    );
    const response = await fetch(url, {
      method: "POST",
      headers: { authorization: "Bearer token", "content-type": "application/json" },
      body: JSON.stringify({
        selection: { providerId: "openai", model: "test-model" },
        apiKey: "private-key",
        attemptId,
        completedCode: "const answer = solve(input);",
      }),
    });
    expect(response.status).toBe(200);
    expect(savedDraft?.optimality).toBe("UNKNOWN");
  });

  it("preserves current summary details when the model omits them", async () => {
    let savedDraft: AttemptAssessmentDraftInput | undefined;
    const currentSummary = {
      approach: "Tracked a moving frontier.",
      stuckPoint: "I kept moving the right boundary too early.",
      misconception: "I treated the frontier as fixed.",
      assistance: "A hint pointed out the invariant.",
      progressTrigger: "The invariant explained when the boundary moves.",
      finalUnderstanding: "The frontier only moves after the invariant holds.",
      nextTeachingAction: "State the invariant before coding.",
    };
    const store: AssessmentStore = {
      find: vi.fn(),
      save: vi.fn().mockImplementation(async (_userId, _attemptId, draft) => {
        savedDraft = draft;
        return saved;
      }),
    };
    const { url } = await setup(
      {
        async *streamText() {
          yield JSON.stringify({
            ...generated,
            summary: { ...generated.summary, stuckPoint: null, misconception: null },
          });
        },
      },
      store,
    );
    const response = await fetch(url, {
      method: "POST",
      headers: { authorization: "Bearer token", "content-type": "application/json" },
      body: JSON.stringify({
        selection: { providerId: "openai", model: "test-model" },
        apiKey: "private-key",
        attemptId,
        currentSummary,
      }),
    });
    expect(response.status).toBe(200);
    expect(savedDraft?.summary).toMatchObject({
      stuckPoint: currentSummary.stuckPoint,
      misconception: currentSummary.misconception,
    });
  });

  it("uses the current tutor conversation as transient assessment evidence", async () => {
    const conversation = {
      role: "user" as const,
      content: "I realized the invariant only holds after moving the left boundary.",
    };
    const contextWithConversation = {
      ...packet,
      messages: [conversation],
    } as ContextPacket;
    const generatedWithConversation = {
      ...generated,
      evidence: ["ATTEMPT", "ASSISTANCE_EVENTS", "ATTEMPT_SUMMARY", "TUTOR_CONVERSATION" as const],
    };
    let providerRequest: ProviderRequest | undefined;
    const store: AssessmentStore = {
      find: vi.fn(),
      save: vi.fn().mockResolvedValue(saved),
    };
    const { url } = await setup(
      {
        async *streamText(request) {
          providerRequest = request;
          yield JSON.stringify(generatedWithConversation);
        },
      },
      store,
      contextWithConversation,
    );
    const response = await fetch(url, {
      method: "POST",
      headers: { authorization: "Bearer token", "content-type": "application/json" },
      body: JSON.stringify({
        selection: { providerId: "openai", model: "test-model" },
        apiKey: "private-key",
        attemptId,
        tutorMessages: [conversation],
      }),
    });
    expect(response.status).toBe(200);
    expect(providerRequest?.messages[1]?.content).toContain(conversation.content);
    expect(store.save).toHaveBeenCalledWith(userId, attemptId, generatedWithConversation);
  });

  it("rejects invalid or outcome-changing output without persistence", async () => {
    for (const output of [
      { ...generated, outcome: "INDEPENDENT" },
      { ...generated, approach: "`const privateCode = true`" },
      { ...generated, evidence: ["ASSISTANCE_EVENTS"] },
    ]) {
      const store: AssessmentStore = { find: vi.fn(), save: vi.fn() };
      const { url } = await setup(
        {
          async *streamText() {
            yield JSON.stringify(output);
          },
        },
        store,
      );
      const response = await fetch(url, {
        method: "POST",
        headers: { authorization: "Bearer token", "content-type": "application/json" },
        body: JSON.stringify({
          selection: { providerId: "openai", model: "test-model" },
          apiKey: "private-key",
          attemptId,
        }),
      });
      expect(response.status).toBe(502);
      expect(store.save).not.toHaveBeenCalled();
    }
  });

  it("loads only the authenticated user's active draft", async () => {
    const store: AssessmentStore = {
      find: vi.fn().mockResolvedValue(saved),
      save: vi.fn(),
    };
    const { url } = await setup({ streamText: vi.fn() }, store);
    const response = await fetch(`${url}/${attemptId}`, {
      headers: { authorization: "Bearer token" },
    });
    expect(await response.json()).toEqual({ draft: saved });
    expect(store.find).toHaveBeenCalledWith(userId, attemptId);
  });

  it("keeps credentials and provider content out of validation logs", async () => {
    const store: AssessmentStore = { find: vi.fn(), save: vi.fn() };
    const { logs, url } = await setup(
      {
        async *streamText() {
          yield "";
          throw new Error("private-key private-provider-content");
        },
      },
      store,
    );
    const response = await fetch(url, {
      method: "POST",
      headers: { authorization: "Bearer private-token", "content-type": "application/json" },
      body: JSON.stringify({
        selection: { providerId: "openai", model: "test-model" },
        apiKey: "private-key",
        attemptId,
      }),
    });
    expect(response.status).toBe(500);
    expect((await response.text()) + logs()).not.toMatch(
      /private-key|private-token|private-provider-content/,
    );
    expect(store.save).not.toHaveBeenCalled();
  });
});

it("upserts a separate draft without confirming or scheduling the attempt", async () => {
  const record = {
    id: draftId,
    attemptId,
    userProfileId: userId,
    ...generated,
    summary: generated.summary,
    createdAt: now,
    updatedAt: now,
  };
  const tx = {
    attempt: { findFirst: vi.fn().mockResolvedValue({ outcome: "ASSISTED" }) },
    attemptAssessmentDraft: { upsert: vi.fn().mockResolvedValue(record) },
  };
  const client = {
    $transaction: vi.fn().mockImplementation((work) => work(tx)),
  } as unknown as PrismaClient;
  expect(await createPrismaAssessmentStore(client).save(userId, attemptId, generated)).toEqual(
    saved,
  );
  expect(tx.attempt.findFirst).toHaveBeenCalledWith({
    where: { id: attemptId, userProfileId: userId, confirmedAt: null },
    select: { outcome: true },
  });
  expect(tx.attemptAssessmentDraft.upsert).toHaveBeenCalledWith(
    expect.objectContaining({
      where: { attemptId },
      create: expect.objectContaining({ userProfileId: userId, attemptId }),
    }),
  );
  expect(tx).not.toHaveProperty("reviewObligation");
});

it("builds an assessment prompt without active messages or submitted code", () => {
  const messages = assessmentMessages(packet);
  expect(messages[0]?.content).toContain("Never include source code");
  expect(messages[0]?.content).toContain("editable draft");
  expect(messages[1]?.content).toContain("Structured checkpoint");
  expect(messages[1]?.content).not.toContain("private-key");
});

it("includes tutor messages in the assessment prompt without storing them as draft fields", () => {
  const messages = assessmentMessages({
    ...packet,
    messages: [{ role: "assistant", content: "Focus on the invariant." }],
  } as ContextPacket);
  expect(messages[0]?.content).toContain("Attempt Tutor conversation history");
  expect(messages[1]?.content).toContain("Focus on the invariant.");
});
