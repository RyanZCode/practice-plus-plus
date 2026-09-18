import {
  modelNameSchema,
  openAiModels,
  providerIdSchema,
  providerSelectionSchema,
  type ProviderId,
  type ProviderModelDiscoveryRequest,
  type ProviderSelection,
  type ProvidersResponse,
} from "@practice-plus-plus/contracts";

import { HttpError } from "./errors.js";

const providers: Record<ProviderId, { name: string; endpoint: string; modelsEndpoint: string }> = {
  openai: {
    name: "OpenAI",
    endpoint: "https://api.openai.com/v1/chat/completions",
    modelsEndpoint: "https://api.openai.com/v1/models",
  },
};

const compatibleChatModels = new Set<string>(openAiModels);

export function getProviders(): ProvidersResponse {
  return { providers: [{ id: "openai", name: providers.openai.name }] };
}

const failures = {
  invalid_request: [400, "Invalid provider selection or request"],
  invalid_credentials: [400, "The provider rejected the API key"],
  unsupported_request: [400, "The provider does not support this model or request"],
  rate_limited: [429, "The provider's rate or usage limit was reached"],
  timeout: [504, "The provider request timed out"],
  cancelled: [499, "The provider request was cancelled"],
  unavailable: [502, "The provider is unavailable"],
  redirect_rejected: [502, "The provider returned a redirect"],
  invalid_response: [502, "The provider returned an invalid or incomplete response"],
  output_limit: [502, "The provider response exceeded its output limit"],
} as const;

export class ProviderError extends HttpError {
  public constructor(public readonly code: keyof typeof failures) {
    const [status, message] = failures[code];
    super(status, message);
    this.name = "ProviderError";
  }
}

export interface ProviderMessage {
  readonly role: "system" | "user" | "assistant";
  readonly content: string;
}

export interface ProviderRequest {
  readonly selection: ProviderSelection;
  readonly apiKey: string;
  readonly messages: readonly ProviderMessage[];
  readonly format?:
    "json" | { readonly name: string; readonly schema: Readonly<Record<string, unknown>> };
  readonly signal?: AbortSignal;
}

export interface ProviderAdapter {
  streamText(request: ProviderRequest): AsyncIterable<string>;
}

export interface ProviderModelDiscoveryAdapter {
  discoverModels(
    request: ProviderModelDiscoveryRequest & { readonly signal?: AbortSignal },
  ): Promise<readonly string[]>;
}

const timeoutMs = 120_000;
const maxRequestBytes = 64 * 1024;
const maxResponseBytes = 2 * 1024 * 1024;
const maxModelResponseBytes = 512 * 1024;

export function createProviderAdapter(
  fetcher: typeof fetch = fetch,
): ProviderAdapter & ProviderModelDiscoveryAdapter {
  return {
    async *streamText(request) {
      const selection = providerSelectionSchema.safeParse(request.selection);
      if (
        !selection.success ||
        typeof request.apiKey !== "string" ||
        !/^[\x21-\x7e]{1,4096}$/.test(request.apiKey) ||
        !Array.isArray(request.messages) ||
        request.messages.length === 0 ||
        request.messages.length > 100 ||
        request.messages.some(
          (message) =>
            !message ||
            !["system", "user", "assistant"].includes(message.role) ||
            typeof message.content !== "string",
        )
      ) {
        throw new ProviderError("invalid_request");
      }

      const body = JSON.stringify({
        model: selection.data.model,
        messages: request.messages.map(({ role, content }) => ({ role, content })),
        stream: true,
        store: false,
        max_completion_tokens: 4096,
        ...(request.format === "json"
          ? { response_format: { type: "json_object" } }
          : request.format === undefined
            ? {}
            : {
                response_format: {
                  type: "json_schema",
                  json_schema: {
                    name: request.format.name,
                    strict: true,
                    schema: request.format.schema,
                  },
                },
              }),
      });
      if (Buffer.byteLength(body) > maxRequestBytes) {
        throw new ProviderError("invalid_request");
      }

      const controller = new AbortController();
      const signal = request.signal
        ? AbortSignal.any([request.signal, controller.signal])
        : controller.signal;
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, timeoutMs);
      let response: Response | undefined;
      try {
        signal.throwIfAborted();
        response = await fetcher(providers[selection.data.providerId].endpoint, {
          method: "POST",
          redirect: "manual",
          headers: {
            authorization: `Bearer ${request.apiKey}`,
            "content-type": "application/json",
            accept: "text/event-stream",
          },
          body,
          signal,
        });
        if (response.status >= 300 && response.status < 400) {
          throw new ProviderError("redirect_rejected");
        }
        if (!response.ok) {
          throw new ProviderError(
            response.status === 401 || response.status === 403
              ? "invalid_credentials"
              : response.status === 429
                ? "rate_limited"
                : [400, 404, 422].includes(response.status)
                  ? "unsupported_request"
                  : "unavailable",
          );
        }
        if (
          response.body === null ||
          response.headers.get("content-type")?.split(";")[0]?.trim() !== "text/event-stream"
        ) {
          throw new ProviderError("invalid_response");
        }
        let finished = false;
        let hasText = false;
        for await (const data of readEvents(response.body)) {
          signal.throwIfAborted();
          if (data === "[DONE]") {
            if (!finished || !hasText) throw new ProviderError("invalid_response");
            return;
          }
          let chunk: unknown;
          try {
            chunk = JSON.parse(data);
          } catch {
            throw new ProviderError("invalid_response");
          }
          if (!isRecord(chunk) || !Array.isArray(chunk.choices) || chunk.error !== undefined) {
            throw new ProviderError("invalid_response");
          }
          if (chunk.choices.length === 0) continue;
          const choice: unknown = chunk.choices[0];
          if (
            finished ||
            chunk.choices.length !== 1 ||
            !isRecord(choice) ||
            choice.index !== 0 ||
            !isRecord(choice.delta)
          ) {
            throw new ProviderError("invalid_response");
          }
          const content = choice.delta.content ?? choice.delta.refusal;
          if (content !== undefined && content !== null) {
            if (typeof content !== "string") throw new ProviderError("invalid_response");
            if (content !== "") {
              hasText = true;
              yield content;
            }
          }
          if (choice.finish_reason === "length") throw new ProviderError("output_limit");
          if (choice.finish_reason !== undefined && choice.finish_reason !== null) {
            if (choice.finish_reason !== "stop") throw new ProviderError("invalid_response");
            finished = true;
          }
        }
        throw new ProviderError("invalid_response");
      } catch (error) {
        if (timedOut) throw new ProviderError("timeout");
        if (signal.aborted) throw new ProviderError("cancelled");
        if (error instanceof ProviderError) throw error;
        throw new ProviderError("unavailable");
      } finally {
        clearTimeout(timer);
        controller.abort();
        if (response?.body && !response.body.locked) {
          await response.body.cancel().catch(() => undefined);
        }
      }
    },
    discoverModels: (request) => discoverModels(request, fetcher),
  };
}

async function discoverModels(
  request: ProviderModelDiscoveryRequest & { readonly signal?: AbortSignal },
  fetcher: typeof fetch,
): Promise<readonly string[]> {
  const providerId = providerIdSchema.safeParse(request.providerId);
  if (!providerId.success || !isValidApiKey(request.apiKey)) {
    throw new ProviderError("invalid_request");
  }

  const controller = new AbortController();
  const signal = request.signal
    ? AbortSignal.any([request.signal, controller.signal])
    : controller.signal;
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  let response: Response | undefined;
  try {
    signal.throwIfAborted();
    response = await fetcher(providers[providerId.data].modelsEndpoint, {
      method: "GET",
      redirect: "manual",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${request.apiKey}`,
      },
      signal,
    });
    if (response.status >= 300 && response.status < 400) {
      throw new ProviderError("redirect_rejected");
    }
    if (!response.ok) throw providerErrorForStatus(response.status);
    if (response.body === null) throw new ProviderError("invalid_response");

    return parseModelList(await readResponseBody(response.body, signal));
  } catch (error) {
    if (timedOut) throw new ProviderError("timeout");
    if (signal.aborted) throw new ProviderError("cancelled");
    if (error instanceof ProviderError) throw error;
    throw new ProviderError("unavailable");
  } finally {
    clearTimeout(timer);
    controller.abort();
    if (response?.body && !response.body.locked) {
      await response.body.cancel().catch(() => undefined);
    }
  }
}

function parseModelList(body: string): readonly string[] {
  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    throw new ProviderError("invalid_response");
  }
  if (!isRecord(payload) || !Array.isArray(payload.data)) {
    throw new ProviderError("invalid_response");
  }

  const models: string[] = [];
  const seen = new Set<string>();
  for (const entry of payload.data) {
    if (!isRecord(entry) || typeof entry.id !== "string") continue;
    const parsedId = modelNameSchema.safeParse(entry.id);
    if (!parsedId.success || !compatibleChatModels.has(parsedId.data) || seen.has(parsedId.data)) {
      continue;
    }
    seen.add(parsedId.data);
    models.push(parsedId.data);
  }
  return models;
}

async function readResponseBody(
  body: ReadableStream<Uint8Array>,
  signal: AbortSignal,
): Promise<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let text = "";
  let bytes = 0;
  try {
    while (true) {
      signal.throwIfAborted();
      const part = await reader.read();
      bytes += part.value?.byteLength ?? 0;
      if (bytes > maxModelResponseBytes) throw new ProviderError("output_limit");
      try {
        text += decoder.decode(part.value, { stream: !part.done });
      } catch {
        throw new ProviderError("invalid_response");
      }
      if (part.done) return text;
    }
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

function providerErrorForStatus(status: number): ProviderError {
  return new ProviderError(
    status === 401 || status === 403
      ? "invalid_credentials"
      : status === 429
        ? "rate_limited"
        : [400, 404, 422].includes(status)
          ? "unsupported_request"
          : "unavailable",
  );
}

function isValidApiKey(value: unknown): value is string {
  return typeof value === "string" && /^[\x21-\x7e]{1,4096}$/.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function* readEvents(body: ReadableStream<Uint8Array>): AsyncIterable<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let buffer = "";
  let data: string[] = [];
  let bytes = 0;
  try {
    while (true) {
      const part = await reader.read();
      bytes += part.value?.byteLength ?? 0;
      if (bytes > maxResponseBytes) throw new ProviderError("output_limit");
      try {
        buffer += decoder.decode(part.value, { stream: !part.done });
      } catch {
        throw new ProviderError("invalid_response");
      }
      let newline: RegExpExecArray | null;
      const separator = part.done ? /\r\n|\n|\r/ : /\r\n|\n|\r(?!$)/;
      while ((newline = separator.exec(buffer)) !== null) {
        const line = buffer.slice(0, newline.index);
        buffer = buffer.slice(newline.index + newline[0].length);
        if (line === "") {
          if (data.length > 0) yield data.join("\n");
          data = [];
        } else if (line === "data" || line.startsWith("data:")) {
          data.push(line.slice(5).replace(/^ /, ""));
        }
      }
      if (part.done) break;
    }
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
