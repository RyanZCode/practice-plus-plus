import {
  providerModelDiscoveryRequestSchema,
  providerModelDiscoveryResponseSchema,
  type ProviderModelDiscoveryResponse,
} from "@practice-plus-plus/contracts";

export type ModelDiscoveryErrorKind = "INVALID_CREDENTIALS" | "SESSION" | "TEMPORARY";

export class ModelDiscoveryError extends Error {
  public constructor(
    message: string,
    public readonly kind: ModelDiscoveryErrorKind,
  ) {
    super(message);
    this.name = "ModelDiscoveryError";
  }
}

export async function discoverModels(
  apiUrl: string,
  token: string,
  apiKey: string,
  signal?: AbortSignal,
  fetcher: typeof fetch = fetch,
): Promise<ProviderModelDiscoveryResponse> {
  const request = providerModelDiscoveryRequestSchema.parse({
    providerId: "openai",
    apiKey,
  });
  const response = await fetcher(`${apiUrl.replace(/\/$/, "")}/ai/models`, {
    body: JSON.stringify(request),
    cache: "no-store",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    method: "POST",
    ...(signal ? { signal } : {}),
  });

  if (!response.ok) {
    if (response.status === 401) {
      throw new ModelDiscoveryError("Your session expired. Sign in again.", "SESSION");
    }
    if (response.status === 400) {
      throw new ModelDiscoveryError(
        "The provider rejected the API key or model discovery request.",
        "INVALID_CREDENTIALS",
      );
    }
    throw new ModelDiscoveryError(
      "Model discovery is temporarily unavailable. Please retry.",
      "TEMPORARY",
    );
  }

  return providerModelDiscoveryResponseSchema.parse(await response.json());
}
