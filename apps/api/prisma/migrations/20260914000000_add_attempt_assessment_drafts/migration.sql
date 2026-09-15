CREATE TABLE "attempt_assessment_drafts" (
    "id" UUID NOT NULL,
    "attempt_id" UUID NOT NULL,
    "user_profile_id" UUID NOT NULL,
    "outcome" "AttemptOutcome" NOT NULL,
    "confidence" "AttemptConfidence",
    "optimality" "AttemptOptimality",
    "time_spent_seconds" INTEGER,
    "approach" VARCHAR(1000),
    "notes" VARCHAR(1000),
    "reproduced_from_memory" BOOLEAN,
    "summary" JSONB,
    "evidence" TEXT[],
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "attempt_assessment_drafts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "attempt_assessment_drafts_attempt_id_key" ON "attempt_assessment_drafts"("attempt_id");
CREATE UNIQUE INDEX "attempt_assessment_drafts_id_user_profile_id_key" ON "attempt_assessment_drafts"("id", "user_profile_id");
CREATE UNIQUE INDEX "attempt_assessment_drafts_attempt_id_user_profile_id_key" ON "attempt_assessment_drafts"("attempt_id", "user_profile_id");
CREATE INDEX "attempt_assessment_drafts_user_profile_id_idx" ON "attempt_assessment_drafts"("user_profile_id");

ALTER TABLE "attempt_assessment_drafts" ADD CONSTRAINT "attempt_assessment_drafts_attempt_id_user_profile_id_fkey" FOREIGN KEY ("attempt_id", "user_profile_id") REFERENCES "attempts"("id", "user_profile_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "attempt_assessment_drafts" ADD CONSTRAINT "attempt_assessment_drafts_user_profile_id_fkey" FOREIGN KEY ("user_profile_id") REFERENCES "user_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "attempt_assessment_drafts" ADD CONSTRAINT "attempt_assessment_drafts_time_spent_check" CHECK ("time_spent_seconds" IS NULL OR "time_spent_seconds" >= 0);
ALTER TABLE "attempt_assessment_drafts" ADD CONSTRAINT "attempt_assessment_drafts_evidence_check" CHECK (cardinality("evidence") BETWEEN 1 AND 4);

ALTER TABLE "attempt_assessment_drafts" ENABLE ROW LEVEL SECURITY;
