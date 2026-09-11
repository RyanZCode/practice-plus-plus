import { useRef, useSyncExternalStore } from "react";
import { useAuth } from "./auth";

export function BrowserKeySettings() {
  const { browserKey } = useAuth();
  const state = useSyncExternalStore(browserKey.subscribe, browserKey.getSnapshot);
  const input = useRef<HTMLInputElement>(null);

  return (
    <form
      className="settings-form key-settings"
      onSubmit={(event) => {
        event.preventDefault();
        if (input.current) {
          browserKey.save(input.current.value);
          input.current.value = "";
        }
      }}
    >
      <h2>OpenAI API key</h2>
      <p className="settings-help">
        Use for this tab keeps the key in memory. Refreshing or closing the tab clears it.
        Remembered keys survive refreshes and browser restarts while you remain signed in. Signing
        out clears the key.
      </p>
      <p className="settings-help" id="key-storage-exposure">
        Remembering uses localStorage, which is not a secure credential vault. Anyone with access to
        your browser profile, or malicious JavaScript running on this site's origin, could access
        the key.
      </p>
      <fieldset aria-describedby="key-storage-exposure">
        <legend>Key storage</legend>
        <label>
          <input
            type="radio"
            name="key-mode"
            checked={state.mode === "tab"}
            onChange={() => browserKey.setMode("tab")}
          />
          Use for this tab
        </label>
        <label>
          <input
            type="radio"
            name="key-mode"
            checked={state.mode === "remember"}
            onChange={() => browserKey.setMode("remember")}
          />
          Remember on this browser
        </label>
      </fieldset>
      <label>
        API key
        <input
          ref={input}
          type="password"
          autoComplete="off"
          spellCheck={false}
          maxLength={4096}
          required
        />
      </label>
      <p role="status">{state.hasKey ? "A key is available." : "No key is available."}</p>
      {state.error ? (
        <p className="auth-message" role="alert">
          {state.error}
        </p>
      ) : null}
      <button type="submit">Use key</button>
      <button
        type="button"
        className="secondary-button"
        onClick={() => {
          if (input.current) input.current.value = "";
          browserKey.forget();
        }}
      >
        Forget key
      </button>
    </form>
  );
}
