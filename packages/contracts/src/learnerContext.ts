import { z } from "zod";

const learningTextSchema = z
  .string()
  .trim()
  .min(1)
  .max(1000)
  .refine(
    (text) =>
      !/`|~~~|(?:^|\n)\s*(?:function|class|const|let|var|def|import|return)\b|=>/u.test(text),
    { message: "Use a summary without code excerpts" },
  );

export const learnerGoalInputSchema = z.strictObject({
  target: learningTextSchema,
  priority: z.number().int().min(0).max(2147483647),
  state: z.enum(["ACTIVE", "COMPLETED", "ARCHIVED"]),
});
export type LearnerGoalInput = z.infer<typeof learnerGoalInputSchema>;

export const learnerGoalSchema = learnerGoalInputSchema.extend({ id: z.uuid() });
export type LearnerGoal = z.infer<typeof learnerGoalSchema>;

export const teachingPreferenceInputSchema = z.strictObject({ preference: learningTextSchema });
export type TeachingPreferenceInput = z.infer<typeof teachingPreferenceInputSchema>;

export const teachingPreferenceSchema = teachingPreferenceInputSchema.extend({ id: z.uuid() });
export type TeachingPreference = z.infer<typeof teachingPreferenceSchema>;

export const attemptSummaryInputSchema = z.strictObject({
  approach: learningTextSchema.nullable(),
  stuckPoint: learningTextSchema.nullable(),
  misconception: learningTextSchema.nullable(),
  assistance: learningTextSchema.nullable(),
  progressTrigger: learningTextSchema.nullable(),
  finalUnderstanding: learningTextSchema.nullable(),
  nextTeachingAction: learningTextSchema.nullable(),
});
export type AttemptSummaryInput = z.infer<typeof attemptSummaryInputSchema>;

export const attemptSummarySchema = attemptSummaryInputSchema.extend({
  attemptId: z.uuid(),
  reviewedAt: z.iso.datetime().nullable(),
});
export type AttemptSummary = z.infer<typeof attemptSummarySchema>;

const conversationFields = {
  topics: learningTextSchema,
  learningProgress: learningTextSchema.nullable(),
  nextSteps: learningTextSchema.nullable(),
};

export const conversationSummaryInputSchema = z.discriminatedUnion("mode", [
  z.strictObject({ ...conversationFields, mode: z.literal("COACH"), attemptId: z.null() }),
  z.strictObject({ ...conversationFields, mode: z.literal("ATTEMPT_TUTOR"), attemptId: z.uuid() }),
]);
export type ConversationSummaryInput = z.infer<typeof conversationSummaryInputSchema>;

export const conversationSummarySchema = z.discriminatedUnion("mode", [
  conversationSummaryInputSchema.options[0].extend({ id: z.uuid(), updatedAt: z.iso.datetime() }),
  conversationSummaryInputSchema.options[1].extend({ id: z.uuid(), updatedAt: z.iso.datetime() }),
]);
export type ConversationSummary = z.infer<typeof conversationSummarySchema>;

export const memorySuggestionDraftSchema = z.strictObject({
  category: learningTextSchema.max(100),
  content: learningTextSchema,
  confidence: z.number().min(0).max(1),
  lifecycleState: z.enum(["ACTIVE", "IMPROVING", "RESOLVED"]),
});
export type MemorySuggestionDraft = z.infer<typeof memorySuggestionDraftSchema>;

export const rollingSummaryOutputSchema = z
  .strictObject({
    summary: z.strictObject(conversationFields),
    attemptSummary: attemptSummaryInputSchema.nullable(),
    memorySuggestions: z.array(memorySuggestionDraftSchema).max(5),
  })
  .superRefine((value, context) => {
    if (value.memorySuggestions.some((suggestion) => suggestion.content === value.summary.topics)) {
      context.addIssue({
        code: "custom",
        message: "Suggestions must be distinct from the summary",
      });
    }
  });
export type RollingSummaryOutput = z.infer<typeof rollingSummaryOutputSchema>;

export const memoryEvidenceSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("LEARNER_GOAL"), learnerGoalId: z.uuid() }),
  z.strictObject({ type: z.literal("TEACHING_PREFERENCE"), teachingPreferenceId: z.uuid() }),
  z.strictObject({ type: z.literal("ATTEMPT"), attemptId: z.uuid() }),
  z.strictObject({
    type: z.literal("ASSISTANCE_EVENT"),
    assistanceEventId: z.uuid(),
    attemptId: z.uuid(),
  }),
  z.strictObject({ type: z.literal("ATTEMPT_SUMMARY"), attemptId: z.uuid() }),
  z.strictObject({ type: z.literal("CONVERSATION_SUMMARY"), conversationSummaryId: z.uuid() }),
]);
export type MemoryEvidence = z.infer<typeof memoryEvidenceSchema>;

const memoryFields = {
  category: learningTextSchema.max(100),
  content: learningTextSchema,
  confidence: z.number().min(0).max(1),
  lastObservedAt: z.iso.datetime(),
  lifecycleState: z.enum(["ACTIVE", "IMPROVING", "RESOLVED"]),
};

export const memorySuggestionInputSchema = z.strictObject({
  ...memoryFields,
  evidence: z.array(memoryEvidenceSchema).min(1),
});
export type MemorySuggestionInput = z.infer<typeof memorySuggestionInputSchema>;

export const memorySuggestionSchema = z.strictObject({
  ...memoryFields,
  id: z.uuid(),
  approvalState: z.literal("PENDING"),
  reviewedAt: z.null(),
  evidence: z.array(memoryEvidenceSchema),
});
export type MemorySuggestion = z.infer<typeof memorySuggestionSchema>;

export const learnerMemorySchema = z.strictObject({
  ...memoryFields,
  id: z.uuid(),
  approvalState: z.literal("APPROVED"),
  reviewedAt: z.iso.datetime(),
  evidence: z.array(memoryEvidenceSchema).min(1),
});
export type LearnerMemory = z.infer<typeof learnerMemorySchema>;

export const rejectedMemorySuggestionSchema = memorySuggestionSchema.extend({
  approvalState: z.literal("REJECTED"),
  reviewedAt: z.iso.datetime(),
});
export type RejectedMemorySuggestion = z.infer<typeof rejectedMemorySuggestionSchema>;

export const learningContextEvidenceSchema = z.discriminatedUnion("type", [
  z.strictObject({
    type: z.literal("LEARNER_GOAL"),
    id: z.uuid(),
    label: learningTextSchema,
  }),
  z.strictObject({
    type: z.literal("TEACHING_PREFERENCE"),
    id: z.uuid(),
    label: learningTextSchema,
  }),
  z.strictObject({
    type: z.literal("ATTEMPT"),
    id: z.uuid(),
    label: learningTextSchema,
    occurredAt: z.iso.datetime(),
  }),
  z.strictObject({
    type: z.literal("ASSISTANCE_EVENT"),
    id: z.uuid(),
    attemptId: z.uuid(),
    label: learningTextSchema,
    occurredAt: z.iso.datetime(),
  }),
  z.strictObject({
    type: z.literal("ATTEMPT_SUMMARY"),
    id: z.uuid(),
    label: learningTextSchema,
    occurredAt: z.iso.datetime(),
  }),
  z.strictObject({
    type: z.literal("CONVERSATION_SUMMARY"),
    id: z.uuid(),
    label: learningTextSchema,
    occurredAt: z.iso.datetime(),
  }),
]);
export type LearningContextEvidence = z.infer<typeof learningContextEvidenceSchema>;

export const learningContextInferenceSchema = z.strictObject({
  ...memoryFields,
  id: z.uuid(),
  approvalState: z.enum(["PENDING", "APPROVED", "REJECTED"]),
  reviewedAt: z.iso.datetime().nullable(),
  evidence: z.array(learningContextEvidenceSchema),
});
export type LearningContextInference = z.infer<typeof learningContextInferenceSchema>;

export const observedAttemptSchema = z.strictObject({
  id: z.uuid(),
  problemTitle: learningTextSchema,
  practiceDate: z.iso.date(),
  confirmedAt: z.iso.datetime(),
  outcome: z.enum(["INDEPENDENT", "ASSISTED", "GAVE_UP", "INCOMPLETE"]),
  assistance: z.array(
    z.enum(["CLARIFICATION", "CONCEPTUAL_HINT", "DEBUGGING", "OPTIMIZATION", "SOLUTION_REVIEW"]),
  ),
});
export type ObservedAttempt = z.infer<typeof observedAttemptSchema>;

export const learningContextResponseSchema = z.strictObject({
  userSupplied: z.strictObject({
    goals: z.array(learnerGoalSchema),
    teachingPreferences: z.array(teachingPreferenceSchema),
  }),
  observed: z.strictObject({
    attempts: z.array(observedAttemptSchema),
    summaries: z.array(conversationSummarySchema),
  }),
  inferred: z.array(learningContextInferenceSchema),
  exportedAt: z.iso.datetime(),
});
export type LearningContextResponse = z.infer<typeof learningContextResponseSchema>;

export const memoryCorrectionSchema = z.strictObject({
  category: memorySuggestionDraftSchema.shape.category,
  content: memorySuggestionDraftSchema.shape.content,
  confidence: memorySuggestionDraftSchema.shape.confidence,
  lifecycleState: memorySuggestionDraftSchema.shape.lifecycleState,
});
export type MemoryCorrection = z.infer<typeof memoryCorrectionSchema>;

export const memoryReviewSchema = z.discriminatedUnion("action", [
  z.strictObject({ action: z.literal("APPROVE") }),
  z.strictObject({ action: z.literal("REJECT") }),
  z.strictObject({ action: z.literal("CORRECT"), correction: memoryCorrectionSchema }),
]);
export type MemoryReview = z.infer<typeof memoryReviewSchema>;
