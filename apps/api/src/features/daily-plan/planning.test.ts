import { createServer, type Server } from "node:http";
import type { ContextPacket, DailyPlan } from "@practice-plus-plus/contracts";
import pino from "pino";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../../application/app.js";

const userId = "25d64b95-b7cc-4fe5-91ac-ae296dc66383";
const firstId = "6931f7d2-86fc-43de-b7db-dcc636528fc1";
const secondId = "8831f7d2-86fc-43de-b7db-dcc636528fc2";
const stateId = "a".repeat(64);
const plan: DailyPlan = { practiceDate: "2026-09-15", target: 2, items: [] };
const packet: ContextPacket = {
  version: 1,
  policy: { mode: "COACH", purpose: "PLANNING" },
  generatedAt: "2026-09-15T12:00:00.000Z",
  practiceDate: "2026-09-15",
  planningStateId: stateId,
  instructions: "Plan safely.",
  transition: "Plan practice.",
  profile: {
    timeZone: "UTC",
    resetMinutes: 240,
    dailyTarget: 2,
    highIntervalDays: 1,
    mediumIntervalDays: 3,
    lowIntervalDays: 7,
    hidePaidProblems: false,
  },
  goals: [],
  preferences: [],
  patterns: [],
  reviews: [],
  current: { savedPlan: false, selections: [], problems: [], attempt: null },
  candidates: [firstId, secondId].map((id, index) => ({
    id,
    leetcodeId: index + 1,
    title: `Problem ${index + 1}`,
    url: `https://leetcode.com/problems/problem-${index + 1}/`,
    difficulty: "EASY" as const,
    availability: "AVAILABLE" as const,
    patternIds: [],
  })),
  history: [],
  memories: [],
  summary: null,
  messages: [],
  omitted: {
    goals: 0,
    preferences: 0,
    patterns: 0,
    reviews: 0,
    candidates: 0,
    history: 0,
    memories: 0,
    summary: 0,
    messages: 0,
  },
  estimatedTokens: 1,
};

const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(
    servers
      .splice(0)
      .map((server) => new Promise<void>((resolve) => server.close(() => resolve()))),
  );
});

async function setup(response: unknown) {
  const assemble = vi.fn().mockResolvedValue(packet);
  const current = vi.fn().mockResolvedValue(plan);
  const recommended = vi.fn().mockResolvedValue(plan);
  const streamText = vi.fn().mockImplementation(async function* () {
    yield JSON.stringify(response);
  });
  const store = { current, saved: vi.fn().mockResolvedValue(null), recommended };
  const app = createApp({
    logger: pino({ level: "silent" }),
    authentication: {
      planning: { assembler: { assemble }, provider: { streamText }, store },
      profileStore: {
        resolveByAuthSubject: vi.fn().mockResolvedValue({ id: userId, role: "USER" }),
      },
      verifier: { verify: vi.fn().mockResolvedValue({ subject: "subject" }) },
    },
  });
  const server = createServer(app);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("No port");
  return { url: `http://127.0.0.1:${address.port}`, assemble, current, recommended };
}

const recommendation = {
  version: 1,
  planningStateId: stateId,
  freshProblemIds: [secondId, firstId],
};
const headers = { authorization: "Bearer token", "content-type": "application/json" };

describe("AI planning", () => {
  it("saves a valid integrated recommendation with authorized shared context", async () => {
    const harness = await setup(recommendation);
    const response = await fetch(`${harness.url}/ai/planning/integrated`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        selection: { providerId: "openai", model: "gpt-5.4-mini" },
        apiKey: "secret",
      }),
    });
    expect(response.status).toBe(200);
    expect(harness.assemble).toHaveBeenCalledWith(
      userId,
      { policy: { mode: "COACH", purpose: "PLANNING" }, messages: [] },
      expect.any(Date),
    );
    expect(harness.assemble).toHaveBeenCalledTimes(2);
    expect(harness.recommended).toHaveBeenCalledWith(userId, expect.any(Date), [secondId, firstId]);
    expect(harness.current).not.toHaveBeenCalled();
  });

  it("falls back without saving an invalid integrated recommendation", async () => {
    const harness = await setup({ ...recommendation, freshProblemIds: ["fabricated"] });
    const response = await fetch(`${harness.url}/ai/planning/integrated`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        selection: { providerId: "openai", model: "gpt-5.4-mini" },
        apiKey: "secret",
      }),
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("x-practice-plan-fallback")).toBe("deterministic");
    expect(harness.recommended).not.toHaveBeenCalled();
    expect(harness.current).toHaveBeenCalledWith(userId, expect.any(Date));
  });

  it("previews external choices and revalidates them on confirmation", async () => {
    const harness = await setup(recommendation);
    const preview = await fetch(`${harness.url}/ai/planning/external/validate`, {
      method: "POST",
      headers,
      body: JSON.stringify(recommendation),
    });
    expect(preview.status).toBe(200);
    const body = (await preview.json()) as { problems: { id: string }[] };
    expect(body.problems.map((problem) => problem.id)).toEqual([secondId, firstId]);
    expect(harness.recommended).not.toHaveBeenCalled();
    const confirmed = await fetch(`${harness.url}/ai/planning/external/confirm`, {
      method: "POST",
      headers,
      body: JSON.stringify(recommendation),
    });
    expect(confirmed.status).toBe(200);
    expect(harness.assemble).toHaveBeenCalledTimes(2);
    expect(harness.recommended).toHaveBeenCalledOnce();
  });

  it("rejects stale and fabricated external recommendations without saving", async () => {
    const harness = await setup(recommendation);
    for (const value of [
      { ...recommendation, planningStateId: "b".repeat(64) },
      { ...recommendation, freshProblemIds: [firstId, "f831f7d2-86fc-43de-b7db-dcc636528fc9"] },
    ]) {
      const response = await fetch(`${harness.url}/ai/planning/external/confirm`, {
        method: "POST",
        headers,
        body: JSON.stringify(value),
      });
      expect(response.status).toBe(409);
    }
    expect(harness.recommended).not.toHaveBeenCalled();
  });
});
