import type { ErrorRequestHandler, RequestHandler } from "express";

export class HttpError extends Error {
  public constructor(
    public readonly statusCode: number,
    message: string,
  ) {
    super(message);
  }
}

export const notFound: RequestHandler = (_request, _response, next) => {
  next(new HttpError(404, "Not found"));
};

export const handleError: ErrorRequestHandler = (error, request, response, next) => {
  if (response.headersSent) {
    next(error);
    return;
  }

  const knownError = error instanceof HttpError;
  const invalidJson = isInvalidJson(error);

  if (!knownError && !invalidJson) {
    request.log.error({ err: error }, "Unhandled request error");
  }

  response.status(knownError ? error.statusCode : invalidJson ? 400 : 500).json({
    error: knownError ? error.message : invalidJson ? "Invalid JSON" : "Internal server error",
  });
};

function isInvalidJson(error: unknown): boolean {
  return error instanceof SyntaxError && "status" in error && error.status === 400;
}
