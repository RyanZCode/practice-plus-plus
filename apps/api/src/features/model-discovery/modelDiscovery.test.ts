import { createServer, type Server } from "node:http";

import pino from "pino";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createApp } from "../../application/app.js";
import { ProviderError, type ProviderModelDiscoveryAdapter } from "../../shared/providers.js";
import { createModelDiscoveryService } from "./modelDiscovery.js";

const request = { providerId: "openai" as const, apiKey: "private-key" };
const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.closeAllConnections();
          server.close(() => resolve());
        }),
    ),
  );
});

describe("model discovery service", () => {
  it("caches successful discovery by profile, provider, and credential fingerprint", async () => {
    let now = 1_000;
    const provider: ProviderModelDiscoveryAdapter = {
      discoverModels: vi.fn().mockResolvedValue(["gpt-4.1"]),
    };
    const service = createModelDiscoveryService({ provider, now: () => now });

    await expect(service.discover("profile-a", request)).resolves.toMatchObject({
      state: "READY",
      models: [{ id: "gpt-4.1" }],
    });
    await service.discover("profile-a", request);
    await service.discover("profile-b", request);
    await service.discover("profile-a", { ...request, apiKey: "another-key" });
    expect(provider.discoverModels).toHaveBeenCalledTimes(3);

    now += 10 * 60 * 1000;
    await service.discover("profile-a", request);
    expect(provider.discoverModels).toHaveBeenCalledTimes(4);
  });

  it("returns an empty discovery state without creating a fallback model", async () => {
    const provider: ProviderModelDiscoveryAdapter = {
      discoverModels: vi.fn().mockResolvedValue([]),
    };
    const service = createModelDiscoveryService({ provider });

    await expect(service.discover("profile-a", request)).resolves.toEqual({
      providerId: "openai",
      state: "EMPTY",
      models: [],
    });
  });

  it("reports reasoning capabilities for supported discovered models", async () => {
    const provider: ProviderModelDiscoveryAdapter = {
      discoverModels: vi.fn().mockResolvedValue(["gpt-5.5", "gpt-4.1"]),
    };
    const service = createModelDiscoveryService({ provider });

    await expect(service.discover("profile-a", request)).resolves.toMatchObject({
      models: [
        { id: "gpt-5.5", reasoningEfforts: ["none", "minimal", "low", "medium", "high", "xhigh"] },
        { id: "gpt-4.1", reasoningEfforts: [] },
      ],
    });
  });

  it("does not cache provider failures", async () => {
    const provider: ProviderModelDiscoveryAdapter = {
      discoverModels: vi
        .fn()
        .mockRejectedValueOnce(new ProviderError("unavailable"))
        .mockResolvedValueOnce(["gpt-5.4-mini"]),
    };
    const service = createModelDiscoveryService({ provider });

    await expect(service.discover("profile-a", request)).rejects.toMatchObject({
      code: "unavailable",
    });
    await expect(service.discover("profile-a", request)).resolves.toMatchObject({
      models: [{ id: "gpt-5.4-mini" }],
    });
    expect(provider.discoverModels).toHaveBeenCalledTimes(2);
  });
});

describe("model discovery route", () => {
  async function setup(provider: ProviderModelDiscoveryAdapter) {
    const server = createServer(
      createApp({
        authentication: {
          modelDiscovery: { provider },
          profileStore: {
            resolveByAuthSubject: vi.fn().mockResolvedValue({ id: "application-user" }),
          },
          verifier: { verify: vi.fn().mockResolvedValue({ subject: "verified-user" }) },
        },
        logger: pino({ level: "silent" }),
      }),
    );
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    servers.push(server);
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("No test address");
    return `http://127.0.0.1:${address.port}/ai/models`;
  }

  it("requires authentication and returns validated account models", async () => {
    const provider: ProviderModelDiscoveryAdapter = {
      discoverModels: vi.fn().mockResolvedValue(["gpt-4.1"]),
    };
    const url = await setup(provider);
    expect((await fetch(url, { method: "POST" })).status).toBe(401);

    const response = await fetch(url, {
      body: JSON.stringify(request),
      headers: { authorization: "Bearer valid-token", "content-type": "application/json" },
      method: "POST",
    });
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      providerId: "openai",
      state: "READY",
      models: [{ id: "gpt-4.1", reasoningEfforts: [] }],
    });
    expect(provider.discoverModels).toHaveBeenCalledWith(
      expect.objectContaining({ providerId: "openai", apiKey: "private-key" }),
    );
  });

  it("rejects malformed input before the provider is called", async () => {
    const provider: ProviderModelDiscoveryAdapter = {
      discoverModels: vi.fn(),
    };
    const url = await setup(provider);
    const response = await fetch(url, {
      body: JSON.stringify({ providerId: "constructor", apiKey: "private-key" }),
      headers: { authorization: "Bearer valid-token", "content-type": "application/json" },
      method: "POST",
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Invalid model discovery request." });
    expect(provider.discoverModels).not.toHaveBeenCalled();
  });
});
