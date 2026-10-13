import { reasoningEffortSchema, type ReasoningEffort } from "@practice-plus-plus/contracts";
import { useEffect } from "react";

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
  const selectedValue =
    value !== null && efforts.includes(value) ? value : efforts.includes("medium") ? "medium" : "";

  useEffect(() => {
    if (selectedValue !== "" && selectedValue !== value) {
      onChange(selectedValue);
    }
  }, [onChange, selectedValue, value]);

  return (
    <label>
      Reasoning effort
      <select
        value={selectedValue}
        disabled={disabled || efforts.length === 0}
        onChange={(event) => {
          const parsed = reasoningEffortSchema.safeParse(event.target.value);
          if (parsed.success) onChange(parsed.data);
        }}
      >
        {efforts.length === 0 ? (
          <option value="">{capabilities ? "Not supported" : "Select a model first"}</option>
        ) : null}
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
      ) : null}
    </label>
  );
}
