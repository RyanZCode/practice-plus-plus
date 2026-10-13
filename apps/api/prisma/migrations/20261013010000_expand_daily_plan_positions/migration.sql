ALTER TABLE "daily_plan_items"
  DROP CONSTRAINT "daily_plan_items_position_check",
  ADD CONSTRAINT "daily_plan_items_position_check" CHECK ("position" BETWEEN 0 AND 19);
