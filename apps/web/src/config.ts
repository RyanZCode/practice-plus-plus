const LOCAL_API_URL = "http://localhost:3000";

interface Environment {
  readonly DEV: boolean;
  readonly VITE_API_URL?: string;
}

export function validateConfig(environment: Environment = import.meta.env): void {
  const apiUrl = environment.VITE_API_URL?.trim() || (environment.DEV ? LOCAL_API_URL : undefined);

  if (apiUrl === undefined) {
    throw new Error("VITE_API_URL is required");
  }

  let parsedUrl: URL;

  try {
    parsedUrl = new URL(apiUrl);
  } catch {
    throw new Error("VITE_API_URL must be a valid URL");
  }

  if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
    throw new Error("VITE_API_URL must use HTTP or HTTPS");
  }
}
