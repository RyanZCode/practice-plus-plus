import { describe, expect, it } from "vitest";
import type { ProviderModel } from "@practice-plus-plus/contracts";

import { availableOpenAiModel, openAiSelection } from "./aiSelection";

const models: ProviderModel[] = [
  { id: "reasoning-model", reasoningEfforts: ["low", "medium", "high"] },
  { id: "regular-model", reasoningEfforts: [] },
];

describe("AI selection", () => {
  it("prefers gpt-6-luna when a selection is missing from discovered models", () => {
    expect(
      availableOpenAiModel("unavailable-model", [
        { id: "gpt-4.1", reasoningEfforts: [] },
        { id: "gpt-6-luna", reasoningEfforts: ["high"] },
      ]),
    ).toBe("gpt-6-luna");
  });

  it("preserves an available saved selection ahead of the preferred default", () => {
    expect(
      availableOpenAiModel("gpt-4.1", [
        { id: "gpt-6-luna", reasoningEfforts: ["high"] },
        { id: "gpt-4.1", reasoningEfforts: [] },
      ]),
    ).toBe("gpt-4.1");
  });

  it("uses the first discovered model when gpt-6-luna is unavailable", () => {
    expect(availableOpenAiModel("gpt-6-luna", models)).toBe("reasoning-model");
  });

  it("does not select a model without discovered results", () => {
    expect(availableOpenAiModel("gpt-6-luna", [])).toBeUndefined();
  });

  it("includes a supported saved effort", () => {
    expect(openAiSelection("reasoning-model", models, "high")).toEqual({
      providerId: "openai",
      model: "reasoning-model",
      reasoningEffort: "high",
    });
  });

  it("omits unsupported and unset efforts", () => {
    expect(openAiSelection("regular-model", models, "high")).toEqual({
      providerId: "openai",
      model: "regular-model",
    });
    expect(openAiSelection("reasoning-model", models, null)).toEqual({
      providerId: "openai",
      model: "reasoning-model",
    });
  });
});
