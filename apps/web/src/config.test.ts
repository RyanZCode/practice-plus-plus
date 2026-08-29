import { describe, expect, it } from "vitest";

import { validateConfig } from "./config";

describe("validateConfig", () => {
  it("accepts an HTTP API URL", () => {
    expect(() =>
      validateConfig({ DEV: false, VITE_API_URL: "https://api.example.com" }),
    ).not.toThrow();
  });

  it("uses the local API during development", () => {
    expect(() => validateConfig({ DEV: true })).not.toThrow();
  });

  it("rejects missing or invalid production configuration", () => {
    expect(() => validateConfig({ DEV: false })).toThrow("VITE_API_URL is required");
    expect(() => validateConfig({ DEV: false, VITE_API_URL: "localhost" })).toThrow(
      "VITE_API_URL must be a valid URL",
    );
  });
});
