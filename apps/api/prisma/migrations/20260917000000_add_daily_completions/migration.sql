CREATE TYPE "DailyCompletionState" AS ENUM ('ACTIVE', 'FULFILLED', 'NEUTRAL');

CREATE TABLE "daily_completions" (
  "user_profile_id" UUID NOT NULL REFERENCES "user_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "practice_date" DATE NOT NULL,
  "required_count" SMALLINT NOT NULL,
  "completed_count" SMALLINT NOT NULL DEFAULT 0,
  "state" "DailyCompletionState" NOT NULL,
  "neutral_reason" VARCHAR(40),
  "fulfilled_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT "daily_completions_pkey" PRIMARY KEY ("user_profile_id", "practice_date"),
  CONSTRAINT "daily_completions_counts_check"
    CHECK ("required_count" BETWEEN 0 AND 10 AND "completed_count" BETWEEN 0 AND "required_count"),
  CONSTRAINT "daily_completions_state_check"
    CHECK (("state" = 'NEUTRAL' AND "required_count" = 0) OR ("state" <> 'NEUTRAL' AND "required_count" > 0)),
  CONSTRAINT "daily_completions_fulfilled_check"
    CHECK ("state" <> 'FULFILLED' OR "completed_count" = "required_count"),
  CONSTRAINT "daily_completions_neutral_reason_check"
    CHECK ("state" <> 'NEUTRAL' OR "neutral_reason" IS NULL OR "neutral_reason" IN ('NO_PRACTICE_AVAILABLE', 'BOUNDARY_CHANGE'))
);

CREATE INDEX "daily_completions_user_profile_id_practice_date_idx"
  ON "daily_completions"("user_profile_id", "practice_date");

ALTER TABLE "daily_completions" ENABLE ROW LEVEL SECURITY;
