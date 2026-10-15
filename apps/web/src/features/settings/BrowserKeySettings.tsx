import { useEffect, useRef, useSyncExternalStore } from "react";
import { useAuth } from "../auth/auth";

export function BrowserKeySettings({
  embedded = false,
  section = "all",
  disabled = false,
}: {
  readonly embedded?: boolean;
  readonly section?: "all" | "key" | "storage";
  readonly disabled?: boolean;
}) {
  const { browserKey, state: authState } = useAuth();
  const state = useSyncExternalStore(browserKey.subscribe, browserKey.getSnapshot);
  const input = useRef<HTMLInputElement>(null);
  const pendingSave = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  function cancelPendingSave() {
    clearTimeout(pendingSave.current);
    pendingSave.current = undefined;
  }

  function useKey() {
    cancelPendingSave();
    const value = input.current?.value.trim();
    if (!disabled && value && authState.status === "authenticated") {
      browserKey.save(value);
    }
  }

  useEffect(() => () => clearTimeout(pendingSave.current), []);

  const keyField = (
    <label>
      API key
      <input
        ref={input}
        type="password"
        autoComplete="off"
        spellCheck={false}
        maxLength={4096}
        required
        disabled={disabled}
        onInput={() => {
          cancelPendingSave();
          pendingSave.current = setTimeout(() => useKey(), 600);
        }}
      />
    </label>
  );
  const keyActions = (
    <div className="account-actions">
      {section !== "storage" ? (
        <button type="submit" disabled={disabled}>
          Use key
        </button>
      ) : null}
      <button
        type="button"
        className="secondary-button"
        disabled={disabled}
        onClick={() => {
          cancelPendingSave();
          if (input.current) input.current.value = "";
          browserKey.forget();
        }}
      >
        Forget key
      </button>
    </div>
  );

  return (
    <form
      className={`settings-form key-settings${embedded ? "" : " page-surface"}`}
      onSubmit={(event) => {
        event.preventDefault();
        useKey();
        if (input.current) {
          input.current.value = "";
        }
      }}
    >
      {embedded ? null : <h2>OpenAI API key</h2>}
      {embedded && section !== "storage" ? keyField : null}
      {embedded && section !== "storage" ? keyActions : null}
      {section === "key" ? (
        <p className="settings-help">
          Your key is sent only for provider requests and is never saved on the server.
        </p>
      ) : null}
      {section !== "key" ? (
        <>
          <p className="settings-help">
            Tab-only keys clear on refresh or close. Remembered keys stay in this browser until
            forgotten or signed out.
          </p>
          <p className="settings-notice" id="key-storage-exposure">
            Browser storage is not a secure vault. Browser-profile access or malicious scripts on
            this site could expose a remembered key.
          </p>
          <fieldset aria-describedby="key-storage-exposure">
            <legend>Key storage</legend>
            <label>
              <input
                type="radio"
                name="key-mode"
                checked={state.mode === "tab"}
                disabled={disabled}
                onChange={() => browserKey.setMode("tab")}
              />
              Use for this tab
            </label>
            <label>
              <input
                type="radio"
                name="key-mode"
                checked={state.mode === "remember"}
                disabled={disabled}
                onChange={() => browserKey.setMode("remember")}
              />
              Remember on this browser
            </label>
          </fieldset>
        </>
      ) : null}
      {!embedded && section !== "storage" ? keyField : null}
      <p role="status">{state.hasKey ? "A key is available." : "No key is available."}</p>
      {state.error ? (
        <p className="auth-message" role="alert">
          {state.error}
        </p>
      ) : null}
      {!embedded || section === "storage" ? keyActions : null}
    </form>
  );
}
