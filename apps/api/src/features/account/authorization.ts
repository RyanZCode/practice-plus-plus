import type { RequestHandler } from "express";

import { HttpError } from "../../shared/errors.js";
import { getApplicationProfile } from "./profile.js";

export const requireAdministrator: RequestHandler = (request, _response, next) => {
  if (getApplicationProfile(request).role !== "ADMINISTRATOR") {
    next(new HttpError(403, "Forbidden"));
    return;
  }

  next();
};
