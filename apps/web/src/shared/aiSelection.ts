import type {
  ProviderModel,
  ProviderSelection,
  ReasoningEffort,
} from "@practice-plus-plus/contracts";

export const defaultOpenAiModel = "gpt-6-luna";

export function availableOpenAiModel(
  value: string,
  models: readonly ProviderModel[],
): string | undefined {
  return (
    models.find((model) => model.id === value)?.id ??
    models.find((model) => model.id === defaultOpenAiModel)?.id ??
    models[0]?.id
  );
}

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
