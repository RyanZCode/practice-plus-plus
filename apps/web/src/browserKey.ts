export const browserKeyStorageKey = "practice-plus-plus.openai-key";

type KeyMode = "tab" | "remember";
interface KeyState {
  readonly mode: KeyMode;
  readonly hasKey: boolean;
  readonly error?: string;
}

export function createBrowserKeyStore(storage: () => Storage) {
  let userId: string | null = null;
  let key = "";
  let state: KeyState = { mode: "tab", hasKey: false };
  const listeners = new Set<() => void>();

  function publish(mode: KeyMode, error?: string) {
    state = { mode, hasKey: key !== "", ...(error ? { error } : {}) };
    listeners.forEach((listener) => listener());
  }

  function remove(): string | undefined {
    try {
      storage().removeItem(browserKeyStorageKey);
    } catch {
      return "Browser storage could not be cleared. Clear this site's data in your browser to remove any remembered key.";
    }
  }

  function forget() {
    key = "";
    publish("tab", remove());
  }

  return {
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot: () => state,
    getKey: (owner: string) => (owner === userId ? key : ""),
    setUser(nextUserId: string | null) {
      if (nextUserId === userId && nextUserId !== null) return;
      key = "";
      userId = nextUserId;
      if (userId === null) {
        forget();
        return;
      }
      try {
        const raw = storage().getItem(browserKeyStorageKey);
        if (raw !== null) {
          const saved: unknown = JSON.parse(raw);
          if (
            typeof saved === "object" &&
            saved !== null &&
            "userId" in saved &&
            saved.userId === userId &&
            "key" in saved &&
            typeof saved.key === "string" &&
            validKey(saved.key)
          ) {
            key = saved.key;
            publish("remember");
            return;
          }
          publish("tab", remove());
          return;
        }
        publish("tab");
      } catch {
        publish(
          "tab",
          remove() ??
            "The remembered key could not be restored. Enter it again to use it for this tab.",
        );
      }
    },
    save(value: string) {
      if (userId === null || !validKey(value.trim())) {
        publish(state.mode, "Enter a valid API key while signed in.");
        return;
      }
      key = value.trim();
      if (state.mode === "remember") {
        try {
          storage().setItem(browserKeyStorageKey, JSON.stringify({ userId, key }));
        } catch {
          publish(
            "tab",
            remove() ?? "The key could not be remembered. It is available only in this tab.",
          );
          return;
        }
      }
      publish(state.mode);
    },
    setMode(mode: KeyMode) {
      if (mode === "tab") {
        publish("tab", remove());
      } else if (userId !== null) {
        try {
          if (key) storage().setItem(browserKeyStorageKey, JSON.stringify({ userId, key }));
          publish("remember");
        } catch {
          publish(
            "tab",
            remove() ?? "The key could not be remembered. It is available only in this tab.",
          );
        }
      }
    },
    forget,
    handleStorageChange(event: Pick<StorageEvent, "key" | "newValue">) {
      if (event.key === null || event.key === browserKeyStorageKey) {
        key = "";
        publish("tab");
      }
    },
  };
}

function validKey(value: string): boolean {
  return /^[\x21-\x7e]{1,4096}$/.test(value);
}
