import type { ErrorRequestHandler, RequestHandler } from "express";
import { ZodError } from "zod";

import { HttpError } from "../lib/http-error.js";
import { isProduction } from "../lib/env.js";
import { logger } from "../lib/logger.js";

/** 404 handler — placed after every route so unmatched paths get a JSON body. */
export const notFoundHandler: RequestHandler = (req, res) => {
  res.status(404).json({
    statusCode: 404,
    message: `Cannot ${req.method} ${req.path}`,
    code: "NOT_FOUND",
  });
};

/**
 * Terminal error handler. Must keep the 4-argument signature so Express
 * recognises it as an error middleware.
 */
export const errorHandler: ErrorRequestHandler = (error, req, res, _next) => {
  if (error instanceof HttpError) {
    res.status(error.statusCode).json({
      statusCode: error.statusCode,
      message: error.message,
      ...(error.code ? { code: error.code } : {}),
      ...(error.details !== undefined ? { details: error.details } : {}),
    });
    return;
  }

  if (error instanceof ZodError) {
    res.status(422).json({
      statusCode: 422,
      message: "Validation failed",
      code: "VALIDATION_FAILED",
      details: error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })),
    });
    return;
  }

  // Prisma surfaces unique-constraint violations as P2002; map it to a 409 so
  // callers get an actionable response instead of a generic 500.
  if (typeof error === "object" && error !== null && "code" in error && error.code === "P2002") {
    res.status(409).json({
      statusCode: 409,
      message: "That record already exists.",
      code: "CONFLICT",
    });
    return;
  }

  logger.error("Unhandled request error", {
    method: req.method,
    path: req.path.startsWith("/api/public/messages/")
      ? "/api/public/messages/[redacted]"
      : req.path,
    error: req.path.startsWith("/api/public/messages/") ? "Public link request failed" : error,
  });

  res.status(500).json({
    statusCode: 500,
    message:
      isProduction || req.path.startsWith("/api/public/messages/")
        ? "Internal server error"
        : String(error),
    code: "INTERNAL_ERROR",
  });
};
