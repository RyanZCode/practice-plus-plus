import { describe, expect, it } from "vitest";
import type { ProviderModel } from "@practice-plus-plus/contracts";

import { openAiSelection } from "./aiSelection";

const models: ProviderModel[] = [
  { id: "reasoning-model", reasoningEfforts: ["low", "medium", "high"] },
  { id: "regular-model", reasoningEfforts: [] },
];

describe("AI selection", () => {
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
