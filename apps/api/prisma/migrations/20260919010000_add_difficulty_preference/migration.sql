CREATE TYPE "ProblemDifficultyPreference" AS ENUM ('ANY', 'EASIER', 'MEDIUM_ONLY');

ALTER TABLE "practice_settings"
ADD COLUMN "difficulty_preference" "ProblemDifficultyPreference" NOT NULL DEFAULT 'ANY';
