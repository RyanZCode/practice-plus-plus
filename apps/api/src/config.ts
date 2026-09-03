export interface ApiConfig {
  readonly port: number;
  readonly supabasePublishableKey: string;
  readonly supabaseUrl: string;
}

export function readConfig(environment: NodeJS.ProcessEnv = process.env): ApiConfig {
  return {
    port: readPort(environment.PORT),
    supabasePublishableKey: readPublishableKey(environment.SUPABASE_PUBLISHABLE_KEY),
    supabaseUrl: readUrl("SUPABASE_URL", environment.SUPABASE_URL),
  };
}

function readPort(value: string | undefined): number {
  const port = Number(value ?? 3000);

  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("PORT must be an integer between 1 and 65535");
  }

  return port;
}

function readUrl(name: string, value: string | undefined): string {
  const url = requireValue(name, value);
  let parsedUrl: URL;

  try {
    parsedUrl = new URL(url);
  } catch {
    throw new Error(`${name} must be a valid URL`);
  }

  if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
    throw new Error(`${name} must use HTTP or HTTPS`);
  }

  return url;
}

function requireValue(name: string, value: string | undefined): string {
  if (value === undefined || value.trim() === "") {
    throw new Error(`${name} is required`);
  }

  return value.trim();
}

function readPublishableKey(value: string | undefined): string {
  const key = requireValue("SUPABASE_PUBLISHABLE_KEY", value);

  if (!key.startsWith("sb_publishable_")) {
    throw new Error("SUPABASE_PUBLISHABLE_KEY must be a Supabase publishable key");
  }

  return key;
}
