import cors from "cors";
import express, { type Express } from "express";
import helmet from "helmet";
import { API_PREFIX } from "@glampro_suite/shared";

import { env } from "./lib/env.js";
import {
  messagingRouter,
  messagingWebhooksRouter,
  publicMessagingRouter,
} from "./routes/messaging.routes.js";
import { appointmentsRouter } from "./routes/appointments.routes.js";
import { publicBookingRouter } from "./routes/public-booking.routes.js";

import { authRouter } from "./routes/auth.routes.js";
import { customersRouter } from "./routes/customers.routes.js";
import { departmentsRouter } from "./routes/departments.routes.js";
import { giftCardsRouter } from "./routes/gift-cards.routes.js";
import { healthRouter, readiness } from "./routes/health.routes.js";
import { packagesRouter } from "./routes/packages.routes.js";
import { productsRouter } from "./routes/products.routes.js";
import { reportsRouter } from "./routes/reports.routes.js";
import { resourcesRouter } from "./routes/resources.routes.js";
import { salesRouter } from "./routes/sales.routes.js";
import { servicesRouter } from "./routes/services.routes.js";
import { settingsRouter } from "./routes/settings.routes.js";
import { shiftsRouter } from "./routes/shifts.routes.js";
import { staffRouter } from "./routes/staff.routes.js";
import { vouchersRouter } from "./routes/vouchers.routes.js";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler.js";
import { apiLimiter } from "./middleware/rateLimit.js";

/**
 * Builds the Express application without binding a port, so tests can import
 * it directly and `index.ts` owns the listen/shutdown lifecycle.
 */
export function createApp(): Express {
  const app = express();

  // nginx terminates TLS and forwards the real client IP.
  app.set("trust proxy", 1);
  app.disable("x-powered-by");

  // The SPA is served by Vite/nginx, not this process, so CSP is disabled here.
  // CORP is relaxed so images served from /uploads render in the portal.
  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginResourcePolicy: { policy: "cross-origin" },
    }),
  );

  // Strict CORS: only origins listed in CORS_ORIGINS. Requests without an
  // Origin header (curl, same-origin, native mobile clients) are allowed.
  app.use(
    cors({
      origin: (origin, callback) => {
        if (!origin || env.corsOrigins.includes(origin)) {
          callback(null, true);
          return;
        }
        callback(new Error("Origin not allowed by CORS"));
      },
      credentials: true,
      methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      allowedHeaders: ["Content-Type", "Authorization"],
    }),
  );

  app.use(express.json({ limit: "2mb" }));
  app.use(express.urlencoded({ extended: true, limit: "2mb" }));

  // Throttle before any route work happens.
  app.use(API_PREFIX, apiLimiter);

  // Static uploads (avatars, product images) served by the API in development
  // and proxied by nginx in production.
  app.use("/uploads", express.static(env.uploadsDir, { maxAge: "7d" }));

  // Probes.
  app.use("/health", healthRouter);
  app.get(`${API_PREFIX}/health`, readiness);

  // Feature routes. Each phase mounts its router here.
  app.use(`${API_PREFIX}/auth`, authRouter);
  app.use(`${API_PREFIX}/messaging/webhooks`, messagingWebhooksRouter);
  app.use(`${API_PREFIX}/public/messages`, publicMessagingRouter);
app.use(`${API_PREFIX}/public`, publicBookingRouter);

  app.use(`${API_PREFIX}/messaging`, messagingRouter);
  app.use(`${API_PREFIX}/customers`, customersRouter);
  // Screen 08 is one screen with two tabs, so it is two mounts: products and
  // services are separate resources that share the `catalogue` entitlement.
  app.use(`${API_PREFIX}/products`, productsRouter);
  app.use(`${API_PREFIX}/services`, servicesRouter);
  app.use(`${API_PREFIX}/departments`, departmentsRouter);
  // Screen 09. Reads are open to the salon; the writes are the first routes in the
  // app to mount `requireRole` (Q26).
  app.use(`${API_PREFIX}/staff`, staffRouter);
  // Screen 08's last two tabs. Both are **add-ons**, so these two mounts are the
  // first routes whose `requireModule` can actually refuse: every other module they
  // sit beside is core and passes as soon as the tenant exists.
  app.use(`${API_PREFIX}/packages`, packagesRouter);
  app.use(`${API_PREFIX}/gift-cards`, giftCardsRouter);
  // Screens 01–02. The till's item search (5b.1) is the first route that has to decide
  // what to do about an add-on it *partly* needs: two of the five kinds it searches are
  // add-ons, so it omits them and says so rather than refusing the whole request the way
  // the two mounts above do.
  app.use(`${API_PREFIX}/sales`, salesRouter);
  // Voucher campaigns (ADR 0020). Reads are open so the till can list running codes;
  // writes are manager-only, and the till itself only ever previews one on a cart.
  app.use(`${API_PREFIX}/vouchers`, vouchersRouter);
  // Screens 03 and 06. A booking's duration and eligible performers come from
  // the service (M2), so this mount is the boundary that refuses them rather
  // than trusting the list the form sent (ADR 0013).
  app.use(`${API_PREFIX}/appointments`, appointmentsRouter);
  // Rooms and equipment (phase D). Mounted beside appointments because a booking
  // is what occupies them: the same entitlement guards both, and the writes inside
  // are manager-only in the same way the staff screen's are.
  app.use(`${API_PREFIX}/resources`, resourcesRouter);
  // The rota screens 06 and 09 draw. Mounted beside appointments because the
  // calendar is its main reader, but guarded by `staff`: a shift is a fact about
  // who works when, and a stylist may read their own hours while only a manager
  // publishes them.
  app.use(`${API_PREFIX}/shifts`, shiftsRouter);
  // Screen 05's tiles. Guarded by the core `dashboard` module, not the `reports`
  // add-on: every salon has a dashboard, and the add-on gates screen 10's tables.
  app.use(`${API_PREFIX}/reports`, reportsRouter);
  // Screen 11. The only router without a `requireModule`: the salon's own
  // configuration is not a switchable feature, so it is never entitlement-hidden.
  app.use(`${API_PREFIX}/settings`, settingsRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
