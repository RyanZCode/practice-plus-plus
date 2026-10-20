import { createClient } from "@supabase/supabase-js";
import { Router } from "express";
import { deleteAccountSchema } from "@practice-plus-plus/contracts";

import { getAuthenticatedIdentity } from "../../shared/auth.js";
import { HttpError } from "../../shared/errors.js";
import { retryTransaction } from "../../shared/database.js";

interface DeletionTransaction {
  readonly accountDeletion: {
    upsert(options: {
      create: { authSubject: string };
      update: Record<string, never>;
      where: { authSubject: string };
    }): Promise<unknown>;
  };
  readonly userProfile: {
    findUnique(options: {
      where: { authSubject: string };
      select: { role: true };
    }): Promise<{ role: string } | null>;
    deleteMany(options: {
      where: { authSubject: string; role: "USER" };
    }): Promise<{ count: number }>;
  };
}

interface DeletionClient {
  $transaction<T>(
    work: (client: DeletionTransaction) => Promise<T>,
    options: { isolationLevel: "Serializable" },
  ): Promise<T>;
}

export interface AccountDeletionOptions {
  readonly deletePracticeData: (subject: string) => Promise<void>;
  readonly deleteIdentity: (subject: string) => Promise<void>;
}

export function createPrismaAccountDeletion(client: DeletionClient) {
  return async (subject: string): Promise<void> => {
    try {
      await retryTransaction(() =>
        client.$transaction(
          async (transaction) => {
            await transaction.accountDeletion.upsert({
              create: { authSubject: subject },
              update: {},
              where: { authSubject: subject },
            });
            const result = await transaction.userProfile.deleteMany({
              where: { authSubject: subject, role: "USER" },
            });
            if (result.count === 0) {
              const profile = await transaction.userProfile.findUnique({
                where: { authSubject: subject },
                select: { role: true },
              });
              if (profile !== null) {
                throw new HttpError(
                  403,
                  "Administrator accounts cannot be deleted here. Contact support.",
                );
              }
            }
            return result;
          },
          { isolationLevel: "Serializable" },
        ),
      );
    } catch (error) {
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "P2003"
      ) {
        throw new HttpError(
          403,
          "This account owns shared catalog records. Contact support to delete it.",
        );
      }
      throw error;
    }
  };
}

export function createSupabaseIdentityDeletion(url: string, secretKey: string) {
  const client = createClient(url, secretKey, {
    auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
  });
  return async (subject: string): Promise<void> => {
    const { error } = await client.auth.admin.deleteUser(subject);
    if (error !== null && error.code !== "user_not_found") {
      throw new HttpError(
        502,
        "Your practice data was removed, but sign-in account deletion failed. Retry deleting your account.",
      );
    }
  };
}

export function createAccountRouter(options: AccountDeletionOptions | undefined): Router {
  const router = Router();
  router.delete("/", async (request, response) => {
    if (!deleteAccountSchema.safeParse(request.body).success) {
      throw new HttpError(400, "Confirm account deletion by entering DELETE.");
    }
    if (options === undefined) {
      throw new HttpError(503, "Account deletion is unavailable. Contact support.");
    }
    const { subject } = getAuthenticatedIdentity(request);
    await options.deletePracticeData(subject);
    await options.deleteIdentity(subject);
    response.status(204).end();
  });
  return router;
}
