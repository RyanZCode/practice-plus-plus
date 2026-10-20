import { createServer, type Server } from "node:http";
import pino from "pino";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createApp } from "../../application/app.js";
import {
  createPrismaAccountDeletion,
  createSupabaseIdentityDeletion,
  type AccountDeletionOptions,
} from "./deletion.js";

const servers: Server[] = [];
function transactionClient(client: {
  userProfile: { deleteMany: ReturnType<typeof vi.fn>; findUnique: ReturnType<typeof vi.fn> };
}) {
  return {
    $transaction: vi
      .fn()
      .mockImplementation((work) => work({ ...client, accountDeletion: { upsert: vi.fn() } })),
  };
}
afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve, reject) => {
          server.close((error) => (error ? reject(error) : resolve()));
        }),
    ),
  );
});

async function start(options?: AccountDeletionOptions) {
  const app = createApp({
    logger: pino({ level: "silent" }),
    authentication: {
      ...(options ? { accountDeletion: options } : {}),
      verifier: {
        verify: async (token) => {
          if (token !== "valid-token") throw new Error("Invalid token");
          return { subject: "signed-in-user" };
        },
      },
      profileStore: { resolveByAuthSubject: vi.fn() },
    },
  });
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  servers.push(server);
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("Server did not start");
  return (body: unknown = { confirmation: "DELETE" }, token = "valid-token") =>
    fetch(`http://127.0.0.1:${address.port}/account`, {
      method: "DELETE",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
}

describe("account deletion", () => {
  it("deletes only the authenticated user's data before deleting the identity", async () => {
    const calls: string[] = [];
    const options = {
      deletePracticeData: vi.fn(async (subject: string) => {
        calls.push(`data:${subject}`);
      }),
      deleteIdentity: vi.fn(async (subject: string) => {
        calls.push(`identity:${subject}`);
      }),
    };
    const request = await start(options);
    const response = await request();
    expect(response.status).toBe(204);
    expect(calls).toEqual(["data:signed-in-user", "identity:signed-in-user"]);
    expect(await response.text()).toBe("");
  });

  it("rejects invalid authentication, missing confirmation, and attempts to specify another user", async () => {
    const options = { deletePracticeData: vi.fn(), deleteIdentity: vi.fn() };
    const request = await start(options);
    expect((await request(undefined, "invalid-token")).status).toBe(401);
    for (const body of [
      {},
      { confirmation: "delete" },
      { confirmation: "DELETE", userId: "other-user" },
    ]) {
      expect((await request(body)).status).toBe(400);
    }
    expect(options.deletePracticeData).not.toHaveBeenCalled();
    expect(options.deleteIdentity).not.toHaveBeenCalled();
  });

  it("leaves the identity intact when database deletion fails", async () => {
    const options = {
      deletePracticeData: vi.fn().mockRejectedValue(new Error("private database details")),
      deleteIdentity: vi.fn(),
    };
    const response = await (await start(options))();
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain("private database details");
    expect(options.deleteIdentity).not.toHaveBeenCalled();
  });

  it("allows retry after identity deletion fails", async () => {
    const options = {
      deletePracticeData: vi.fn().mockResolvedValue(undefined),
      deleteIdentity: vi
        .fn()
        .mockRejectedValueOnce(new Error("upstream details"))
        .mockResolvedValue(undefined),
    };
    const request = await start(options);
    expect((await request()).status).toBe(500);
    expect((await request()).status).toBe(204);
    expect(options.deleteIdentity).toHaveBeenNthCalledWith(2, "signed-in-user");
  });

  it("returns unavailable when the server admin key is not configured", async () => {
    expect((await (await start())()).status).toBe(503);
  });
});

describe("practice data deletion", () => {
  it("scopes cascade deletion to the subject and ordinary user role", async () => {
    const client = {
      userProfile: { deleteMany: vi.fn().mockResolvedValue({ count: 1 }), findUnique: vi.fn() },
    };
    await createPrismaAccountDeletion(transactionClient(client))("user-one");
    expect(client.userProfile.deleteMany).toHaveBeenCalledWith({
      where: { authSubject: "user-one", role: "USER" },
    });
  });

  it("rejects administrator deletion and permits retry for an already removed profile", async () => {
    const client = {
      userProfile: {
        deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
        findUnique: vi
          .fn()
          .mockResolvedValueOnce({ role: "ADMINISTRATOR" })
          .mockResolvedValueOnce(null),
      },
    };
    await expect(
      createPrismaAccountDeletion(transactionClient(client))("administrator"),
    ).rejects.toMatchObject({
      statusCode: 403,
    });
    await expect(
      createPrismaAccountDeletion(transactionClient(client))("already-removed"),
    ).resolves.toBeUndefined();
  });

  it("keeps shared catalog provenance intact when a former administrator requests deletion", async () => {
    const client = {
      userProfile: {
        deleteMany: vi.fn().mockRejectedValue({ code: "P2003" }),
        findUnique: vi.fn(),
      },
    };
    await expect(
      createPrismaAccountDeletion(transactionClient(client))("catalog-owner"),
    ).rejects.toMatchObject({
      statusCode: 403,
    });
  });
});

describe("Supabase account deletion", () => {
  it("uses the admin endpoint and keeps upstream errors private", async () => {
    const requests: Array<{
      url: string | undefined;
      method: string | undefined;
      authorization: string | undefined;
    }> = [];
    const server = createServer((request, response) => {
      requests.push({
        url: request.url,
        method: request.method,
        authorization: request.headers.authorization,
      });
      response.writeHead(403, { "content-type": "application/json" });
      response.end(JSON.stringify({ code: "not_admin", msg: "private upstream details" }));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    servers.push(server);
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("Server did not start");
    const remove = createSupabaseIdentityDeletion(
      `http://127.0.0.1:${address.port}`,
      "server-secret",
    );
    await expect(remove("11111111-1111-4111-8111-111111111111")).rejects.toMatchObject({
      statusCode: 502,
      message: expect.not.stringContaining("private upstream details"),
    });
    expect(requests).toEqual([
      {
        url: "/auth/v1/admin/users/11111111-1111-4111-8111-111111111111",
        method: "DELETE",
        authorization: "Bearer server-secret",
      },
    ]);
  });
});
