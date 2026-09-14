import { createServer, type Server } from "node:http";
import type { LearningContextResponse } from "@practice-plus-plus/contracts";
import pino from "pino";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "./app.js";
import type { LearningContextStore } from "./learningContext.js";

const userId = "25d64b95-b7cc-4fe5-91ac-ae296dc66383";
const memoryId = "d3b65a55-1a50-43e1-82e0-e23a263925a5";
const now = "2026-09-14T12:00:00.000Z";
const context: LearningContextResponse = {
  userSupplied: { goals: [], teachingPreferences: [] },
  observed: { attempts: [], summaries: [] },
  inferred: [],
  exportedAt: now,
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

function store(): LearningContextStore {
  return {
    read: vi.fn().mockResolvedValue(context),
    createGoal: vi.fn().mockResolvedValue({
      id: memoryId,
      target: "Prepare for interviews",
      priority: 0,
      state: "ACTIVE",
    }),
    updateGoal: vi.fn(),
    deleteGoal: vi.fn(),
    createTeachingPreference: vi.fn(),
    updateTeachingPreference: vi.fn(),
    deleteTeachingPreference: vi.fn(),
    reviewMemory: vi.fn().mockResolvedValue({
      id: memoryId,
      category: "Practice habit",
      content: "Pause before implementation.",
      confidence: 0.8,
      lastObservedAt: now,
      lifecycleState: "ACTIVE",
      approvalState: "APPROVED",
      reviewedAt: now,
      evidence: [
        { type: "CONVERSATION_SUMMARY", id: memoryId, label: "Coach: pacing", occurredAt: now },
      ],
    }),
    deleteMemory: vi.fn(),
  };
}

async function setup(learningContextStore: LearningContextStore) {
  const server = createServer(
    createApp({
      logger: pino({ level: "silent" }),
      authentication: {
        verifier: { verify: vi.fn().mockResolvedValue({ subject: "subject" }) },
        profileStore: { resolveByAuthSubject: vi.fn().mockResolvedValue({ id: userId }) },
        learningContextStore,
      },
    }),
  );
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No test address");
  return `http://127.0.0.1:${address.port}/learning-context`;
}

describe("learning context", () => {
  it("returns only the authenticated user's separated context without caching", async () => {
    const learningContextStore = store();
    const url = await setup(learningContextStore);
    expect((await fetch(url)).status).toBe(401);
    const response = await fetch(url, { headers: { authorization: "Bearer token" } });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual(context);
    expect(learningContextStore.read).toHaveBeenCalledWith(userId, expect.any(Date));
  });

  it("validates declarations and always supplies authenticated ownership", async () => {
    const learningContextStore = store();
    const url = await setup(learningContextStore);
    const response = await fetch(`${url}/goals`, {
      method: "POST",
      headers: { authorization: "Bearer token", "content-type": "application/json" },
      body: JSON.stringify({ target: "Prepare for interviews", priority: 0, state: "ACTIVE" }),
    });
    expect(response.status).toBe(201);
    expect(learningContextStore.createGoal).toHaveBeenCalledWith(userId, {
      target: "Prepare for interviews",
      priority: 0,
      state: "ACTIVE",
    });
    const invalid = await fetch(`${url}/goals`, {
      method: "POST",
      headers: { authorization: "Bearer token", "content-type": "application/json" },
      body: JSON.stringify({
        target: "Prepare",
        priority: 0,
        state: "ACTIVE",
        userProfileId: userId,
      }),
    });
    expect(invalid.status).toBe(400);
  });

  it("supports explicit inference approval, correction, rejection, and removal", async () => {
    const learningContextStore = store();
    const url = await setup(learningContextStore);
    for (const body of [
      { action: "APPROVE" },
      { action: "REJECT" },
      {
        action: "CORRECT",
        correction: {
          category: "Practice habit",
          content: "Pause before implementation.",
          confidence: 0.8,
          lifecycleState: "ACTIVE",
        },
      },
    ]) {
      const response = await fetch(`${url}/inferences/${memoryId}`, {
        method: "PATCH",
        headers: { authorization: "Bearer token", "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      expect(response.status).toBe(200);
    }
    expect(learningContextStore.reviewMemory).toHaveBeenNthCalledWith(
      1,
      userId,
      memoryId,
      { action: "APPROVE" },
      expect.any(Date),
    );
    expect(learningContextStore.reviewMemory).toHaveBeenCalledTimes(3);
    const removed = await fetch(`${url}/inferences/${memoryId}`, {
      method: "DELETE",
      headers: { authorization: "Bearer token" },
    });
    expect(removed.status).toBe(204);
    expect(learningContextStore.deleteMemory).toHaveBeenCalledWith(userId, memoryId);
  });

  it("rejects malformed inference changes before the store", async () => {
    const learningContextStore = store();
    const url = await setup(learningContextStore);
    const response = await fetch(`${url}/inferences/${memoryId}`, {
      method: "PATCH",
      headers: { authorization: "Bearer token", "content-type": "application/json" },
      body: JSON.stringify({ action: "APPROVE", content: "silent correction" }),
    });
    expect(response.status).toBe(400);
    expect(learningContextStore.reviewMemory).not.toHaveBeenCalled();
  });
});
