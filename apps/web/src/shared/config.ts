const LOCAL_API_URL = "http://localhost:3000";

interface Environment {
  readonly DEV: boolean;
  readonly VITE_API_URL?: string;
  readonly VITE_SUPABASE_PUBLISHABLE_KEY?: string;
  readonly VITE_SUPABASE_URL?: string;
}

export interface WebConfig {
  readonly apiUrl: string;
  readonly supabasePublishableKey: string;
  readonly supabaseUrl: string;
}

export function readConfig(environment: Environment = import.meta.env): WebConfig {
  const apiUrl = environment.VITE_API_URL?.trim() || (environment.DEV ? LOCAL_API_URL : undefined);

  return {
    apiUrl: readUrl("VITE_API_URL", apiUrl),
    supabasePublishableKey: readPublishableKey(environment.VITE_SUPABASE_PUBLISHABLE_KEY),
    supabaseUrl: readUrl("VITE_SUPABASE_URL", environment.VITE_SUPABASE_URL?.trim()),
  };
}

function readUrl(name: string, value: string | undefined): string {
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

  return value;
}

function requireValue(name: string, value: string | undefined): string {
  if (value === undefined || value.trim() === "") {
    throw new Error(`${name} is required`);
  }

  return value.trim();
}

function readPublishableKey(value: string | undefined): string {
  const key = requireValue("VITE_SUPABASE_PUBLISHABLE_KEY", value);

  if (!key.startsWith("sb_publishable_")) {
    throw new Error("VITE_SUPABASE_PUBLISHABLE_KEY must be a Supabase publishable key");
  }

  return key;
}
