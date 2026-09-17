import { describe, expect, it } from "vitest";

import { readConfig } from "./config.js";

const validEnvironment = {
  DATABASE_URL: "postgresql://postgres:password@localhost:5432/practice_plus_plus",
  SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
  SUPABASE_URL: "https://project.supabase.co",
};

describe("readConfig", () => {
  it("reads the Supabase settings and default port", () => {
    expect(readConfig(validEnvironment)).toEqual({
      databaseUrl: "postgresql://postgres:password@localhost:5432/practice_plus_plus",
      port: 3000,
      supabasePublishableKey: "sb_publishable_test",
      supabaseUrl: "https://project.supabase.co",
      webOrigin: "http://localhost:5173",
    });
  });

  it("accepts local Supabase and a configured port", () => {
    expect(
      readConfig({
        ...validEnvironment,
        PORT: "4000",
        SUPABASE_URL: "http://127.0.0.1:54321",
      }),
    ).toMatchObject({ port: 4000, supabaseUrl: "http://127.0.0.1:54321" });
  });

  it("rejects missing Supabase settings", () => {
    expect(() => readConfig({ DATABASE_URL: validEnvironment.DATABASE_URL })).toThrow(
      "SUPABASE_PUBLISHABLE_KEY is required",
    );
    expect(() =>
      readConfig({
        DATABASE_URL: validEnvironment.DATABASE_URL,
        SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
      }),
    ).toThrow("SUPABASE_URL is required");
  });

  it("rejects invalid URLs and ports", () => {
    expect(() => readConfig({ ...validEnvironment, SUPABASE_URL: "project.supabase.co" })).toThrow(
      "SUPABASE_URL must be a valid URL",
    );
    expect(() => readConfig({ ...validEnvironment, PORT: "0" })).toThrow(
      "PORT must be an integer between 1 and 65535",
    );
    expect(() =>
      readConfig({ ...validEnvironment, SUPABASE_PUBLISHABLE_KEY: "sb_secret_test" }),
    ).toThrow("SUPABASE_PUBLISHABLE_KEY must be a Supabase publishable key");
    expect(() => readConfig({ ...validEnvironment, DATABASE_URL: "https://example.com" })).toThrow(
      "DATABASE_URL must be a valid PostgreSQL URL",
    );
    expect(() => readConfig({ ...validEnvironment, WEB_ORIGIN: "not a url" })).toThrow(
      "WEB_ORIGIN must be a valid URL",
    );
  });

  it("requires a database URL", () => {
    expect(() =>
      readConfig({
        SUPABASE_PUBLISHABLE_KEY: validEnvironment.SUPABASE_PUBLISHABLE_KEY,
        SUPABASE_URL: validEnvironment.SUPABASE_URL,
      }),
    ).toThrow("DATABASE_URL is required");
  });
});
