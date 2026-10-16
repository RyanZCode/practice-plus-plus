ALTER TABLE "daily_completions"
  DROP CONSTRAINT "daily_completions_counts_check",
  ADD CONSTRAINT "daily_completions_counts_check"
    CHECK ("required_count" BETWEEN 0 AND 20 AND "completed_count" >= 0),
  DROP CONSTRAINT "daily_completions_fulfilled_check",
  ADD CONSTRAINT "daily_completions_fulfilled_check"
    CHECK ("state" <> 'FULFILLED' OR "completed_count" >= "required_count");
