import { Writable } from "node:stream";

import { describe, expect, it } from "vitest";

import { createLogger } from "./logger.js";

describe("logger", () => {
  it("redacts authorization and credential fields", () => {
    const output: string[] = [];
    const destination = new Writable({
      write(chunk, _encoding, callback) {
        output.push(chunk.toString());
        callback();
      },
    });
    const logger = createLogger(destination);

    logger.info({
      req: { headers: { authorization: "Bearer request-secret" } },
      password: "password-secret",
      credentials: { apiKey: "api-key-secret" },
    });

    const log = output.join("");

    expect(log).not.toContain("request-secret");
    expect(log).not.toContain("password-secret");
    expect(log).not.toContain("api-key-secret");
    expect(log.match(/\[Redacted\]/g)).toHaveLength(3);
  });
});
