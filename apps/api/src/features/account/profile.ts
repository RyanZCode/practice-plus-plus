import type { Request, RequestHandler } from "express";

import { getAuthenticatedIdentity } from "../../shared/auth.js";
import { HttpError } from "../../shared/errors.js";
import { retryTransaction } from "../../shared/database.js";

export interface ApplicationProfile {
  readonly authSubject: string;
  readonly createdAt: Date;
  readonly id: string;
  readonly role: "ADMINISTRATOR" | "USER";
  readonly updatedAt: Date;
}

export interface ProfileStore {
  resolveByAuthSubject(authSubject: string): Promise<ApplicationProfile>;
}

interface ProfileTransaction {
  readonly accountDeletion: {
    findUnique(options: {
      where: { authSubject: string };
    }): Promise<{ authSubject: string } | null>;
  };
  readonly userProfile: {
    upsert(options: {
      create: { authSubject: string };
      update: Record<string, never>;
      where: { authSubject: string };
    }): Promise<ApplicationProfile>;
  };
}

interface ProfileClient {
  $transaction<T>(
    work: (client: ProfileTransaction) => Promise<T>,
    options: { isolationLevel: "Serializable" },
  ): Promise<T>;
}

const applicationProfiles = new WeakMap<Request, ApplicationProfile>();

export function createPrismaProfileStore(client: ProfileClient): ProfileStore {
  return {
    resolveByAuthSubject(authSubject) {
      return retryTransaction(() =>
        client.$transaction(
          async (transaction) => {
            if (await transaction.accountDeletion.findUnique({ where: { authSubject } })) {
              throw new HttpError(403, "This account has been deleted.");
            }
            return transaction.userProfile.upsert({
              create: { authSubject },
              update: {},
              where: { authSubject },
            });
          },
          { isolationLevel: "Serializable" },
        ),
      );
    },
  };
}

export function resolveApplicationProfile(profileStore: ProfileStore): RequestHandler {
  return async (request, _response, next) => {
    try {
      const { subject } = getAuthenticatedIdentity(request);
      const profile = await profileStore.resolveByAuthSubject(subject);

      applicationProfiles.set(request, profile);
      next();
    } catch (error) {
      next(error);
    }
  };
}

export function getApplicationProfile(request: Request): ApplicationProfile {
  const profile = applicationProfiles.get(request);

  if (profile === undefined) {
    throw new Error("Profile middleware did not resolve an application profile");
  }

  return profile;
}
