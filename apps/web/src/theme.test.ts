import { describe, expect, it, vi } from "vitest";

import { loadTheme, resolveTheme, saveTheme } from "./theme";

describe("theme preference", () => {
  it("defaults to the system preference when nothing is stored", () => {
    expect(loadTheme({ getItem: () => null })).toBe("system");
  });

  it("restores an explicit light preference", () => {
    expect(loadTheme({ getItem: () => "light" })).toBe("light");
  });

  it("ignores an invalid stored preference", () => {
    expect(loadTheme({ getItem: () => "sepia" })).toBe("system");
  });

  it("restores an explicit system preference", () => {
    expect(loadTheme({ getItem: () => "system" })).toBe("system");
  });

  it("resolves the system preference from the operating system", () => {
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
    expect(resolveTheme("light", true)).toBe("light");
  });

  it("persists a selected theme", () => {
    const setItem = vi.fn();

    saveTheme({ setItem }, "system");

    expect(setItem).toHaveBeenCalledWith("practice-plus-plus-appearance", "system");
  });

  it("falls back safely when browser storage is unavailable", () => {
    expect(
      loadTheme({
        getItem: () => {
          throw new Error("unavailable");
        },
      }),
    ).toBe("system");

    expect(() =>
      saveTheme(
        {
          setItem: () => {
            throw new Error("unavailable");
          },
        },
        "light",
      ),
    ).not.toThrow();
  });
});
