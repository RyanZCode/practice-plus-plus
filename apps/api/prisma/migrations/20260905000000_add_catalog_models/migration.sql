CREATE TYPE "ProblemDifficulty" AS ENUM ('EASY', 'MEDIUM', 'HARD');

CREATE TYPE "ProblemAvailability" AS ENUM ('AVAILABLE', 'PAID_ONLY', 'UNAVAILABLE');

CREATE TABLE "problems" (
    "id" UUID NOT NULL,
    "leetcode_id" INTEGER NOT NULL,
    "slug" VARCHAR(255) NOT NULL,
    "title" VARCHAR(255) NOT NULL,
    "difficulty" "ProblemDifficulty" NOT NULL,
    "url" VARCHAR(500) NOT NULL,
    "availability" "ProblemAvailability" NOT NULL DEFAULT 'AVAILABLE',
    "published" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "problems_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "problems_leetcode_id_check" CHECK ("leetcode_id" > 0)
);

CREATE TABLE "patterns" (
    "id" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "patterns_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "pattern_aliases" (
    "id" UUID NOT NULL,
    "pattern_id" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,

    CONSTRAINT "pattern_aliases_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "problem_patterns" (
    "problem_id" UUID NOT NULL,
    "pattern_id" UUID NOT NULL,

    CONSTRAINT "problem_patterns_pkey" PRIMARY KEY ("problem_id", "pattern_id")
);

CREATE UNIQUE INDEX "problems_leetcode_id_key" ON "problems"("leetcode_id");
CREATE UNIQUE INDEX "problems_slug_key" ON "problems"("slug");
CREATE UNIQUE INDEX "patterns_name_key" ON "patterns"("name");
CREATE UNIQUE INDEX "pattern_aliases_name_key" ON "pattern_aliases"("name");
CREATE INDEX "pattern_aliases_pattern_id_idx" ON "pattern_aliases"("pattern_id");
CREATE INDEX "problem_patterns_pattern_id_idx" ON "problem_patterns"("pattern_id");

ALTER TABLE "pattern_aliases"
ADD CONSTRAINT "pattern_aliases_pattern_id_fkey"
FOREIGN KEY ("pattern_id") REFERENCES "patterns"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "problem_patterns"
ADD CONSTRAINT "problem_patterns_problem_id_fkey"
FOREIGN KEY ("problem_id") REFERENCES "problems"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "problem_patterns"
ADD CONSTRAINT "problem_patterns_pattern_id_fkey"
FOREIGN KEY ("pattern_id") REFERENCES "patterns"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
