import { createServer, type Server } from "node:http";

import express, { type Express } from "express";
import pino from "pino";
import { pinoHttp } from "pino-http";
import { afterEach, describe, expect, it, vi } from "vitest";

import { requireAuthentication, type AccessTokenVerifier } from "../../shared/auth.js";
import { requireAdministrator } from "./authorization.js";
import { handleError } from "../../shared/errors.js";
import { resolveApplicationProfile, type ApplicationProfile } from "./profile.js";

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

function createCatalogMutationApp(profile: ApplicationProfile): Express {
  const verifier: AccessTokenVerifier = {
    verify: vi.fn().mockResolvedValue({ subject: profile.authSubject }),
  };
  const app = express();

  app.use(pinoHttp({ logger: pino({ level: "silent" }) }));
  app.use(express.json());
  app.post(
    "/catalog/import",
    requireAuthentication(verifier),
    resolveApplicationProfile({ resolveByAuthSubject: vi.fn().mockResolvedValue(profile) }),
    requireAdministrator,
    (_request, response) => {
      response.status(204).send();
    },
  );
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

describe("administrator authorization", () => {
  const baseProfile = {
    authSubject: "a69bd27e-a95e-4ec5-9858-19dfc4b5e3c3",
    createdAt: new Date("2026-09-05T12:00:00Z"),
    id: "61a6afc6-d4de-4a61-879c-7ca6bdb5f6b1",
    updatedAt: new Date("2026-09-05T12:00:00Z"),
  };

  it("rejects an ordinary user's catalog mutation", async () => {
    const url = await startServer(createCatalogMutationApp({ ...baseProfile, role: "USER" }));
    const response = await fetch(`${url}/catalog/import?role=ADMINISTRATOR`, {
      body: JSON.stringify({ role: "ADMINISTRATOR" }),
      headers: {
        authorization: "Bearer valid-token",
        "content-type": "application/json",
        "x-user-role": "ADMINISTRATOR",
      },
      method: "POST",
    });

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "Forbidden" });
  });

  it("allows an administrator's catalog mutation", async () => {
    const url = await startServer(
      createCatalogMutationApp({ ...baseProfile, role: "ADMINISTRATOR" }),
    );
    const response = await fetch(`${url}/catalog/import`, {
      headers: { authorization: "Bearer valid-token" },
      method: "POST",
    });

    expect(response.status).toBe(204);
  });
});
