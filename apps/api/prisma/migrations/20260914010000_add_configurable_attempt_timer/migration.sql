ALTER TABLE "practice_settings"
ADD COLUMN "attempt_timer_minutes" SMALLINT NOT NULL DEFAULT 30,
ADD CONSTRAINT "practice_settings_attempt_timer_minutes_check"
CHECK ("attempt_timer_minutes" BETWEEN 1 AND 180);

ALTER TABLE "attempts"
ADD COLUMN "timer_ends_at" TIMESTAMPTZ(3),
ADD COLUMN "timer_paused_at" TIMESTAMPTZ(3);

UPDATE "attempts"
SET "timer_ends_at" = "started_at" + INTERVAL '30 minutes';

ALTER TABLE "attempts"
ALTER COLUMN "timer_ends_at" SET NOT NULL,
ADD CONSTRAINT "attempts_timer_pause_check"
CHECK ("timer_paused_at" IS NULL OR "timer_skipped_at" IS NULL);
