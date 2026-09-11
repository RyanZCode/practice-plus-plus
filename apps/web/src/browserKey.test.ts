import { describe, expect, it, vi } from "vitest";
import { browserKeyStorageKey, createBrowserKeyStore } from "./browserKey";

function fixture() {
  const values = new Map<string, string>();
  const storage = {
    getItem: vi.fn((name: string) => values.get(name) ?? null),
    setItem: vi.fn((name: string, value: string) => {
      values.set(name, value);
    }),
    removeItem: vi.fn((name: string) => {
      values.delete(name);
    }),
  } as unknown as Storage;
  const create = () => createBrowserKeyStore(() => storage);
  const store = create();
  store.setUser("alice");
  return { store, storage, create };
}

describe("browser API keys", () => {
  it("defaults to tab memory and loses the key on a new page load", () => {
    const { store, storage, create } = fixture();
    store.save("test-secret");
    expect(store.getKey("alice")).toBe("test-secret");
    expect(storage.setItem).not.toHaveBeenCalled();
    const refreshed = create();
    refreshed.setUser("alice");
    expect(refreshed.getSnapshot()).toEqual({ mode: "tab", hasKey: false });
  });

  it("remembers only after opt-in and restores only after authentication", () => {
    const { store, create } = fixture();
    store.save("test-secret");
    store.setMode("remember");
    const restarted = create();
    expect(restarted.getKey("alice")).toBe("");
    restarted.setUser("alice");
    expect(restarted.getKey("alice")).toBe("test-secret");
    expect(restarted.getSnapshot()).toEqual({ mode: "remember", hasKey: true });
    restarted.save("replacement");
    const refreshed = create();
    refreshed.setUser("alice");
    expect(refreshed.getKey("alice")).toBe("replacement");
  });

  it("allows consent before entry and deletes persistence immediately on switching modes", () => {
    const { store, storage, create } = fixture();
    store.setMode("remember");
    store.save("test-secret");
    store.setMode("tab");
    expect(storage.getItem(browserKeyStorageKey)).toBeNull();
    expect(store.getKey("alice")).toBe("test-secret");
    const refreshed = create();
    refreshed.setUser("alice");
    expect(refreshed.getKey("alice")).toBe("");
  });

  it.each(["forget", "sign-out"])("clears both copies on %s", (action) => {
    const { store, storage } = fixture();
    store.setMode("remember");
    store.save("test-secret");
    if (action === "forget") store.forget();
    else store.setUser(null);
    expect(store.getKey("alice")).toBe("");
    expect(storage.getItem(browserKeyStorageKey)).toBeNull();
    expect(store.getSnapshot()).toEqual({ mode: "tab", hasKey: false });
  });

  it("isolates accounts on restoration and live account changes", () => {
    const { store, storage, create } = fixture();
    store.setMode("remember");
    store.save("test-secret");
    expect(store.getKey("bob")).toBe("");
    const other = create();
    other.setUser("bob");
    expect(other.getKey("bob")).toBe("");
    expect(storage.getItem(browserKeyStorageKey)).toBeNull();
    store.setUser("bob");
    expect(store.getKey("bob")).toBe("");
    store.setUser("alice");
    expect(store.getKey("alice")).toBe("");
  });

  it("preserves tab credentials during token refresh", () => {
    const { store } = fixture();
    store.save("test-secret");
    store.setUser("alice");
    expect(store.getKey("alice")).toBe("test-secret");
  });

  it("clears stale in-memory credentials when another tab changes storage", () => {
    const { store } = fixture();
    store.save("test-secret");
    store.handleStorageChange({ key: "unrelated", newValue: null });
    expect(store.getSnapshot().hasKey).toBe(true);
    store.handleStorageChange({ key: browserKeyStorageKey, newValue: null });
    expect(store.getSnapshot().hasKey).toBe(false);
  });

  it("does not expose credentials through snapshots, serialization, or storage errors", () => {
    const { store, storage } = fixture();
    const listener = vi.fn();
    store.subscribe(listener);
    store.save("test-secret");
    vi.mocked(storage.setItem).mockImplementation(() => {
      throw new Error("test-secret");
    });
    store.setMode("remember");
    expect(store.getSnapshot().mode).toBe("tab");
    expect(store.getSnapshot().error).toContain("could not be remembered");
    expect(JSON.stringify(store)).not.toContain("test-secret");
    expect(JSON.stringify(store.getSnapshot())).not.toContain("test-secret");
    expect(listener).toHaveBeenCalledWith();
    vi.mocked(storage.removeItem).mockImplementation(() => {
      throw new Error("test-secret");
    });
    store.forget();
    expect(store.getKey("alice")).toBe("");
    expect(store.getSnapshot().error).toContain("Clear this site's data");
    expect(JSON.stringify(store.getSnapshot())).not.toContain("test-secret");
  });

  it("discards malformed remembered data without leaking parse errors", () => {
    const { storage, create } = fixture();
    storage.setItem(browserKeyStorageKey, "test-secret invalid JSON");
    const store = create();
    store.setUser("alice");
    expect(storage.getItem(browserKeyStorageKey)).toBeNull();
    expect(store.getSnapshot().hasKey).toBe(false);
    expect(JSON.stringify(store.getSnapshot())).not.toContain("test-secret");
  });

  it("supports memory-only use when localStorage is unavailable", () => {
    const store = createBrowserKeyStore(() => {
      throw new Error("Storage disabled");
    });
    store.setUser("alice");
    store.save("test-secret");
    expect(store.getKey("alice")).toBe("test-secret");
    store.setUser(null);
    expect(store.getKey("alice")).toBe("");
  });
});
