ALTER TABLE "practice_settings"
ADD COLUMN "allow_premium_problems" BOOLEAN NOT NULL DEFAULT true;

UPDATE "practice_settings" AS settings
SET "allow_premium_problems" = NOT profiles."hide_paid_problems"
FROM "user_profiles" AS profiles
WHERE profiles."id" = settings."user_profile_id";

ALTER TABLE "user_profiles"
DROP COLUMN "hide_paid_problems";
