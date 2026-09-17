import { openAiModels } from "@practice-plus-plus/contracts";

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
  return (
    <div>
      <label>
        {label}
        <select
          value={value}
          required
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
        >
          <option value="" disabled>
            Select a model
          </option>
          {openAiModels.map((model) => (
            <option key={model} value={model}>
              {model}
            </option>
          ))}
        </select>
      </label>
      <p className="settings-help">{help}</p>
    </div>
  );
}
