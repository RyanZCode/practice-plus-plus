import { describe, expect, it } from "vitest";

import { providerSelectionSchema } from "./index.js";

describe("provider selection", () => {
  it("accepts a configurable model and trims surrounding whitespace", () => {
    expect(
      providerSelectionSchema.parse({ providerId: "openai", model: " custom-model:v2 " }),
    ).toEqual({ providerId: "openai", model: "custom-model:v2" });
  });

  it.each([
    { providerId: "https://api.openai.com", model: "model" },
    { providerId: "other", model: "model" },
    { providerId: "__proto__", model: "model" },
    { providerId: "openai", model: "model", baseUrl: "https://example.com" },
    { providerId: "openai", model: "model", headers: { authorization: "secret" } },
    { providerId: "openai", model: "" },
    { providerId: "openai", model: "a".repeat(201) },
    { providerId: "openai", model: "model\r\ninjected" },
  ])("rejects invalid selections and extra configuration: %j", (selection) => {
    expect(providerSelectionSchema.safeParse(selection).success).toBe(false);
  });
});
