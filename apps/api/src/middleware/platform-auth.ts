import type { RequestHandler } from "express";
import { unauthorized } from "../lib/http-error.js";
import { authenticatePlatform } from "../services/platform-auth.service.js";

/** Authenticate the operator without entering an unrestricted database scope. */
export const platformAuth: RequestHandler = async (req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  try {
    const header = req.headers.authorization;
    if (!header?.startsWith("Bearer ") || !header.slice(7).trim()) throw unauthorized();
    res.locals.platformAdmin = await authenticatePlatform(header.slice(7).trim());
    next();
  } catch (error) {
    next(error);
  }
};
