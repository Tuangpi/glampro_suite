import { Router, type Request, type Response } from "express";
import { publicAvailabilitySchema, publicBookingSchema } from "../schemas/public-booking.js";

import {
  getPublicBookingConfig,
  getPublicAvailability,
  createPublicBooking,
} from "../services/public-booking.service.js";

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
