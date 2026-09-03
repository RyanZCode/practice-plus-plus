import { describe, expect, it } from "vitest";

import { readConfig } from "./config.js";

const validEnvironment = {
  SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
  SUPABASE_URL: "https://project.supabase.co",
};

describe("readConfig", () => {
  it("reads the Supabase settings and default port", () => {
    expect(readConfig(validEnvironment)).toEqual({
      port: 3000,
      supabasePublishableKey: "sb_publishable_test",
      supabaseUrl: "https://project.supabase.co",
    });
  });

  it("accepts local Supabase and a configured port", () => {
    expect(
      readConfig({
        PORT: "4000",
        SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
        SUPABASE_URL: "http://127.0.0.1:54321",
      }),
    ).toMatchObject({ port: 4000, supabaseUrl: "http://127.0.0.1:54321" });
  });

  it("rejects missing Supabase settings", () => {
    expect(() => readConfig({})).toThrow("SUPABASE_PUBLISHABLE_KEY is required");
    expect(() => readConfig({ SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test" })).toThrow(
      "SUPABASE_URL is required",
    );
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
  });
});
