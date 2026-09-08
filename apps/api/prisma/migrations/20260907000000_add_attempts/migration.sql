CREATE TYPE "AttemptType" AS ENUM ('FRESH', 'REDO');

CREATE TABLE "attempts" (
    "id" UUID NOT NULL,
    "user_profile_id" UUID NOT NULL,
    "problem_id" UUID NOT NULL,
    "type" "AttemptType" NOT NULL,
    "practice_date" DATE NOT NULL,
    "started_at" TIMESTAMPTZ(3) NOT NULL,
    "timer_skipped_at" TIMESTAMPTZ(3),
    "confirmed_at" TIMESTAMPTZ(3),
    CONSTRAINT "attempts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "attempts_one_active_per_user" ON "attempts"("user_profile_id") WHERE "confirmed_at" IS NULL;
CREATE INDEX "attempts_user_profile_id_problem_id_idx" ON "attempts"("user_profile_id", "problem_id");
CREATE INDEX "attempts_problem_id_idx" ON "attempts"("problem_id");
ALTER TABLE "attempts" ADD CONSTRAINT "attempts_user_profile_id_fkey" FOREIGN KEY ("user_profile_id") REFERENCES "user_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "attempts" ADD CONSTRAINT "attempts_problem_id_fkey" FOREIGN KEY ("problem_id") REFERENCES "problems"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
