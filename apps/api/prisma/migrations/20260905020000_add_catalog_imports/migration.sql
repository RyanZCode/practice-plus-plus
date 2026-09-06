CREATE TYPE "CatalogImportSource" AS ENUM ('CURATED', 'LLM_GENERATED');

CREATE TYPE "CatalogReviewStatus" AS ENUM ('DRAFT', 'APPROVED', 'REJECTED');

CREATE TABLE "catalog_import_batches" (
    "id" UUID NOT NULL,
    "format_version" SMALLINT NOT NULL,
    "source_kind" "CatalogImportSource" NOT NULL,
    "source_name" VARCHAR(255) NOT NULL,
    "created_by_user_profile_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "catalog_import_batches_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "catalog_import_batches_format_version_check" CHECK ("format_version" = 1)
);

ALTER TABLE "problems"
ADD COLUMN "review_status" "CatalogReviewStatus",
ADD COLUMN "import_batch_id" UUID;

UPDATE "problems"
SET "review_status" = CASE
    WHEN "published" THEN 'APPROVED'::"CatalogReviewStatus"
    ELSE 'DRAFT'::"CatalogReviewStatus"
END;

ALTER TABLE "problems"
ALTER COLUMN "review_status" SET DEFAULT 'DRAFT',
ALTER COLUMN "review_status" SET NOT NULL,
ADD CONSTRAINT "problems_publication_review_status_check"
CHECK (NOT "published" OR "review_status" = 'APPROVED');

CREATE INDEX "catalog_import_batches_created_by_user_profile_id_idx"
ON "catalog_import_batches"("created_by_user_profile_id");

CREATE INDEX "problems_import_batch_id_idx" ON "problems"("import_batch_id");

ALTER TABLE "catalog_import_batches"
ADD CONSTRAINT "catalog_import_batches_created_by_user_profile_id_fkey"
FOREIGN KEY ("created_by_user_profile_id") REFERENCES "user_profiles"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "problems"
ADD CONSTRAINT "problems_import_batch_id_fkey"
FOREIGN KEY ("import_batch_id") REFERENCES "catalog_import_batches"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

INSERT INTO "patterns" ("id", "name", "created_at", "updated_at")
VALUES
    ('22d2e255-9fd2-4d9e-a663-b2a1ebc2393f', 'Arrays & Hashing', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('27b584a1-e205-4809-880f-cf85a9d0ec51', 'Two Pointers', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('c58e1791-f33c-43bc-85bb-358c99280055', 'Sliding Window', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('0f026ccd-6775-4346-92fa-76028430be21', 'Stack', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('281ed0ee-9864-4469-9505-9db8937ccd8f', 'Binary Search', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('0775fd41-a672-4f74-925c-62a2abfd4b77', 'Linked List', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('a240c52f-59c9-4bb6-b02c-44ea3e2f89d5', 'Trees', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('61f05a95-4e86-41ff-886b-8fb09e1e2566', 'Heap / Priority Queue', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('536452d2-2279-4bb3-8de6-ec9cf85c5348', 'Backtracking', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('4a6e59c8-e73a-45d2-846c-3509a75bc70d', 'Tries', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('3f92d986-81e0-4497-b4f8-94ba2b37508c', 'Graphs', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('65ab263e-eae6-45fc-9b4d-8db1998253de', 'Dynamic Programming', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('a59f69f8-f80d-4e95-bbbe-37798b900d44', 'Greedy', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('8cf8a570-c913-442d-9a9c-81724c9b5e38', 'Intervals', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('9ca74f50-1228-4609-9c9b-b9c4c9036ae4', 'Math', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('34caf21a-6263-47ff-9bb9-62c42c91bc5b', 'Bit Manipulation', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("name") DO NOTHING;
