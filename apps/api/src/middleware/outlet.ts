import type { RequestHandler } from "express";
import { forbidden, notFound, validationFailed } from "../lib/http-error.js";
import { prisma } from "../lib/prisma.js";
import { runAtOutlet } from "../lib/tenant-context.js";

/** Tenant roles apply at all of that tenant's outlets; no client-supplied tenant id. */
export const outletContext: RequestHandler = async (req, _res, next) => {
  try {
    const outletId = req.headers["x-outlet-id"];
    if (outletId === undefined) {
      next();
      return;
    }
    if (typeof outletId !== "string" || !/^[a-zA-Z0-9_-]{1,64}$/.test(outletId)) {
      throw validationFailed([
        { path: "headers.x-outlet-id", message: "Invalid outlet selection." },
      ]);
    }
    const outlet = await prisma.outlet.findFirst({
      where: { id: outletId },
      select: { id: true, status: true },
    });
    if (!outlet) throw notFound("That outlet is not available.", "OUTLET_NOT_FOUND");
    if (outlet.status !== "ACTIVE")
      throw forbidden("That outlet is suspended.", "OUTLET_SUSPENDED");
    runAtOutlet(outlet.id, next);
  } catch (error) {
    next(error);
  }
};
