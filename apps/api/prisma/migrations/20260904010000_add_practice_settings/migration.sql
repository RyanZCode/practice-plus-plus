CREATE TABLE "practice_settings" (
    "user_profile_id" UUID NOT NULL,
    "time_zone" VARCHAR(100) NOT NULL,
    "reset_minutes" SMALLINT NOT NULL,
    "daily_target" SMALLINT NOT NULL,
    "high_interval_days" SMALLINT NOT NULL,
    "medium_interval_days" SMALLINT NOT NULL,
    "low_interval_days" SMALLINT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "practice_settings_pkey" PRIMARY KEY ("user_profile_id"),
    CONSTRAINT "practice_settings_reset_minutes_check" CHECK ("reset_minutes" BETWEEN 0 AND 1439),
    CONSTRAINT "practice_settings_daily_target_check" CHECK ("daily_target" BETWEEN 1 AND 10),
    CONSTRAINT "practice_settings_high_interval_days_check" CHECK ("high_interval_days" BETWEEN 1 AND 90),
    CONSTRAINT "practice_settings_medium_interval_days_check" CHECK ("medium_interval_days" BETWEEN 1 AND 90),
    CONSTRAINT "practice_settings_low_interval_days_check" CHECK ("low_interval_days" BETWEEN 1 AND 90),
    CONSTRAINT "practice_settings_interval_order_check" CHECK (
        "high_interval_days" <= "medium_interval_days"
        AND "medium_interval_days" <= "low_interval_days"
    )
);

ALTER TABLE "practice_settings"
ADD CONSTRAINT "practice_settings_user_profile_id_fkey"
FOREIGN KEY ("user_profile_id") REFERENCES "user_profiles"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
