import { createClient } from "@supabase/supabase-js";
import type { Request, RequestHandler } from "express";

import { HttpError } from "./errors.js";

export interface AuthenticatedIdentity {
  readonly subject: string;
}

export interface AccessTokenVerifier {
  verify(accessToken: string): Promise<AuthenticatedIdentity>;
}

interface ClaimsClient {
  getClaims(accessToken: string): Promise<{
    data: { claims: { sub?: unknown } } | null;
    error: unknown;
  }>;
}

const authenticatedIdentities = new WeakMap<Request, AuthenticatedIdentity>();

export function createSupabaseAccessTokenVerifier(
  supabaseUrl: string,
  supabasePublishableKey: string,
): AccessTokenVerifier {
  const client = createClient(supabaseUrl, supabasePublishableKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  });

  return createClaimsAccessTokenVerifier(client.auth);
}

export function createClaimsAccessTokenVerifier(client: ClaimsClient): AccessTokenVerifier {
  return {
    async verify(accessToken) {
      const { data, error } = await client.getClaims(accessToken);
      const subject = data?.claims.sub;

      if (error !== null || typeof subject !== "string" || subject.trim() === "") {
        throw new Error("Access token verification failed");
      }

      return { subject };
    },
  };
}

export function requireAuthentication(verifier: AccessTokenVerifier): RequestHandler {
  return async (request, _response, next) => {
    const accessToken = readBearerToken(request.get("authorization"));

    if (accessToken === undefined) {
      next(new HttpError(401, "Unauthorized"));
      return;
    }

    try {
      const identity = await verifier.verify(accessToken);
      authenticatedIdentities.set(request, identity);
      next();
    } catch {
      next(new HttpError(401, "Unauthorized"));
    }
  };
}

export function getAuthenticatedIdentity(request: Request): AuthenticatedIdentity {
  const identity = authenticatedIdentities.get(request);

  if (identity === undefined) {
    throw new Error("Authentication middleware did not resolve an identity");
  }

  return identity;
}

function readBearerToken(authorization: string | undefined): string | undefined {
  const match = /^Bearer\s+(\S+)$/i.exec(authorization ?? "");

  return match?.[1];
}
