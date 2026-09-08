CREATE TYPE "AttemptOutcome" AS ENUM ('INDEPENDENT', 'ASSISTED', 'GAVE_UP', 'INCOMPLETE');
CREATE TYPE "AttemptConfidence" AS ENUM ('CONFIDENT', 'SHAKY');
CREATE TYPE "AttemptOptimality" AS ENUM ('OPTIMAL', 'SUBOPTIMAL', 'UNKNOWN');
CREATE TYPE "AssistanceType" AS ENUM ('CLARIFICATION', 'CONCEPTUAL_HINT', 'DEBUGGING', 'OPTIMIZATION', 'SOLUTION_REVIEW');
CREATE TYPE "AssistanceSource" AS ENUM ('SELF_REPORTED', 'LEETCODE_SOLUTION');

ALTER TABLE "attempts"
  ADD COLUMN "solution_reviewed_at" TIMESTAMPTZ(3),
  ADD COLUMN "outcome" "AttemptOutcome",
  ADD COLUMN "confidence" "AttemptConfidence",
  ADD COLUMN "optimality" "AttemptOptimality",
  ADD COLUMN "time_spent_seconds" INTEGER CHECK ("time_spent_seconds" >= 0),
  ADD COLUMN "approach" VARCHAR(1000),
  ADD COLUMN "notes" VARCHAR(5000),
  ADD COLUMN "reproduced_from_memory" BOOLEAN;

CREATE TABLE "assistance_events" (
  "id" UUID NOT NULL PRIMARY KEY,
  "attempt_id" UUID NOT NULL REFERENCES "attempts"("id") ON DELETE CASCADE,
  "type" "AssistanceType" NOT NULL,
  "hint_level" SMALLINT,
  "source" "AssistanceSource" NOT NULL,
  "recorded_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK ("hint_level" IS NULL OR ("type" = 'CONCEPTUAL_HINT' AND "hint_level" > 0))
);
CREATE INDEX "assistance_events_attempt_id_idx" ON "assistance_events"("attempt_id");
ALTER TABLE "assistance_events" ENABLE ROW LEVEL SECURITY;
