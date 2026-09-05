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
    const store = createPrismaProfileStore({ userProfile: { upsert } });

    await expect(store.resolveByAuthSubject(profile.authSubject)).resolves.toEqual(profile);
    expect(upsert).toHaveBeenCalledWith({
      create: { authSubject: profile.authSubject },
      update: {},
      where: { authSubject: profile.authSubject },
    });
  });
});
