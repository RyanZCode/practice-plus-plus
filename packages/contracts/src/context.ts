import { z } from "zod";
import {
  attemptSummaryInputSchema,
  conversationSummarySchema,
  learnerGoalSchema,
  learnerMemorySchema,
  teachingPreferenceSchema,
} from "./learnerContext.js";

export const contextLimits = {
  estimatedTokens: 8000,
  bytes: 48 * 1024,
  goals: 5,
  preferences: 5,
  patterns: 16,
  reviews: 30,
  candidates: 150,
  history: 20,
  memories: 10,
  messages: 12,
} as const;

const messageSchema = z.strictObject({
  role: z.enum(["user", "assistant"]),
  content: z.string().min(1).max(16000),
});
export const contextPolicySchema = z.discriminatedUnion("mode", [
  z.strictObject({ mode: z.literal("COACH"), purpose: z.enum(["GENERAL", "PLANNING"]) }),
  z
    .strictObject({
      mode: z.literal("ATTEMPT_TUTOR"),
      attemptId: z.uuid(),
      phase: z.enum(["INDEPENDENT", "HELP", "SOLUTION_REVIEW", "RESULT"]),
      help: z.enum(["CLARIFICATION", "CONCEPTUAL_HINT", "DEBUGGING", "OPTIMIZATION"]).optional(),
      hintLevel: z.number().int().min(1).max(4).optional(),
    })
    .superRefine((policy, ctx) => {
      if ((policy.phase === "HELP") !== (policy.help !== undefined))
        ctx.addIssue({ code: "custom", message: "Select help only in the help phase" });
      if ((policy.help === "CONCEPTUAL_HINT") !== (policy.hintLevel !== undefined))
        ctx.addIssue({
          code: "custom",
          message: "Select a guidance step only for conceptual hints",
        });
    }),
]);
export const contextRequestSchema = z.strictObject({
  policy: contextPolicySchema,
  messages: z.array(messageSchema).max(100).default([]),
});
export type ContextRequest = z.infer<typeof contextRequestSchema>;

const tagSchema = z.strictObject({ id: z.uuid(), name: z.string().max(100) });
const problemSchema = z.strictObject({
  id: z.uuid(),
  leetcodeId: z.number().int().positive(),
  title: z.string().max(255),
  url: z.string().url().max(500),
  difficulty: z.enum(["EASY", "MEDIUM", "HARD"]),
  availability: z.enum(["AVAILABLE", "PAID_ONLY", "UNAVAILABLE"]),
  patternIds: z.array(z.uuid()).max(3),
});
const assistanceSchema = z.strictObject({
  id: z.uuid(),
  type: z.enum([
    "CLARIFICATION",
    "CONCEPTUAL_HINT",
    "DEBUGGING",
    "OPTIMIZATION",
    "SOLUTION_REVIEW",
  ]),
  hintLevel: z.number().int().nullable(),
  source: z.enum(["SELF_REPORTED", "LEETCODE_SOLUTION", "INTEGRATED_AI"]),
});
const factSchema = z.strictObject({
  id: z.uuid(),
  problemId: z.uuid(),
  patternIds: z.array(z.uuid()).max(3),
  type: z.enum(["FRESH", "REDO"]),
  practiceDate: z.iso.date(),
  startedAt: z.iso.datetime(),
  confirmedAt: z.iso.datetime().nullable(),
  outcome: z.enum(["INDEPENDENT", "ASSISTED", "GAVE_UP", "INCOMPLETE"]).nullable(),
  confidence: z.enum(["CONFIDENT", "SHAKY"]).nullable(),
  optimality: z.enum(["OPTIMAL", "SUBOPTIMAL", "UNKNOWN"]).nullable(),
  approach: z.string().max(1000).nullable(),
  assistance: z.array(assistanceSchema).max(20),
  assistanceOmitted: z.number().int().nonnegative(),
  summary: attemptSummaryInputSchema.nullable(),
});
const selectionSchema = z.strictObject({
  problemId: z.uuid(),
  kind: z.enum(["DIAGNOSTIC", "FRESH", "REDO", "TRANSFER"]),
  reason: z.string().max(100),
  transferId: z.uuid().nullable(),
  status: z.enum(["PENDING", "ACTIVE", "FINISHED", "INCOMPLETE"]),
});
const omissionSchema = z.strictObject({
  goals: z.number().int().nonnegative(),
  preferences: z.number().int().nonnegative(),
  patterns: z.number().int().nonnegative(),
  reviews: z.number().int().nonnegative(),
  candidates: z.number().int().nonnegative(),
  history: z.number().int().nonnegative(),
  memories: z.number().int().nonnegative(),
  summary: z.number().int().nonnegative(),
  messages: z.number().int().nonnegative(),
});

export const contextPacketSchema = z
  .strictObject({
    version: z.literal(1),
    policy: contextPolicySchema,
    generatedAt: z.iso.datetime(),
    practiceDate: z.iso.date(),
    planningStateId: z.string().regex(/^[a-f0-9]{64}$/),
    instructions: z.string().max(5000),
    transition: z.string().max(1000),
    profile: z.strictObject({
      timeZone: z.string().max(100),
      resetMinutes: z.number().int().min(0).max(1439),
      dailyTarget: z.number().int().min(1).max(10),
      highIntervalDays: z.number().int().min(1).max(90),
      mediumIntervalDays: z.number().int().min(1).max(90),
      lowIntervalDays: z.number().int().min(1).max(90),
      allowPremiumProblems: z.boolean(),
      difficultyPreference: z.enum(["ANY", "EASIER", "MEDIUM_ONLY"]),
    }),
    goals: z.array(learnerGoalSchema).max(contextLimits.goals),
    preferences: z.array(teachingPreferenceSchema).max(contextLimits.preferences),
    patterns: z
      .array(
        tagSchema.extend({
          freshSamples: z.number().int().min(0).max(5),
          independentSamples: z.number().int().min(0).max(5),
          assistedSamples: z.number().int().min(0).max(5),
          gaveUpSamples: z.number().int().min(0).max(5),
          lastPracticed: z.iso.date().nullable(),
          stale: z.boolean(),
          reasons: z.array(z.string().max(100)).max(6),
        }),
      )
      .max(contextLimits.patterns),
    reviews: z
      .array(
        z.strictObject({
          id: z.uuid(),
          kind: z.enum(["REDO", "TRANSFER"]),
          problemId: z.uuid().nullable(),
          patternId: z.uuid().nullable(),
          dueDate: z.iso.date(),
          urgency: z.enum(["LOW", "MEDIUM", "HIGH"]).nullable(),
        }),
      )
      .max(contextLimits.reviews),
    current: z.strictObject({
      savedPlan: z.boolean(),
      selections: z.array(selectionSchema).max(10),
      problems: z.array(problemSchema).max(10),
      attempt: factSchema
        .extend({
          problem: problemSchema,
          timerSkipped: z.boolean(),
          solutionReviewed: z.boolean(),
          reproducedFromMemory: z.boolean().nullable(),
        })
        .nullable(),
    }),
    candidates: z.array(problemSchema).max(contextLimits.candidates),
    history: z
      .array(
        factSchema.extend({ reason: z.enum(["CURRENT_PROBLEM", "RELATED_PATTERN", "RECENT"]) }),
      )
      .max(contextLimits.history),
    memories: z
      .array(
        learnerMemorySchema.extend({
          evidence: learnerMemorySchema.shape.evidence.max(10),
          evidenceOmitted: z.number().int().nonnegative(),
          reason: z.enum(["CURRENT_PROBLEM", "RELATED_PATTERN", "RECENT"]),
        }),
      )
      .max(contextLimits.memories),
    summary: conversationSummarySchema.nullable(),
    messages: z.array(messageSchema).max(contextLimits.messages),
    omitted: omissionSchema,
    estimatedTokens: z.number().int().nonnegative().max(contextLimits.estimatedTokens),
  })
  .superRefine((packet, ctx) => {
    let bytes = 0;
    for (const character of JSON.stringify(packet)) {
      const point = character.codePointAt(0)!;
      bytes += point <= 0x7f ? 1 : point <= 0x7ff ? 2 : point <= 0xffff ? 3 : 4;
    }
    if (bytes > contextLimits.bytes || Math.ceil(bytes / 4) > packet.estimatedTokens)
      ctx.addIssue({ code: "custom", message: "Context exceeds its declared budget" });
  });
export type ContextPacket = z.infer<typeof contextPacketSchema>;
