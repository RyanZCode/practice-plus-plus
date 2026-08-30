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

  if (!knownError) {
    request.log.error({ err: error }, "Unhandled request error");
  }

  response.status(knownError ? error.statusCode : 500).json({
    error: knownError ? error.message : "Internal server error",
  });
};
