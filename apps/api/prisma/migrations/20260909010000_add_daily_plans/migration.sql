ALTER TABLE "review_obligations" ADD COLUMN "resolved_at" TIMESTAMPTZ(3);

UPDATE "review_obligations" AS review
SET "resolved_at" = (
  SELECT MIN(later.confirmed_at)
  FROM "attempts" AS source
  JOIN "attempts" AS later ON later.user_profile_id = source.user_profile_id
    AND later.problem_id = source.problem_id AND later.started_at > source.started_at
  WHERE source.id = review.source_attempt_id AND later.confirmed_at IS NOT NULL
);

CREATE TABLE "transfer_obligations" (
  "id" UUID NOT NULL PRIMARY KEY,
  "source_attempt_id" UUID NOT NULL REFERENCES "attempts"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "pattern_id" UUID NOT NULL REFERENCES "patterns"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "generated_eligible_date" DATE NOT NULL,
  "manual_eligible_date" DATE,
  "attempt_id" UUID REFERENCES "attempts"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  "resolved_at" TIMESTAMPTZ(3)
);
CREATE UNIQUE INDEX "transfer_obligations_attempt_id_key" ON "transfer_obligations"("attempt_id");
CREATE INDEX "transfer_obligations_source_attempt_id_idx" ON "transfer_obligations"("source_attempt_id");
CREATE INDEX "transfer_obligations_pattern_id_idx" ON "transfer_obligations"("pattern_id");

CREATE TABLE "daily_plans" (
  "user_profile_id" UUID NOT NULL PRIMARY KEY REFERENCES "user_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "practice_date" DATE NOT NULL,
  "target" SMALLINT NOT NULL CHECK ("target" BETWEEN 1 AND 10),
  "time_zone" VARCHAR(100) NOT NULL,
  "reset_minutes" SMALLINT NOT NULL CHECK ("reset_minutes" BETWEEN 0 AND 1439)
);

CREATE TABLE "daily_plan_items" (
  "id" UUID NOT NULL PRIMARY KEY,
  "user_profile_id" UUID NOT NULL REFERENCES "daily_plans"("user_profile_id") ON DELETE CASCADE ON UPDATE CASCADE,
  "position" SMALLINT NOT NULL CHECK ("position" BETWEEN 0 AND 9),
  "problem_id" UUID NOT NULL REFERENCES "problems"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "kind" VARCHAR(20) NOT NULL CHECK ("kind" IN ('DIAGNOSTIC', 'FRESH', 'REDO', 'TRANSFER')),
  "reason" VARCHAR(30) NOT NULL CHECK ("reason" IN ('FRESH_DIAGNOSTIC', 'FRESH_PRACTICE', 'OVERDUE_REVIEW', 'REVIEW_DUE', 'TRANSFER_DUE')),
  "attempt_id" UUID REFERENCES "attempts"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  "transfer_id" UUID REFERENCES "transfer_obligations"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "daily_plan_items_user_profile_id_position_key" ON "daily_plan_items"("user_profile_id", "position");
CREATE UNIQUE INDEX "daily_plan_items_user_profile_id_problem_id_key" ON "daily_plan_items"("user_profile_id", "problem_id");
CREATE INDEX "daily_plan_items_problem_id_idx" ON "daily_plan_items"("problem_id");
CREATE INDEX "daily_plan_items_attempt_id_idx" ON "daily_plan_items"("attempt_id");
CREATE INDEX "daily_plan_items_transfer_id_idx" ON "daily_plan_items"("transfer_id");

ALTER TABLE "daily_plans" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "daily_plan_items" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "transfer_obligations" ENABLE ROW LEVEL SECURITY;
