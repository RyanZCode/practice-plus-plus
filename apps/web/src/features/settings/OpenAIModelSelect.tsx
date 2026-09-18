import { useEffect } from "react";

import { useModelDiscovery } from "./ModelDiscovery";

export function OpenAIModelSelect({
  value,
  disabled,
  onChange,
  label = "OpenAI model",
  help = "Availability depends on your OpenAI API account.",
}: {
  value: string;
  disabled: boolean;
  onChange: (model: string) => void;
  label?: string;
  help?: string;
}) {
  const discovery = useModelDiscovery();
  const canSelect = discovery.status === "ready" || discovery.status === "stale";
  const selectedValue = discovery.models.includes(value) ? value : "";

  useEffect(() => {
    if (canSelect && discovery.models.length > 0 && !discovery.models.includes(value)) {
      onChange(discovery.models[0]!);
    }
  }, [canSelect, discovery.models, onChange, value]);

  return (
    <div className="model-selector">
      <label>
        {label}
        <select
          value={selectedValue}
          required
          disabled={disabled || !canSelect}
          onChange={(event) => onChange(event.target.value)}
        >
          <option value="" disabled>
            {discovery.status === "loading" ? "Discovering models…" : "Select a discovered model"}
          </option>
          {discovery.models.map((model) => (
            <option key={model} value={model}>
              {model}
            </option>
          ))}
        </select>
      </label>
      <p className="settings-help">{help}</p>
      {discovery.status === "idle" ? (
        <p className="settings-help">Add an OpenAI API key to discover models for this account.</p>
      ) : null}
      {discovery.status === "loading" ? (
        <p className="settings-help" role="status">
          Checking models available to this account…
        </p>
      ) : null}
      {discovery.status === "empty" ? (
        <p className="settings-help" role="status">
          No allowlisted GPT models were found for this account.
        </p>
      ) : null}
      {discovery.status === "stale" ? (
        <p className="auth-message" role="status">
          The model list could not be refreshed. Showing the last discovered list.
        </p>
      ) : null}
      {discovery.status === "error" ? (
        <p className="auth-message" role="alert">
          {discovery.error ?? "Model discovery failed. Retry after checking your API key."}
        </p>
      ) : null}
      {discovery.status !== "idle" && discovery.status !== "loading" ? (
        <div className="model-selector-actions">
          <button
            className="secondary-button"
            type="button"
            disabled={disabled}
            onClick={discovery.retry}
          >
            Retry discovery
          </button>
        </div>
      ) : null}
    </div>
  );
}
