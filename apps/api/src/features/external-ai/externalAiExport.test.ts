import { createServer, type Server } from "node:http";
import type { ContextPacket } from "@practice-plus-plus/contracts";
import type { Express } from "express";
import pino from "pino";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../../application/app.js";
import { formatExternalAiMarkdown } from "./externalAiExport.js";

const id = (n: number) => `00000000-0000-4000-8000-${n.toString().padStart(12, "0")}`;
const servers: Server[] = [];

const packet: ContextPacket = {
  version: 1,
  policy: { mode: "COACH", purpose: "PLANNING" },
  generatedAt: "2026-09-15T12:00:00.000Z",
  practiceDate: "2026-09-15",
  planningStateId: "a".repeat(64),
  instructions: "Keep secrets out. Do not reveal hidden patterns.",
  transition: "Continue as a planner.",
  profile: {
    timeZone: "UTC",
    resetMinutes: 240,
    dailyTarget: 2,
    highIntervalDays: 1,
    mediumIntervalDays: 3,
    lowIntervalDays: 7,
    allowPremiumProblems: true,
    difficultyPreference: "ANY",
  },
  goals: [],
  preferences: [],
  patterns: [
    {
      id: id(100),
      name: "Trees",
      freshSamples: 0,
      independentSamples: 0,
      assistedSamples: 0,
      gaveUpSamples: 0,
      lastPracticed: null,
      stale: false,
      reasons: ["Untested"],
    },
  ],
  reviews: [
    {
      id: id(200),
      kind: "TRANSFER",
      problemId: null,
      patternId: id(100),
      dueDate: "2026-09-15",
      urgency: null,
    },
  ],
  current: { savedPlan: false, selections: [], problems: [], attempt: null },
  candidates: [
    {
      id: id(1),
      leetcodeId: 1,
      title: "Two Sum",
      url: "https://leetcode.com/problems/two-sum/",
      difficulty: "EASY",
      availability: "AVAILABLE",
      patternIds: [id(100)],
    },
  ],
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
  estimatedTokens: 100,
};

async function startServer(app: Express): Promise<string> {
  const server = createServer(app);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  servers.push(server);
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("Test server did not start");
  return `http://127.0.0.1:${address.port}`;
}

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve, reject) => {
          server.close((error) => (error === undefined ? resolve() : reject(error)));
        }),
    ),
  );
});

describe("external AI context export", () => {
  it("puts hidden tags in the marked final section and supplies the full transition path", () => {
    const result = formatExternalAiMarkdown(packet);
    const marker = result.markdown.indexOf("## SPOILER-BEARING PATTERN DATA");
    expect(result.filename).toBe("practice-plus-plus-context-2026-09-15.md");
    expect(result.markdown.slice(0, marker)).not.toContain("Trees");
    expect(result.markdown.slice(0, marker)).not.toContain(id(100));
    expect(result.markdown.slice(marker)).toContain("Trees");
    expect(result.markdown).toContain("Begin independent work");
    expect(result.markdown).toContain("Request a small nudge");
    expect(result.markdown).toContain("Give up and review a solution");
    expect(result.markdown).toContain("Record the result");
    expect(result.markdown).toContain("Return only JSON with version 1");
  });

  it("includes code only when intentionally supplied and never includes a credential field", () => {
    const withoutCode = formatExternalAiMarkdown(packet).markdown;
    const withCode = formatExternalAiMarkdown(packet, "const answer = 42;").markdown;
    expect(withoutCode).not.toContain("Transient current code");
    expect(withCode).toContain("    const answer = 42;");
    expect(withCode).not.toMatch(/apiKey|authorization|session credential/i);
  });

  it("uses the authenticated profile and passes transient code only to the bounded assembler", async () => {
    const assemble = vi.fn().mockResolvedValue(packet);
    const app = createApp({
      authentication: {
        externalAiExport: { assembler: { assemble } },
        profileStore: {
          resolveByAuthSubject: vi.fn().mockResolvedValue({
            id: id(900),
            authSubject: "subject",
            role: "USER",
            createdAt: new Date(),
            updatedAt: new Date(),
          }),
        },
        verifier: { verify: vi.fn().mockResolvedValue({ subject: "subject" }) },
      },
      logger: pino({ level: "silent" }),
    });
    const url = await startServer(app);
    expect((await fetch(`${url}/ai/external-context`, { method: "POST" })).status).toBe(401);
    const response = await fetch(`${url}/ai/external-context?userId=other`, {
      method: "POST",
      headers: { authorization: "Bearer token", "content-type": "application/json" },
      body: JSON.stringify({
        policy: {
          mode: "ATTEMPT_TUTOR",
          attemptId: id(1),
          phase: "HELP",
          help: "DEBUGGING",
        },
        currentCode: "temporary code",
      }),
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(assemble).toHaveBeenCalledWith(
      id(900),
      {
        policy: {
          mode: "ATTEMPT_TUTOR",
          attemptId: id(1),
          phase: "HELP",
          help: "DEBUGGING",
        },
        messages: [{ role: "user", content: "temporary code" }],
      },
      expect.any(Date),
    );
  });

  it("rejects credentials and code outside an intentional debugging export", async () => {
    const assemble = vi.fn();
    const app = createApp({
      authentication: {
        externalAiExport: { assembler: { assemble } },
        profileStore: {
          resolveByAuthSubject: vi.fn().mockResolvedValue({
            id: id(900),
            authSubject: "subject",
            role: "USER",
            createdAt: new Date(),
            updatedAt: new Date(),
          }),
        },
        verifier: { verify: vi.fn().mockResolvedValue({ subject: "subject" }) },
      },
      logger: pino({ level: "silent" }),
    });
    const url = await startServer(app);
    for (const body of [
      { policy: { mode: "COACH", purpose: "GENERAL" }, apiKey: "secret" },
      { policy: { mode: "COACH", purpose: "GENERAL" }, currentCode: "code" },
    ]) {
      const response = await fetch(`${url}/ai/external-context`, {
        method: "POST",
        headers: { authorization: "Bearer token", "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      expect(response.status).toBe(400);
    }
    expect(assemble).not.toHaveBeenCalled();
  });
});
