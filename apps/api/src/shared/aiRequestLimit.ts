import type { RequestHandler } from "express";

import { getAuthenticatedIdentity } from "./auth.js";

const windowMs = 60_000;
const requestLimit = 30;
const concurrencyLimit = 3;

export function createAiRequestLimit(now: () => number = Date.now): RequestHandler {
  const users = new Map<string, { startedAt: number; count: number; active: number }>();

  return (request, response, next) => {
    const time = now();
    for (const [subject, usage] of users) {
      if (usage.active === 0 && time - usage.startedAt >= windowMs) users.delete(subject);
    }
    const subject = getAuthenticatedIdentity(request).subject;
    let usage = users.get(subject);
    if (usage === undefined) {
      usage = { startedAt: time, count: 0, active: 0 };
      users.set(subject, usage);
    } else if (time - usage.startedAt >= windowMs) {
      usage.startedAt = time;
      usage.count = 0;
    }

    if (usage.count >= requestLimit || usage.active >= concurrencyLimit) {
      const retryAfter =
        usage.count >= requestLimit
          ? Math.max(1, Math.ceil((usage.startedAt + windowMs - time) / 1000))
          : 1;
      response.setHeader("Retry-After", retryAfter);
      response.status(429).json({ error: "Too many AI requests. Try again shortly." });
      return;
    }

    usage.count += 1;
    usage.active += 1;
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      usage.active -= 1;
    };
    response.once("finish", release);
    response.once("close", release);
    next();
  };
}
