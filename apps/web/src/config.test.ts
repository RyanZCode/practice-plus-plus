import { describe, expect, it } from "vitest";

import { validateConfig } from "./config";

describe("validateConfig", () => {
  it("accepts an HTTP API URL", () => {
    expect(() =>
      validateConfig({
        DEV: false,
        VITE_API_URL: "https://api.example.com",
        VITE_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
        VITE_SUPABASE_URL: "https://project.supabase.co",
      }),
    ).not.toThrow();
  });

  it("uses the local API during development", () => {
    expect(() =>
      validateConfig({
        DEV: true,
        VITE_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
        VITE_SUPABASE_URL: "http://127.0.0.1:54321",
      }),
    ).not.toThrow();
  });

  it("rejects missing or invalid API configuration", () => {
    expect(() => validateConfig({ DEV: false })).toThrow("VITE_API_URL is required");
    expect(() =>
      validateConfig({
        DEV: false,
        VITE_API_URL: "localhost",
        VITE_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
        VITE_SUPABASE_URL: "https://project.supabase.co",
      }),
    ).toThrow("VITE_API_URL must be a valid URL");
  });

  it("rejects missing or invalid Supabase configuration", () => {
    expect(() => validateConfig({ DEV: true })).toThrow("VITE_SUPABASE_URL is required");
    expect(() =>
      validateConfig({
        DEV: true,
        VITE_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
        VITE_SUPABASE_URL: "project.supabase.co",
      }),
    ).toThrow("VITE_SUPABASE_URL must be a valid URL");
    expect(() =>
      validateConfig({
        DEV: true,
        VITE_SUPABASE_URL: "https://project.supabase.co",
      }),
    ).toThrow("VITE_SUPABASE_PUBLISHABLE_KEY is required");
    expect(() =>
      validateConfig({
        DEV: true,
        VITE_SUPABASE_PUBLISHABLE_KEY: "sb_secret_test",
        VITE_SUPABASE_URL: "https://project.supabase.co",
      }),
    ).toThrow("VITE_SUPABASE_PUBLISHABLE_KEY must be a Supabase publishable key");
  });
});
