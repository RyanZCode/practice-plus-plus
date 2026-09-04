import type { Request, RequestHandler } from "express";

import { getAuthenticatedIdentity } from "./auth.js";

export interface ApplicationProfile {
  readonly authSubject: string;
  readonly createdAt: Date;
  readonly id: string;
  readonly updatedAt: Date;
}

export interface ProfileStore {
  resolveByAuthSubject(authSubject: string): Promise<ApplicationProfile>;
}

interface ProfileClient {
  readonly userProfile: {
    upsert(options: {
      create: { authSubject: string };
      update: Record<string, never>;
      where: { authSubject: string };
    }): Promise<ApplicationProfile>;
  };
}

const applicationProfiles = new WeakMap<Request, ApplicationProfile>();

export function createPrismaProfileStore(client: ProfileClient): ProfileStore {
  return {
    resolveByAuthSubject(authSubject) {
      return client.userProfile.upsert({
        create: { authSubject },
        update: {},
        where: { authSubject },
      });
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
