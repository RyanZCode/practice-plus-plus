import { describe, expect, it, vi } from "vitest";

import { discoverModels, ModelDiscoveryError } from "./modelDiscoveryApi";

describe("model discovery API", () => {
  it("sends the transient key to the authenticated discovery route", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          providerId: "openai",
          state: "READY",
          models: [{ id: "gpt-4.1" }],
        }),
        { headers: { "content-type": "application/json" } },
      ),
    );

    await expect(
      discoverModels("https://api.example/", "session-token", "private-key", undefined, fetcher),
    ).resolves.toEqual({
      providerId: "openai",
      state: "READY",
      models: [{ id: "gpt-4.1" }],
    });
    expect(fetcher).toHaveBeenCalledWith(
      "https://api.example/ai/models",
      expect.objectContaining({
        method: "POST",
        headers: {
          authorization: "Bearer session-token",
          "content-type": "application/json",
        },
        body: JSON.stringify({ providerId: "openai", apiKey: "private-key" }),
      }),
    );
  });

  it.each([
    [400, "INVALID_CREDENTIALS"],
    [502, "TEMPORARY"],
    [429, "TEMPORARY"],
  ] as const)("normalizes provider status %i", async (status, kind) => {
    const error = await discoverModels(
      "https://api.example",
      "session-token",
      "private-key",
      undefined,
      vi.fn<typeof fetch>().mockResolvedValue(new Response("upstream secret", { status })),
    ).catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(ModelDiscoveryError);
    expect(error).toMatchObject({ kind });
    expect((error as Error).message).not.toContain("upstream secret");
  });
});
