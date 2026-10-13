ALTER TABLE "practice_settings"
  DROP CONSTRAINT "practice_settings_daily_target_check",
  ADD CONSTRAINT "practice_settings_daily_target_check" CHECK ("daily_target" BETWEEN 1 AND 20);

ALTER TABLE "daily_plans"
  DROP CONSTRAINT "daily_plans_target_check",
  ADD CONSTRAINT "daily_plans_target_check" CHECK ("target" BETWEEN 1 AND 20);

ALTER TABLE "daily_completions"
  DROP CONSTRAINT "daily_completions_counts_check",
  ADD CONSTRAINT "daily_completions_counts_check"
    CHECK ("required_count" BETWEEN 0 AND 20 AND "completed_count" BETWEEN 0 AND "required_count");
