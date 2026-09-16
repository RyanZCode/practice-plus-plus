export type ColorTheme = "dark" | "light";
export type ThemePreference = ColorTheme | "system";

const themeStorageKey = "practice-plus-plus-appearance";

export function loadTheme(storage: Pick<Storage, "getItem">): ThemePreference {
  try {
    const storedTheme = storage.getItem(themeStorageKey);
    return storedTheme === "dark" || storedTheme === "light" ? storedTheme : "system";
  } catch {
    return "system";
  }
}

export function resolveTheme(preference: ThemePreference, prefersDark: boolean): ColorTheme {
  return preference === "system" ? (prefersDark ? "dark" : "light") : preference;
}

export function saveTheme(storage: Pick<Storage, "setItem">, preference: ThemePreference): void {
  try {
    storage.setItem(themeStorageKey, preference);
  } catch {
    // Keep the active theme when browser storage is unavailable.
  }
}
