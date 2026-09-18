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
  const selectedValue = discovery.models.some((model) => model.id === value) ? value : "";

  useEffect(() => {
    if (
      canSelect &&
      discovery.models.length > 0 &&
      !discovery.models.some((model) => model.id === value)
    ) {
      onChange(discovery.models[0]!.id);
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
            <option key={model.id} value={model.id}>
              {model.id}
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
          {discovery.error ?? "Model discovery failed. Check your API key and try again."}
        </p>
      ) : null}
      {discovery.status === "stale" || discovery.status === "error" ? (
        <div className="model-selector-actions">
          <button
            className="secondary-button"
            type="button"
            disabled={disabled}
            onClick={discovery.retry}
          >
            Try again
          </button>
        </div>
      ) : null}
    </div>
  );
}
