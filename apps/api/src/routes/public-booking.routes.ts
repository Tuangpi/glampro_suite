import { Router, type Request, type Response } from "express";
import { publicAvailabilitySchema, publicBookingSchema } from "../schemas/public-booking.js";

import {
  getPublicBookingConfig,
  getPublicAvailability,
  createPublicBooking,
} from "../services/public-booking.service.js";
import { getPublicSalonLogo } from "../services/settings.service.js";

const handle =
  (
    fn: (req: Request, res: Response) => Promise<void>,
  ): ((req: Request, res: Response, next: (err?: unknown) => void) => void) =>
  (req, res, next) => {
    Promise.resolve(fn(req, res)).catch(next);
  };

export const publicBookingRouter = Router();

async function configHandler(req: Request, res: Response) {
  const slug = String(req.params.slug);
  const data = await getPublicBookingConfig(slug);
  res.json({ data });
}

async function availabilityHandler(req: Request, res: Response) {
  const slug = String(req.params.slug);
  const query = publicAvailabilitySchema.parse(req.query);
  const data = await getPublicAvailability(slug, query);
  res.json({ data });
}

async function createHandler(req: Request, res: Response) {
  const slug = String(req.params.slug);
  const body = publicBookingSchema.parse(req.body);
  const data = await createPublicBooking(slug, body);
  res.status(201).json({ data });
}

/**
 * The salon's logo, for the public booking page, the public receipt link and the
 * emailed receipt.
 *
 * Unauthenticated by design — the people who need it are a customer holding a
 * receipt link and an email client fetching a remote image. `nosniff` and an
 * explicit `Content-Disposition: inline` keep it from being re-interpreted as
 * anything but an image, and the five-minute public cache is short enough that a
 * re-upload lands quickly (`logoUrl` carries the `updatedAt` as a version marker,
 * so the URL changes when the image does).
 */
async function logoHandler(req: Request, res: Response) {
  const slug = String(req.params.slug);
  const logo = await getPublicSalonLogo(slug);
  res.set({
    "Content-Type": logo.mimeType,
    "Cache-Control": "public, max-age=300",
    "X-Content-Type-Options": "nosniff",
    "Content-Disposition": "inline",
  });
  res.send(logo.content);
}

const bases = [
  "/booking/:slug",
  "/tenants/:slug",
  "/tenants/:slug/booking",
  "/online-booking/:slug",
];

for (const base of bases) {
  publicBookingRouter.get(base, handle(configHandler));
  publicBookingRouter.get(`${base}/availability`, handle(availabilityHandler));
  publicBookingRouter.get(`${base}/config`, handle(configHandler));
  publicBookingRouter.post(base, handle(createHandler));
}

// No `/booking/:slug/logo` alias: the logo's one home is the tenant, because the
// emailed receipt and the public receipt page both address a salon by slug and the
// booking prefix exists only for the booking API's own clients.
publicBookingRouter.get("/tenants/:slug/logo", handle(logoHandler));
