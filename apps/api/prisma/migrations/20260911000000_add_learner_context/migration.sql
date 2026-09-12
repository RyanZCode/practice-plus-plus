-- CreateEnum
CREATE TYPE "LearnerGoalState" AS ENUM ('ACTIVE', 'COMPLETED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "ConversationMode" AS ENUM ('COACH', 'ATTEMPT_TUTOR');

-- CreateEnum
CREATE TYPE "MemoryLifecycleState" AS ENUM ('ACTIVE', 'IMPROVING', 'RESOLVED');

-- CreateEnum
CREATE TYPE "MemoryApprovalState" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateTable
CREATE TABLE "learner_goals" (
    "id" UUID NOT NULL,
    "user_profile_id" UUID NOT NULL,
    "target" VARCHAR(1000) NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "state" "LearnerGoalState" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "learner_goals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "teaching_preferences" (
    "id" UUID NOT NULL,
    "user_profile_id" UUID NOT NULL,
    "preference" VARCHAR(1000) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "teaching_preferences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attempt_summaries" (
    "attempt_id" UUID NOT NULL,
    "user_profile_id" UUID NOT NULL,
    "approach" VARCHAR(1000),
    "stuck_point" VARCHAR(1000),
    "misconception" VARCHAR(1000),
    "assistance" VARCHAR(1000),
    "progress_trigger" VARCHAR(1000),
    "final_understanding" VARCHAR(1000),
    "next_teaching_action" VARCHAR(1000),
    "reviewed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "attempt_summaries_pkey" PRIMARY KEY ("attempt_id")
);

-- CreateTable
CREATE TABLE "conversation_summaries" (
    "id" UUID NOT NULL,
    "user_profile_id" UUID NOT NULL,
    "mode" "ConversationMode" NOT NULL,
    "attempt_id" UUID,
    "topics" VARCHAR(1000) NOT NULL,
    "learning_progress" VARCHAR(1000),
    "next_steps" VARCHAR(1000),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "conversation_summaries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "learner_memories" (
    "id" UUID NOT NULL,
    "user_profile_id" UUID NOT NULL,
    "category" VARCHAR(100) NOT NULL,
    "content" VARCHAR(1000) NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "last_observed_at" TIMESTAMPTZ(3) NOT NULL,
    "lifecycle_state" "MemoryLifecycleState" NOT NULL DEFAULT 'ACTIVE',
    "approval_state" "MemoryApprovalState" NOT NULL DEFAULT 'PENDING',
    "reviewed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "learner_memories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "learner_memory_evidence" (
    "id" UUID NOT NULL,
    "user_profile_id" UUID NOT NULL,
    "memory_id" UUID NOT NULL,
    "learner_goal_id" UUID,
    "teaching_preference_id" UUID,
    "attempt_id" UUID,
    "assistance_event_id" UUID,
    "assistance_attempt_id" UUID,
    "attempt_summary_id" UUID,
    "conversation_summary_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "learner_memory_evidence_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "learner_goals_user_profile_id_state_idx" ON "learner_goals"("user_profile_id", "state");

-- CreateIndex
CREATE UNIQUE INDEX "learner_goals_id_user_profile_id_key" ON "learner_goals"("id", "user_profile_id");

-- CreateIndex
CREATE INDEX "teaching_preferences_user_profile_id_idx" ON "teaching_preferences"("user_profile_id");

-- CreateIndex
CREATE UNIQUE INDEX "teaching_preferences_id_user_profile_id_key" ON "teaching_preferences"("id", "user_profile_id");

-- CreateIndex
CREATE INDEX "attempt_summaries_user_profile_id_idx" ON "attempt_summaries"("user_profile_id");

-- CreateIndex
CREATE UNIQUE INDEX "attempt_summaries_attempt_id_user_profile_id_key" ON "attempt_summaries"("attempt_id", "user_profile_id");

-- CreateIndex
CREATE INDEX "conversation_summaries_user_profile_id_mode_updated_at_idx" ON "conversation_summaries"("user_profile_id", "mode", "updated_at");

-- CreateIndex
CREATE INDEX "conversation_summaries_attempt_id_user_profile_id_idx" ON "conversation_summaries"("attempt_id", "user_profile_id");

-- CreateIndex
CREATE UNIQUE INDEX "conversation_summaries_id_user_profile_id_key" ON "conversation_summaries"("id", "user_profile_id");

-- CreateIndex
CREATE INDEX "learner_memories_user_profile_id_approval_state_lifecycle_s_idx" ON "learner_memories"("user_profile_id", "approval_state", "lifecycle_state");

-- CreateIndex
CREATE UNIQUE INDEX "learner_memories_id_user_profile_id_key" ON "learner_memories"("id", "user_profile_id");

-- CreateIndex
CREATE INDEX "learner_memory_evidence_memory_id_user_profile_id_idx" ON "learner_memory_evidence"("memory_id", "user_profile_id");

-- CreateIndex
CREATE INDEX "learner_memory_evidence_learner_goal_id_user_profile_id_idx" ON "learner_memory_evidence"("learner_goal_id", "user_profile_id");

-- CreateIndex
CREATE INDEX "learner_memory_evidence_teaching_preference_id_user_profile_idx" ON "learner_memory_evidence"("teaching_preference_id", "user_profile_id");

-- CreateIndex
CREATE INDEX "learner_memory_evidence_attempt_id_user_profile_id_idx" ON "learner_memory_evidence"("attempt_id", "user_profile_id");

-- CreateIndex
CREATE INDEX "learner_memory_evidence_assistance_event_id_assistance_atte_idx" ON "learner_memory_evidence"("assistance_event_id", "assistance_attempt_id");

-- CreateIndex
CREATE INDEX "learner_memory_evidence_assistance_attempt_id_user_profile__idx" ON "learner_memory_evidence"("assistance_attempt_id", "user_profile_id");

-- CreateIndex
CREATE INDEX "learner_memory_evidence_attempt_summary_id_user_profile_id_idx" ON "learner_memory_evidence"("attempt_summary_id", "user_profile_id");

-- CreateIndex
CREATE INDEX "learner_memory_evidence_conversation_summary_id_user_profil_idx" ON "learner_memory_evidence"("conversation_summary_id", "user_profile_id");

-- CreateIndex
CREATE UNIQUE INDEX "attempts_id_user_profile_id_key" ON "attempts"("id", "user_profile_id");

-- CreateIndex
CREATE UNIQUE INDEX "assistance_events_id_attempt_id_key" ON "assistance_events"("id", "attempt_id");

-- AddForeignKey
ALTER TABLE "learner_goals" ADD CONSTRAINT "learner_goals_user_profile_id_fkey" FOREIGN KEY ("user_profile_id") REFERENCES "user_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teaching_preferences" ADD CONSTRAINT "teaching_preferences_user_profile_id_fkey" FOREIGN KEY ("user_profile_id") REFERENCES "user_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attempt_summaries" ADD CONSTRAINT "attempt_summaries_attempt_id_user_profile_id_fkey" FOREIGN KEY ("attempt_id", "user_profile_id") REFERENCES "attempts"("id", "user_profile_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_summaries" ADD CONSTRAINT "conversation_summaries_user_profile_id_fkey" FOREIGN KEY ("user_profile_id") REFERENCES "user_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_summaries" ADD CONSTRAINT "conversation_summaries_attempt_id_user_profile_id_fkey" FOREIGN KEY ("attempt_id", "user_profile_id") REFERENCES "attempts"("id", "user_profile_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "learner_memories" ADD CONSTRAINT "learner_memories_user_profile_id_fkey" FOREIGN KEY ("user_profile_id") REFERENCES "user_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "learner_memory_evidence" ADD CONSTRAINT "learner_memory_evidence_memory_id_user_profile_id_fkey" FOREIGN KEY ("memory_id", "user_profile_id") REFERENCES "learner_memories"("id", "user_profile_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "learner_memory_evidence" ADD CONSTRAINT "learner_memory_evidence_learner_goal_id_user_profile_id_fkey" FOREIGN KEY ("learner_goal_id", "user_profile_id") REFERENCES "learner_goals"("id", "user_profile_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "learner_memory_evidence" ADD CONSTRAINT "learner_memory_evidence_teaching_preference_id_user_profil_fkey" FOREIGN KEY ("teaching_preference_id", "user_profile_id") REFERENCES "teaching_preferences"("id", "user_profile_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "learner_memory_evidence" ADD CONSTRAINT "learner_memory_evidence_attempt_id_user_profile_id_fkey" FOREIGN KEY ("attempt_id", "user_profile_id") REFERENCES "attempts"("id", "user_profile_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "learner_memory_evidence" ADD CONSTRAINT "learner_memory_evidence_assistance_event_id_assistance_att_fkey" FOREIGN KEY ("assistance_event_id", "assistance_attempt_id") REFERENCES "assistance_events"("id", "attempt_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "learner_memory_evidence" ADD CONSTRAINT "learner_memory_evidence_assistance_attempt_id_user_profile_fkey" FOREIGN KEY ("assistance_attempt_id", "user_profile_id") REFERENCES "attempts"("id", "user_profile_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "learner_memory_evidence" ADD CONSTRAINT "learner_memory_evidence_attempt_summary_id_user_profile_id_fkey" FOREIGN KEY ("attempt_summary_id", "user_profile_id") REFERENCES "attempt_summaries"("attempt_id", "user_profile_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "learner_memory_evidence" ADD CONSTRAINT "learner_memory_evidence_conversation_summary_id_user_profi_fkey" FOREIGN KEY ("conversation_summary_id", "user_profile_id") REFERENCES "conversation_summaries"("id", "user_profile_id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "learner_goals" ADD CONSTRAINT "learner_goals_priority_check" CHECK ("priority" >= 0);
ALTER TABLE "conversation_summaries" ADD CONSTRAINT "conversation_summaries_mode_check"
  CHECK (("mode" = 'COACH' AND "attempt_id" IS NULL) OR
         ("mode" = 'ATTEMPT_TUTOR' AND "attempt_id" IS NOT NULL));
ALTER TABLE "learner_memories"
  ADD CONSTRAINT "learner_memories_confidence_check" CHECK ("confidence" >= 0 AND "confidence" <= 1),
  ADD CONSTRAINT "learner_memories_review_check"
    CHECK (("approval_state" = 'PENDING' AND "reviewed_at" IS NULL) OR
           ("approval_state" IN ('APPROVED', 'REJECTED') AND "reviewed_at" IS NOT NULL));
ALTER TABLE "learner_memory_evidence"
  ADD CONSTRAINT "learner_memory_evidence_source_check"
    CHECK (num_nonnulls("learner_goal_id", "teaching_preference_id", "attempt_id",
                       "assistance_event_id", "attempt_summary_id", "conversation_summary_id") = 1),
  ADD CONSTRAINT "learner_memory_evidence_assistance_check"
    CHECK (("assistance_event_id" IS NULL) = ("assistance_attempt_id" IS NULL));

CREATE FUNCTION invalidate_learner_memory_evidence() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  UPDATE learner_memories
     SET approval_state = 'PENDING', reviewed_at = NULL, updated_at = CURRENT_TIMESTAMP
   WHERE id = OLD.memory_id AND user_profile_id = OLD.user_profile_id
     AND approval_state = 'APPROVED';
  RETURN NULL;
END;
$$;

CREATE TRIGGER learner_memory_evidence_removed
AFTER DELETE OR UPDATE ON learner_memory_evidence
FOR EACH ROW EXECUTE FUNCTION invalidate_learner_memory_evidence();

CREATE FUNCTION require_approved_memory_evidence() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM learner_memories m
     WHERE m.id = NEW.id AND m.approval_state = 'APPROVED'
       AND NOT EXISTS (SELECT 1 FROM learner_memory_evidence e WHERE e.memory_id = m.id)
  ) THEN
    RAISE EXCEPTION 'Approved memory requires supporting evidence' USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER approved_memory_requires_evidence
AFTER INSERT OR UPDATE ON learner_memories
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION require_approved_memory_evidence();

ALTER TABLE "learner_goals" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "teaching_preferences" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "attempt_summaries" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "conversation_summaries" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "learner_memories" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "learner_memory_evidence" ENABLE ROW LEVEL SECURITY;
