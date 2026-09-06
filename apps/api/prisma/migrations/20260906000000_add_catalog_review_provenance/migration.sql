ALTER TABLE "problems"
ADD COLUMN "reviewed_by_user_profile_id" UUID,
ADD COLUMN "reviewed_at" TIMESTAMPTZ(3),
ADD COLUMN "published_by_user_profile_id" UUID,
ADD COLUMN "published_at" TIMESTAMPTZ(3);

CREATE INDEX "problems_reviewed_by_user_profile_id_idx"
ON "problems"("reviewed_by_user_profile_id");

CREATE INDEX "problems_published_by_user_profile_id_idx"
ON "problems"("published_by_user_profile_id");

ALTER TABLE "problems"
ADD CONSTRAINT "problems_reviewed_by_user_profile_id_fkey"
FOREIGN KEY ("reviewed_by_user_profile_id") REFERENCES "user_profiles"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "problems"
ADD CONSTRAINT "problems_published_by_user_profile_id_fkey"
FOREIGN KEY ("published_by_user_profile_id") REFERENCES "user_profiles"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "problems"
ADD CONSTRAINT "problems_review_provenance_check"
CHECK (
    ("review_status" = 'DRAFT' AND "reviewed_by_user_profile_id" IS NULL AND "reviewed_at" IS NULL)
    OR
    ("review_status" <> 'DRAFT' AND "reviewed_by_user_profile_id" IS NOT NULL AND "reviewed_at" IS NOT NULL)
    OR
    ("review_status" = 'APPROVED' AND "published" AND "reviewed_by_user_profile_id" IS NULL AND "reviewed_at" IS NULL)
);

ALTER TABLE "problems"
ADD CONSTRAINT "problems_publication_provenance_check"
CHECK (
    (NOT "published" AND "published_by_user_profile_id" IS NULL AND "published_at" IS NULL)
    OR
    ("published" AND "review_status" = 'APPROVED'
        AND (
            ("published_by_user_profile_id" IS NOT NULL AND "published_at" IS NOT NULL)
            OR
            ("published_by_user_profile_id" IS NULL AND "published_at" IS NULL)
        ))
);
