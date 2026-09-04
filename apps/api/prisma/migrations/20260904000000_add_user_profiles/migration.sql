CREATE SCHEMA IF NOT EXISTS "public";

CREATE TABLE "user_profiles" (
    "id" UUID NOT NULL,
    "auth_subject" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "user_profiles_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "user_profiles_auth_subject_key" ON "user_profiles"("auth_subject");
