import { describe, expect, it } from "vitest";

import { readConfig } from "./config";

describe("readConfig", () => {
  it("accepts an HTTP API URL", () => {
    expect(
      readConfig({
        DEV: false,
        VITE_API_URL: "https://api.example.com",
        VITE_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
        VITE_SUPABASE_URL: "https://project.supabase.co",
      }),
    ).toEqual({
      apiUrl: "https://api.example.com",
      supabasePublishableKey: "sb_publishable_test",
      supabaseUrl: "https://project.supabase.co",
    });
  });

  it("uses the local API during development", () => {
    expect(
      readConfig({
        DEV: true,
        VITE_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
        VITE_SUPABASE_URL: "http://127.0.0.1:54321",
      }),
    ).toMatchObject({ apiUrl: "http://localhost:3000" });
  });

  it("rejects missing or invalid API configuration", () => {
    expect(() => readConfig({ DEV: false })).toThrow("VITE_API_URL is required");
    expect(() =>
      readConfig({
        DEV: false,
        VITE_API_URL: "localhost",
        VITE_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
        VITE_SUPABASE_URL: "https://project.supabase.co",
      }),
    ).toThrow("VITE_API_URL must be a valid URL");
  });

  it("rejects missing or invalid Supabase configuration", () => {
    expect(() => readConfig({ DEV: true })).toThrow("VITE_SUPABASE_PUBLISHABLE_KEY is required");
    expect(() =>
      readConfig({
        DEV: true,
        VITE_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
        VITE_SUPABASE_URL: "project.supabase.co",
      }),
    ).toThrow("VITE_SUPABASE_URL must be a valid URL");
    expect(() =>
      readConfig({
        DEV: true,
        VITE_SUPABASE_URL: "https://project.supabase.co",
      }),
    ).toThrow("VITE_SUPABASE_PUBLISHABLE_KEY is required");
    expect(() =>
      readConfig({
        DEV: true,
        VITE_SUPABASE_PUBLISHABLE_KEY: "sb_secret_test",
        VITE_SUPABASE_URL: "https://project.supabase.co",
      }),
    ).toThrow("VITE_SUPABASE_PUBLISHABLE_KEY must be a Supabase publishable key");
  });
});
