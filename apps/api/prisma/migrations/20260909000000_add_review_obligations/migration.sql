CREATE TYPE "ReviewUrgency" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

CREATE TABLE "review_obligations" (
  "source_attempt_id" UUID NOT NULL PRIMARY KEY REFERENCES "attempts"("id") ON DELETE CASCADE,
  "urgency" "ReviewUrgency" NOT NULL,
  "generated_due_date" DATE NOT NULL,
  "manual_due_date" DATE
);

ALTER TABLE "review_obligations" ENABLE ROW LEVEL SECURITY;
