import { describe, expect, it, vi } from "vitest";

import { createPrismaProfileStore, type ApplicationProfile } from "./profile.js";

describe("Prisma profile store", () => {
  it("atomically creates or resolves a profile by its unique authentication subject", async () => {
    const profile: ApplicationProfile = {
      authSubject: "a69bd27e-a95e-4ec5-9858-19dfc4b5e3c3",
      createdAt: new Date("2026-09-04T12:00:00Z"),
      id: "61a6afc6-d4de-4a61-879c-7ca6bdb5f6b1",
      role: "USER",
      updatedAt: new Date("2026-09-04T12:00:00Z"),
    };
    const upsert = vi.fn().mockResolvedValue(profile);
    const transaction = {
      userProfile: { upsert },
      accountDeletion: { findUnique: vi.fn().mockResolvedValue(null) },
    };
    const client = { $transaction: vi.fn().mockImplementation((work) => work(transaction)) };
    const store = createPrismaProfileStore(client);

    await expect(store.resolveByAuthSubject(profile.authSubject)).resolves.toEqual(profile);
    expect(upsert).toHaveBeenCalledWith({
      create: { authSubject: profile.authSubject },
      update: {},
      where: { authSubject: profile.authSubject },
    });
    expect(client.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: "Serializable",
    });
  });

  it("does not recreate a profile after account deletion", async () => {
    const transaction = {
      userProfile: { upsert: vi.fn() },
      accountDeletion: { findUnique: vi.fn().mockResolvedValue({ authSubject: "deleted-user" }) },
    };
    const store = createPrismaProfileStore({
      $transaction: vi.fn().mockImplementation((work) => work(transaction)),
    });
    await expect(store.resolveByAuthSubject("deleted-user")).rejects.toMatchObject({
      statusCode: 403,
    });
    expect(transaction.userProfile.upsert).not.toHaveBeenCalled();
  });

  it("rechecks the deletion marker after a concurrent transaction conflict", async () => {
    const transaction = {
      userProfile: { upsert: vi.fn() },
      accountDeletion: { findUnique: vi.fn().mockResolvedValue({ authSubject: "deleted-user" }) },
    };
    const client = {
      $transaction: vi
        .fn()
        .mockRejectedValueOnce({ code: "P2034" })
        .mockImplementation((work) => work(transaction)),
    };
    await expect(
      createPrismaProfileStore(client).resolveByAuthSubject("deleted-user"),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(client.$transaction).toHaveBeenCalledTimes(2);
    expect(transaction.userProfile.upsert).not.toHaveBeenCalled();
  });
});
