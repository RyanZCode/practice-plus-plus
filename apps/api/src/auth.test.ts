import { createServer, type Server } from "node:http";

import express, { type Express } from "express";
import pino from "pino";
import { pinoHttp } from "pino-http";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createClaimsAccessTokenVerifier,
  getAuthenticatedIdentity,
  requireAuthentication,
  type AccessTokenVerifier,
} from "./auth.js";
import { handleError } from "./errors.js";

const servers: Server[] = [];

async function startServer(app: Express): Promise<string> {
  const server = createServer(app);

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  servers.push(server);

  const address = server.address();

  if (address === null || typeof address === "string") {
    throw new Error("Test server did not start on a TCP port");
  }

  return `http://127.0.0.1:${address.port}`;
}

function createProtectedApp(verifier: AccessTokenVerifier): Express {
  const app = express();

  app.use(pinoHttp({ logger: pino({ level: "silent" }) }));
  app.use(express.json());
  app.post("/protected", requireAuthentication(verifier), (request, response) => {
    response.json(getAuthenticatedIdentity(request));
  });
  app.use(handleError);

  return app;
}

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve, reject) => {
          server.close((error) => (error === undefined ? resolve() : reject(error)));
        }),
    ),
  );
});

describe("Supabase access-token verification", () => {
  it("resolves the verified token subject", async () => {
    const client = {
      getClaims: vi.fn().mockResolvedValue({
        data: { claims: { sub: "supabase-user-123" } },
        error: null,
      }),
    };
    const verifier = createClaimsAccessTokenVerifier(client);

    await expect(verifier.verify("valid-token")).resolves.toEqual({
      subject: "supabase-user-123",
    });
    expect(client.getClaims).toHaveBeenCalledWith("valid-token");
  });

  it("rejects failed verification and claims without a subject", async () => {
    const failedVerifier = createClaimsAccessTokenVerifier({
      getClaims: vi.fn().mockResolvedValue({ data: null, error: new Error("invalid signature") }),
    });
    const missingSubjectVerifier = createClaimsAccessTokenVerifier({
      getClaims: vi.fn().mockResolvedValue({ data: { claims: {} }, error: null }),
    });

    await expect(failedVerifier.verify("invalid-token")).rejects.toThrow(
      "Access token verification failed",
    );
    await expect(missingSubjectVerifier.verify("invalid-token")).rejects.toThrow(
      "Access token verification failed",
    );
  });
});

describe("authentication middleware", () => {
  it("rejects a missing bearer token without calling the verifier", async () => {
    const verifier = { verify: vi.fn<AccessTokenVerifier["verify"]>() };
    const url = await startServer(createProtectedApp(verifier));
    const response = await fetch(`${url}/protected`, { method: "POST" });

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Unauthorized" });
    expect(verifier.verify).not.toHaveBeenCalled();
  });

  it.each(["invalid-token", "expired-token"])(
    "rejects %s without leaking token details",
    async (accessToken) => {
      const verifier: AccessTokenVerifier = {
        verify: vi.fn().mockRejectedValue(new Error(`Rejected ${accessToken}`)),
      };
      const url = await startServer(createProtectedApp(verifier));
      const response = await fetch(`${url}/protected`, {
        headers: { authorization: `Bearer ${accessToken}` },
        method: "POST",
      });
      const body = await response.text();

      expect(response.status).toBe(401);
      expect(body).toBe('{"error":"Unauthorized"}');
      expect(body).not.toContain(accessToken);
    },
  );

  it("uses only the verified subject as the request identity", async () => {
    const verifier: AccessTokenVerifier = {
      verify: vi.fn().mockResolvedValue({ subject: "verified-user" }),
    };
    const url = await startServer(createProtectedApp(verifier));
    const response = await fetch(`${url}/protected?userId=query-user`, {
      body: JSON.stringify({ userId: "body-user" }),
      headers: {
        authorization: "Bearer valid-token",
        "content-type": "application/json",
        "x-user-id": "header-user",
      },
      method: "POST",
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ subject: "verified-user" });
    expect(verifier.verify).toHaveBeenCalledWith("valid-token");
  });
});
