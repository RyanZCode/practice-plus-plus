import { z } from "zod";
import { contextRequestSchema } from "./context.js";
import {
  attemptSummaryInputSchema,
  conversationSummarySchema,
  memorySuggestionSchema,
} from "./learnerContext.js";

export * from "./learnerContext.js";
export * from "./context.js";

export const providerIdSchema = z.enum(["openai"]);
export type ProviderId = z.infer<typeof providerIdSchema>;

export const openAiModels = ["gpt-5.4-mini", "gpt-5.4", "gpt-4.1-mini", "gpt-4.1"] as const;
export const modelNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9._:/-]*$/);

export const providerSelectionSchema = z.strictObject({
  providerId: providerIdSchema,
  model: modelNameSchema,
});
export type ProviderSelection = z.infer<typeof providerSelectionSchema>;

export const coachRequestSchema = z
  .strictObject({
    selection: providerSelectionSchema,
    apiKey: z.string().regex(/^[\x21-\x7e]{1,4096}$/),
    purpose: z.enum(["GENERAL", "PLANNING"]),
    messages: contextRequestSchema.shape.messages.unwrap().min(1).max(12),
  })
  .refine((request) => request.messages.at(-1)?.role === "user");
export type CoachRequest = z.infer<typeof coachRequestSchema>;

export const tutorHelpSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("CONCEPTUAL_HINT"), hintLevel: z.number().int().min(1).max(3) }),
  z.strictObject({
    type: z.enum(["CLARIFICATION", "DEBUGGING", "OPTIMIZATION", "SOLUTION_REVIEW"]),
  }),
]);
export type TutorHelp = z.infer<typeof tutorHelpSchema>;
export const tutorRequestSchema = z
  .strictObject({
    selection: providerSelectionSchema,
    apiKey: z.string().regex(/^[\x21-\x7e]{1,4096}$/),
    attemptId: z.uuid(),
    help: tutorHelpSchema,
    messages: contextRequestSchema.shape.messages.unwrap().min(1).max(12),
  })
  .refine((request) => request.messages.at(-1)?.role === "user");
export type TutorRequest = z.infer<typeof tutorRequestSchema>;

export const coachEventSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("text"), text: z.string() }),
  z.strictObject({ type: z.literal("done") }),
  z.strictObject({ type: z.literal("error"), error: z.string().max(200) }),
]);
export type CoachEvent = z.infer<typeof coachEventSchema>;

const checkpointFields = {
  selection: providerSelectionSchema,
  apiKey: z.string().regex(/^[\x21-\x7e]{1,4096}$/),
  messages: contextRequestSchema.shape.messages.unwrap().min(2).max(12),
};
export const checkpointRequestSchema = z.discriminatedUnion("mode", [
  z.strictObject({ ...checkpointFields, mode: z.literal("COACH"), attemptId: z.null() }),
  z.strictObject({ ...checkpointFields, mode: z.literal("ATTEMPT_TUTOR"), attemptId: z.uuid() }),
]);
export type CheckpointRequest = z.infer<typeof checkpointRequestSchema>;

export const checkpointResponseSchema = z.strictObject({
  summary: conversationSummarySchema,
  attemptSummary: attemptSummaryInputSchema.nullable(),
  memorySuggestions: z.array(memorySuggestionSchema).max(5),
});
export type CheckpointResponse = z.infer<typeof checkpointResponseSchema>;

const assessmentTextSchema = z
  .string()
  .trim()
  .min(1)
  .max(1000)
  .refine(
    (text) =>
      !/`|~~~|(?:^|\n)\s*(?:function|class|const|let|var|def|import|return)\b|=>/u.test(text),
    { message: "Use an assessment without code excerpts" },
  );

export const assessmentEvidenceSchema = z.enum([
  "ATTEMPT",
  "ASSISTANCE_EVENTS",
  "ATTEMPT_SUMMARY",
  "CONVERSATION_SUMMARY",
]);
export const attemptAssessmentDraftInputSchema = z.strictObject({
  outcome: z.enum(["INDEPENDENT", "ASSISTED", "GAVE_UP", "INCOMPLETE"]),
  confidence: z.enum(["CONFIDENT", "SHAKY"]).nullable(),
  optimality: z.enum(["OPTIMAL", "SUBOPTIMAL", "UNKNOWN"]).nullable(),
  timeSpentSeconds: z.number().int().nonnegative().max(2147483647).nullable(),
  approach: assessmentTextSchema.nullable(),
  notes: assessmentTextSchema.nullable(),
  reproducedFromMemory: z.boolean().nullable(),
  summary: attemptSummaryInputSchema.nullable(),
  evidence: z
    .array(assessmentEvidenceSchema)
    .min(1)
    .max(4)
    .refine((evidence) => new Set(evidence).size === evidence.length, {
      message: "Evidence categories must be unique",
    }),
});
export type AttemptAssessmentDraftInput = z.infer<typeof attemptAssessmentDraftInputSchema>;

export const attemptAssessmentRequestSchema = z.strictObject({
  selection: providerSelectionSchema,
  apiKey: z.string().regex(/^[\x21-\x7e]{1,4096}$/),
  attemptId: z.uuid(),
});
export type AttemptAssessmentRequest = z.infer<typeof attemptAssessmentRequestSchema>;

export const attemptAssessmentDraftSchema = attemptAssessmentDraftInputSchema.extend({
  id: z.uuid(),
  attemptId: z.uuid(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type AttemptAssessmentDraft = z.infer<typeof attemptAssessmentDraftSchema>;
export const attemptAssessmentDraftResponseSchema = z.strictObject({
  draft: attemptAssessmentDraftSchema.nullable(),
});

export const memorySuggestionListResponseSchema = z.strictObject({
  memorySuggestions: z.array(memorySuggestionSchema).max(50),
});
export type MemorySuggestionListResponse = z.infer<typeof memorySuggestionListResponseSchema>;

export const providersResponseSchema = z.strictObject({
  providers: z.array(z.strictObject({ id: providerIdSchema, name: z.string() })),
});
export type ProvidersResponse = z.infer<typeof providersResponseSchema>;

export const reviewRankingReasonSchema = z.discriminatedUnion("code", [
  z.strictObject({ code: z.literal("OVERDUE_REVIEW"), daysOverdue: z.number().int().positive() }),
  z.strictObject({ code: z.literal("REVIEW_DUE_TODAY") }),
  z.strictObject({ code: z.literal("REVIEW_URGENCY"), urgency: z.enum(["LOW", "MEDIUM", "HIGH"]) }),
]);
export type ReviewRankingReason = z.infer<typeof reviewRankingReasonSchema>;

export const freshRankingReasonSchema = z.strictObject({
  code: z.enum([
    "UNTESTED_PATTERN",
    "LIMITED_PATTERN_EVIDENCE",
    "WEAK_PATTERN",
    "STALE_PATTERN",
    "FRESH_PRACTICE",
    "RECENT_PATTERN_CONCENTRATION",
  ]),
});
export type FreshRankingReason = z.infer<typeof freshRankingReasonSchema>;

const wholeDaysSchema = z.number().int().min(1).max(90);

export const practiceSettingsSchema = z
  .strictObject({
    defaultAiModel: z.enum(openAiModels),
    attemptTimerMinutes: z.number().int().min(1).max(180),
    dailyTarget: z.number().int().min(1).max(10),
    redoIntervals: z.strictObject({
      high: wholeDaysSchema,
      low: wholeDaysSchema,
      medium: wholeDaysSchema,
    }),
    resetTime: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/),
    timeZone: z
      .string()
      .trim()
      .min(1)
      .max(100)
      .refine(isValidTimeZone, { message: "Invalid time zone" }),
  })
  .refine((settings) => settings.redoIntervals.high <= settings.redoIntervals.medium, {
    message: "Medium interval must be at least the high interval",
    path: ["redoIntervals", "medium"],
  })
  .refine((settings) => settings.redoIntervals.medium <= settings.redoIntervals.low, {
    message: "Low interval must be at least the medium interval",
    path: ["redoIntervals", "low"],
  });

export const practiceSettingsResponseSchema = z.strictObject({
  settings: practiceSettingsSchema.nullable(),
});

export type PracticeSettings = z.infer<typeof practiceSettingsSchema>;
export type PracticeSettingsResponse = z.infer<typeof practiceSettingsResponseSchema>;

export const mvpPatternNames = [
  "Arrays & Hashing",
  "Two Pointers",
  "Sliding Window",
  "Stack",
  "Binary Search",
  "Linked List",
  "Trees",
  "Heap / Priority Queue",
  "Backtracking",
  "Tries",
  "Graphs",
  "Dynamic Programming",
  "Greedy",
  "Intervals",
  "Math",
  "Bit Manipulation",
] as const;

export const catalogImportSourceSchema = z.strictObject({
  kind: z.enum(["CURATED", "LLM_GENERATED"]),
  name: z.string().trim().min(1).max(255),
});

export const catalogImportRequestSchema = z.strictObject({
  version: z.literal(1),
  source: catalogImportSourceSchema,
  rows: z.array(z.unknown()).min(1).max(200),
});

export const catalogImportRowSchema = z
  .strictObject({
    leetcodeId: z.number().int().positive(),
    slug: z
      .string()
      .trim()
      .min(1)
      .max(255)
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    title: z.string().trim().min(1).max(255),
    difficulty: z.enum(["EASY", "MEDIUM", "HARD"]),
    url: z.string().url().max(500),
    availability: z.enum(["AVAILABLE", "PAID_ONLY", "UNAVAILABLE"]).default("AVAILABLE"),
    patterns: z
      .array(z.enum(mvpPatternNames))
      .min(1)
      .max(3)
      .refine((patterns) => new Set(patterns).size === patterns.length, {
        message: "Pattern names must be unique",
      }),
  })
  .superRefine((row, context) => {
    if (row.url !== `https://leetcode.com/problems/${row.slug}/`) {
      context.addIssue({
        code: "custom",
        message: "URL must be the canonical LeetCode URL for the slug",
        path: ["url"],
      });
    }
  });

export const catalogImportErrorSchema = z.strictObject({
  row: z.number().int().positive(),
  code: z.enum(["INVALID_ROW", "DUPLICATE_LEETCODE_ID", "DUPLICATE_SLUG", "UNKNOWN_PATTERN"]),
  message: z.string().min(1),
});

export const catalogImportResponseSchema = z.strictObject({
  batchId: z.string().uuid().nullable(),
  importedCount: z.number().int().nonnegative(),
  errors: z.array(catalogImportErrorSchema),
});

export type CatalogImportError = z.infer<typeof catalogImportErrorSchema>;
export type CatalogImportRow = z.infer<typeof catalogImportRowSchema>;
export type CatalogImportSource = z.infer<typeof catalogImportSourceSchema>;
export type CatalogImportResponse = z.infer<typeof catalogImportResponseSchema>;

export const catalogProblemSchema = z.strictObject({
  id: z.string().uuid(),
  leetcodeId: z.number().int().positive(),
  slug: z.string(),
  title: z.string(),
  difficulty: z.enum(["EASY", "MEDIUM", "HARD"]),
  url: z.string().url(),
  availability: z.enum(["AVAILABLE", "PAID_ONLY", "UNAVAILABLE"]),
});

export const catalogResponseSchema = z.strictObject({
  problems: z.array(catalogProblemSchema),
});

export type CatalogProblem = z.infer<typeof catalogProblemSchema>;
export type CatalogResponse = z.infer<typeof catalogResponseSchema>;

export const catalogPreferencesSchema = z.strictObject({ hidePaidProblems: z.boolean() });
export type CatalogPreferences = z.infer<typeof catalogPreferencesSchema>;

export const catalogReviewStatusSchema = z.enum(["DRAFT", "APPROVED", "REJECTED"]);

export const catalogProblemInputSchema = catalogImportRowSchema;

export const catalogReviewProblemSchema = z.strictObject({
  id: z.string().uuid(),
  importBatchId: z.string().uuid(),
  leetcodeId: z.number().int().positive(),
  slug: z.string(),
  title: z.string(),
  difficulty: z.enum(["EASY", "MEDIUM", "HARD"]),
  url: z.string().url(),
  availability: z.enum(["AVAILABLE", "PAID_ONLY", "UNAVAILABLE"]),
  patterns: z.array(z.enum(mvpPatternNames)),
  reviewStatus: catalogReviewStatusSchema,
  published: z.boolean(),
  reviewedAt: z.string().datetime().nullable(),
  reviewedByUserProfileId: z.string().uuid().nullable(),
  publishedAt: z.string().datetime().nullable(),
  publishedByUserProfileId: z.string().uuid().nullable(),
});

export const catalogImportBatchReviewSchema = z.strictObject({
  id: z.string().uuid(),
  version: z.literal(1),
  source: catalogImportSourceSchema,
  createdAt: z.string().datetime(),
  createdByUserProfileId: z.string().uuid(),
  problems: z.array(catalogReviewProblemSchema),
});

export const catalogReviewDecisionRequestSchema = z.strictObject({
  decision: z.enum(["APPROVED", "REJECTED"]),
});

export const catalogReviewActionResponseSchema = z.strictObject({
  problemId: z.string().uuid(),
  reviewStatus: z.enum(["APPROVED", "REJECTED"]),
  reviewedAt: z.string().datetime(),
  reviewedByUserProfileId: z.string().uuid(),
});

export const catalogPublishResponseSchema = z.strictObject({
  batchId: z.string().uuid(),
  publishedCount: z.number().int().nonnegative(),
  publishedAt: z.string().datetime().nullable(),
  publishedByUserProfileId: z.string().uuid().nullable(),
});

export type CatalogProblemInput = z.infer<typeof catalogProblemInputSchema>;
export type CatalogReviewProblem = z.infer<typeof catalogReviewProblemSchema>;
export type CatalogImportBatchReview = z.infer<typeof catalogImportBatchReviewSchema>;
export type CatalogReviewDecision = z.infer<typeof catalogReviewDecisionRequestSchema>;
export type CatalogReviewActionResponse = z.infer<typeof catalogReviewActionResponseSchema>;
export type CatalogPublishResponse = z.infer<typeof catalogPublishResponseSchema>;

function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en", { timeZone }).format();
    return true;
  } catch {
    return false;
  }
}

export const attemptTimerSeconds = 30 * 60;
export const startAttemptSchema = z.strictObject({ problemId: z.string().uuid() });
export const attemptOutcomeSchema = z.enum(["INDEPENDENT", "ASSISTED", "GAVE_UP", "INCOMPLETE"]);
export const reportAttemptSchema = z.strictObject({
  outcome: z.enum(["INDEPENDENT", "ASSISTED", "GAVE_UP"]),
});
export type ReportAttempt = z.infer<typeof reportAttemptSchema>;
export const assistanceSchema = z
  .strictObject({
    type: z.enum([
      "CLARIFICATION",
      "CONCEPTUAL_HINT",
      "DEBUGGING",
      "OPTIMIZATION",
      "SOLUTION_REVIEW",
    ]),
    hintLevel: z.number().int().positive().max(32767).nullable(),
  })
  .refine((value) => value.type === "CONCEPTUAL_HINT" || value.hintLevel === null, {
    message: "Hint level applies only to conceptual hints.",
  });
export const redoNextActionSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("REPEAT") }),
  z.strictObject({ type: z.literal("COMPLETE") }),
  z.strictObject({ type: z.literal("CUSTOM_DATE"), dueDate: z.iso.date() }),
  z.strictObject({
    type: z.literal("TRANSFER"),
    pattern: z.enum(mvpPatternNames),
    dueDate: z.iso.date().optional(),
  }),
]);
export const confirmAttemptSchema = z.strictObject({
  nextAction: redoNextActionSchema.optional(),
  outcome: attemptOutcomeSchema,
  confidence: z.enum(["CONFIDENT", "SHAKY"]).nullable().default(null),
  optimality: z.enum(["OPTIMAL", "SUBOPTIMAL", "UNKNOWN"]).nullable().default(null),
  assistance: z.array(assistanceSchema).max(5).default([]),
  timeSpentSeconds: z.number().int().nonnegative().max(2147483647).nullable().default(null),
  approach: z.string().trim().max(1000).nullable().default(null),
  notes: z.string().trim().max(5000).nullable().default(null),
  reproducedFromMemory: z.boolean().nullable().default(null),
  summary: attemptSummaryInputSchema.nullable().optional(),
});
export type ConfirmAttempt = z.infer<typeof confirmAttemptSchema>;
export type Assistance = z.infer<typeof assistanceSchema>;
export function suggestedOutcome(assistance: Assistance[]): "GAVE_UP" | "ASSISTED" | null {
  if (assistance.some((event) => event.type === "SOLUTION_REVIEW")) return "GAVE_UP";
  if (assistance.some((event) => event.type !== "CLARIFICATION")) return "ASSISTED";
  return null;
}
export const reviewObligationSchema = z.strictObject({
  generatedDueDate: z.iso.date(),
  manualDueDate: z.iso.date().nullable(),
});
export type ReviewObligation = z.infer<typeof reviewObligationSchema>;
export const reviewOverrideSchema = z.strictObject({ manualDueDate: z.iso.date().nullable() });

export const attemptSchema = z.strictObject({
  nextAction: redoNextActionSchema.optional(),
  id: z.string().uuid(),
  patterns: z.array(z.enum(mvpPatternNames)).optional(),
  review: reviewObligationSchema.nullable().default(null),
  problem: catalogProblemSchema,
  type: z.enum(["FRESH", "REDO"]),
  practiceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  startedAt: z.string().datetime(),
  timerEndsAt: z.string().datetime().optional(),
  timerPausedAt: z.string().datetime().nullable().optional(),
  timerSkippedAt: z.string().datetime().nullable(),
  confirmedAt: z.string().datetime().nullable(),
  solutionReviewedAt: z.string().datetime().nullable(),
  outcome: attemptOutcomeSchema.nullable(),
  confidence: confirmAttemptSchema.shape.confidence,
  optimality: confirmAttemptSchema.shape.optimality,
  timeSpentSeconds: confirmAttemptSchema.shape.timeSpentSeconds,
  approach: confirmAttemptSchema.shape.approach,
  notes: confirmAttemptSchema.shape.notes,
  reproducedFromMemory: confirmAttemptSchema.shape.reproducedFromMemory,
  summary: attemptSummaryInputSchema
    .extend({ reviewedAt: z.string().datetime().nullable() })
    .nullable()
    .optional(),
  assistance: z.array(assistanceSchema),
});
export const activeAttemptResponseSchema = z.strictObject({ attempt: attemptSchema.nullable() });
export type Attempt = z.infer<typeof attemptSchema>;

export const attemptHistoryQuerySchema = z
  .strictObject({
    before: z.string().datetime().optional(),
    beforeId: z.string().uuid().optional(),
  })
  .refine((value) => (value.before === undefined) === (value.beforeId === undefined));
export type AttemptHistoryQuery = z.infer<typeof attemptHistoryQuerySchema>;
export const attemptHistoryResponseSchema = z.strictObject({
  attempts: z
    .array(
      attemptSchema.extend({
        confirmedAt: z.string().datetime(),
        outcome: attemptOutcomeSchema,
      }),
    )
    .max(20),
  next: attemptHistoryQuerySchema.nullable(),
});
export type AttemptHistoryResponse = z.infer<typeof attemptHistoryResponseSchema>;

export const dailyPlanSchema = z
  .strictObject({
    practiceDate: z.iso.date(),
    target: z.number().int().min(1).max(10),
    items: z
      .array(
        z.strictObject({
          id: z.string().uuid(),
          problem: catalogProblemSchema,
          kind: z.enum(["DIAGNOSTIC", "FRESH", "REDO", "TRANSFER"]),
          explanation: z.string(),
          status: z.enum(["PENDING", "ACTIVE", "FINISHED"]),
        }),
      )
      .max(10),
  })
  .refine((plan) => plan.items.length <= plan.target);
export type DailyPlan = z.infer<typeof dailyPlanSchema>;
