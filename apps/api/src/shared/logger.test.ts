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

  it("does not serialize error messages or stacks that may contain private content", () => {
    const output: string[] = [];
    const logger = createLogger(
      new Writable({
        write(chunk, _encoding, callback) {
          output.push(chunk.toString());
          callback();
        },
      }),
    );

    logger.error(
      { err: new Error("private prompt, response, code, and credential") },
      "Unhandled request error",
    );

    const record = JSON.parse(output.join(""));
    expect(record.err).toEqual({ type: "Error" });
    expect(output.join("")).not.toContain("private prompt");
  });
});
