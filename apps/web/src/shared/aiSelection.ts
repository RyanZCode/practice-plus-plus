import type {
  ProviderModel,
  ProviderSelection,
  ReasoningEffort,
} from "@practice-plus-plus/contracts";

export function openAiSelection(
  model: string,
  models: readonly ProviderModel[],
  reasoningEffort: ReasoningEffort | null,
): ProviderSelection {
  const capabilities = models.find((candidate) => candidate.id === model);
  const supported =
    reasoningEffort !== null && capabilities?.reasoningEfforts.includes(reasoningEffort) === true;

  return {
    providerId: "openai",
    model,
    ...(supported ? { reasoningEffort } : {}),
  };
}
