const LOCAL_API_URL = "http://localhost:3000";

interface Environment {
  readonly DEV: boolean;
  readonly VITE_API_URL?: string;
  readonly VITE_SUPABASE_PUBLISHABLE_KEY?: string;
  readonly VITE_SUPABASE_URL?: string;
}

export function validateConfig(environment: Environment = import.meta.env): void {
  const apiUrl = environment.VITE_API_URL?.trim() || (environment.DEV ? LOCAL_API_URL : undefined);

  validateUrl("VITE_API_URL", apiUrl);
  validateUrl("VITE_SUPABASE_URL", environment.VITE_SUPABASE_URL?.trim());
  validatePublishableKey(environment.VITE_SUPABASE_PUBLISHABLE_KEY);
}

function validateUrl(name: string, value: string | undefined): void {
  if (value === undefined || value === "") {
    throw new Error(`${name} is required`);
  }

  let parsedUrl: URL;

  try {
    parsedUrl = new URL(value);
  } catch {
    throw new Error(`${name} must be a valid URL`);
  }

  if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
    throw new Error(`${name} must use HTTP or HTTPS`);
  }
}

function requireValue(name: string, value: string | undefined): void {
  if (value === undefined || value.trim() === "") {
    throw new Error(`${name} is required`);
  }
}

function validatePublishableKey(value: string | undefined): void {
  requireValue("VITE_SUPABASE_PUBLISHABLE_KEY", value);

  if (!value?.trim().startsWith("sb_publishable_")) {
    throw new Error("VITE_SUPABASE_PUBLISHABLE_KEY must be a Supabase publishable key");
  }
}
