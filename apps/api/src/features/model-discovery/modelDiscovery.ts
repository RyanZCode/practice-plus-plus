import { createHash } from "node:crypto";

import {
  providerModelDiscoveryRequestSchema,
  providerModelDiscoveryResponseSchema,
  type ProviderModelDiscoveryRequest,
  type ProviderModelDiscoveryResponse,
} from "@practice-plus-plus/contracts";
import express, { type ErrorRequestHandler } from "express";

import { HttpError } from "../../shared/errors.js";
import { type ProviderModelDiscoveryAdapter, ProviderError } from "../../shared/providers.js";
import { getApplicationProfile } from "../account/profile.js";

const cacheTtlMs = 10 * 60 * 1000;

interface DiscoveryCacheEntry {
  readonly models: readonly string[];
  readonly expiresAt: number;
}

export interface ModelDiscoveryServiceOptions {
  readonly now?: () => number;
  readonly ttlMs?: number;
}

export interface ModelDiscoveryOptions extends ModelDiscoveryServiceOptions {
  readonly provider: ProviderModelDiscoveryAdapter;
}

export interface ModelDiscoveryService {
  discover(
    userProfileId: string,
    request: ProviderModelDiscoveryRequest,
    signal?: AbortSignal,
  ): Promise<ProviderModelDiscoveryResponse>;
}

export function createModelDiscoveryService({
  provider,
  now = () => Date.now(),
  ttlMs = cacheTtlMs,
}: ModelDiscoveryOptions): ModelDiscoveryService {
  const cache = new Map<string, DiscoveryCacheEntry>();

  return {
    async discover(userProfileId, request, signal) {
      const parsed = providerModelDiscoveryRequestSchema.safeParse(request);
      if (!parsed.success) throw new HttpError(400, "Invalid model discovery request.");

      const cacheKey = `${userProfileId}:${parsed.data.providerId}:${fingerprint(parsed.data.apiKey)}`;
      const currentTime = now();
      for (const [key, entry] of cache) {
        if (entry.expiresAt <= currentTime) cache.delete(key);
      }
      const cached = cache.get(cacheKey);
      if (cached !== undefined) {
        return toResponse(parsed.data.providerId, cached.models);
      }

      const models = await provider.discoverModels({
        ...parsed.data,
        ...(signal ? { signal } : {}),
      });
      cache.set(cacheKey, { models: [...models], expiresAt: now() + ttlMs });
      return toResponse(parsed.data.providerId, models);
    },
  };
}

export function createModelDiscoveryRouter(options: ModelDiscoveryOptions): express.Router {
  const router = express.Router();
  const service = createModelDiscoveryService(options);
  router.use(express.json({ limit: "8kb" }));

  router.post("/", async (request, response) => {
    response.setHeader("Cache-Control", "no-store");
    const parsed = providerModelDiscoveryRequestSchema.safeParse(request.body);
    if (!parsed.success) throw new HttpError(400, "Invalid model discovery request.");

    const controller = new AbortController();
    const abort = () => controller.abort();
    response.on("close", abort);
    try {
      const result = await service.discover(
        getApplicationProfile(request).id,
        parsed.data,
        controller.signal,
      );
      response.json(providerModelDiscoveryResponseSchema.parse(result));
    } catch (error) {
      if (controller.signal.aborted && !response.writableEnded) return;
      if (error instanceof ProviderError) throw error;
      throw error;
    } finally {
      response.off("close", abort);
      controller.abort();
    }
  });

  const invalidBody: ErrorRequestHandler = (_error, _request, response, next) => {
    if (response.headersSent) {
      next(new HttpError(400, "Invalid model discovery request."));
      return;
    }
    response.status(400).setHeader("Cache-Control", "no-store");
    response.json({ error: "Invalid model discovery request." });
  };
  router.use(invalidBody);
  return router;
}

function toResponse(
  providerId: ProviderModelDiscoveryResponse["providerId"],
  models: readonly string[],
): ProviderModelDiscoveryResponse {
  return providerModelDiscoveryResponseSchema.parse({
    providerId,
    state: models.length === 0 ? "EMPTY" : "READY",
    models: models.map((id) => ({ id })),
  });
}

function fingerprint(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
