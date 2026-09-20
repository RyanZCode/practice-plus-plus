import { reasoningEffortSchema, type ReasoningEffort } from "@practice-plus-plus/contracts";

import { useModelDiscovery } from "./ModelDiscovery";

export function ReasoningEffortSelect({
  model,
  value,
  disabled,
  onChange,
}: {
  model: string;
  value: ReasoningEffort | null;
  disabled: boolean;
  onChange: (effort: ReasoningEffort | null) => void;
}) {
  const discovery = useModelDiscovery();
  const capabilities = discovery.models.find((candidate) => candidate.id === model);
  const efforts = capabilities?.reasoningEfforts ?? [];
  const selectedValue = value !== null && efforts.includes(value) ? value : "";

  return (
    <label>
      Reasoning effort
      <select
        value={selectedValue}
        disabled={disabled || efforts.length === 0}
        onChange={(event) => {
          if (event.target.value === "") {
            onChange(null);
            return;
          }
          const parsed = reasoningEffortSchema.safeParse(event.target.value);
          if (parsed.success) onChange(parsed.data);
        }}
      >
        <option value="">Use provider default</option>
        {efforts.map((effort) => (
          <option key={effort} value={effort}>
            {effort === "xhigh" ? "X-high" : effort.charAt(0).toUpperCase() + effort.slice(1)}
          </option>
        ))}
      </select>
      {efforts.length === 0 ? (
        <span className="settings-help">
          Discover a model that supports reasoning effort to configure this setting.
        </span>
      ) : value !== null && !efforts.includes(value) ? (
        <span className="settings-help">
          This model does not support the saved effort. Requests use the provider default, and the
          saved setting is unchanged.
        </span>
      ) : null}
    </label>
  );
}
