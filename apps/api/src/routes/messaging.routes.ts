import { Router, type RequestHandler } from "express";
import rateLimit from "express-rate-limit";
import {
  renderCustomerReceiptPage,
  messagingSettingsSchema,
  channelConsentSchema,
  sendReceiptMessageSchema,
  bookingActionSchema,
} from "@glampro_suite/shared";
import { auth, requireRole, requireWritableTenant } from "../middleware/auth.js";
import { requireModule } from "../middleware/requireModule.js";
import { prisma } from "../lib/prisma.js";
import { runAsTenant } from "../lib/tenant-context.js";
import { forbidden, notFound } from "../lib/http-error.js";
import { verifyWebhook, messagingCapabilities } from "../lib/messaging-provider.js";
import {
  getMessagingSettings,
  tenantId,
  saveMessagingSettings,
  getChannelConsents,
  recordChannelConsent,
  issueLink,
  revokeLinks,
  withPublicLink,
  publicBookingAction,
  publicReceipt,
  queueReceipt,
  retryMessage,
} from "../services/messaging.service.js";
import { applyDeliveryStatus, inboundOptOut, withdrawChannel } from "../services/message-worker.js";

const handle =
  (fn: RequestHandler): RequestHandler =>
  (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
export const messagingRouter = Router();
messagingRouter.use(auth);
messagingRouter.get(
  "/capabilities",
  handle(async (_req, res) => {
    res.json({ data: messagingCapabilities(tenantId()) });
  }),
);
messagingRouter.get(
  "/settings",
  handle(async (_req, res) => {
    res.json({ data: await getMessagingSettings() });
  }),
);
messagingRouter.put(
  "/settings",
  requireWritableTenant(),
  requireRole("SUPER_ADMIN", "MANAGER"),
  handle(async (req, res) => {
    res.json({ data: await saveMessagingSettings(messagingSettingsSchema.parse(req.body)) });
  }),
);
messagingRouter.get(
  "/customers/:id",
  requireModule("customers"),
  handle(async (req, res) => {
    res.json({ data: await getChannelConsents(String(req.params.id)) });
  }),
);
messagingRouter.post(
  "/customers/:id",
  requireWritableTenant(),
  requireModule("customers"),
  handle(async (req, res) => {
    res.json({
      data: await recordChannelConsent(
        String(req.params.id),
        channelConsentSchema.parse(req.body),
        req.user!.id,
      ),
    });
  }),
);
messagingRouter.get(
  "/history",
  requireRole("SUPER_ADMIN", "MANAGER"),
  handle(async (req, res) => {
    const page = Math.max(1, Math.min(100000, Number(req.query.page) || 1));
    const [rows, total] = await Promise.all([
      prisma.messageJob.findMany({
        select: {
          id: true,
          kind: true,
          channel: true,
          status: true,
          attempts: true,
          errorCode: true,
          dueAt: true,
          createdAt: true,
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: (page - 1) * 20,
        take: 20,
      }),
      prisma.messageJob.count(),
    ]);
    res.json({ data: { rows, total, page } });
  }),
);
messagingRouter.post(
  "/history/:id/retry",
  requireWritableTenant(),
  requireRole("SUPER_ADMIN", "MANAGER"),
  handle(async (req, res) => {
    await retryMessage(String(req.params.id));
    res.json({ data: { queued: true } });
  }),
);
for (const [resource, kind, module] of [
  ["appointments", "BOOKING", "appointments"],
  ["sales", "RECEIPT", "sales"],
] as const) {
  messagingRouter.post(
    `/${resource}/:id/link`,
    requireWritableTenant(),
    requireModule(module),
    handle(async (req, res) => {
      res.status(201).json({ data: await issueLink(kind, String(req.params.id)) });
    }),
  );
  messagingRouter.delete(
    `/${resource}/:id/link`,
    requireWritableTenant(),
    requireModule(module),
    handle(async (req, res) => {
      await revokeLinks(kind, String(req.params.id));
      res.json({ data: { revoked: true } });
    }),
  );
}
messagingRouter.post(
  "/sales/:id/send",
  requireWritableTenant(),
  requireModule("sales"),
  handle(async (req, res) => {
    const { channel } = sendReceiptMessageSchema.parse(req.body);
    res.status(202).json({ data: await queueReceipt(String(req.params.id), channel) });
  }),
);

export const messagingWebhooksRouter = Router();
messagingWebhooksRouter.use(
  handle(async (req, _res, next) => {
    if (
      !req.is("application/x-www-form-urlencoded") ||
      !req.body ||
      Object.values(req.body).some((v) => typeof v !== "string")
    )
      throw forbidden();
    const id = req.path.split("/")[1] ?? "";
    if (!verifyWebhook(id, req.get("X-Twilio-Signature") ?? "", req.originalUrl, req.body))
      throw forbidden("Invalid webhook signature.");
    next();
  }),
);
messagingWebhooksRouter.post(
  "/:tenant/status/:id",
  handle(async (req, res) => {
    await runAsTenant(String(req.params.tenant), () =>
      applyDeliveryStatus(String(req.params.id), req.body),
    );
    res.sendStatus(204);
  }),
);
messagingWebhooksRouter.post(
  "/:tenant/inbound",
  handle(async (req, res) => {
    await runAsTenant(String(req.params.tenant), () => inboundOptOut(req.body));
    res.type("text/xml").send("<Response/>");
  }),
);

const escape = (value: unknown) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );

/** Up to two initials — the same fallback the web app's `SalonMark` draws. */
/**
 * The stylesheet every public page shares.
 *
 * Inline because these pages have no build step and no second request to spend: a
 * customer may be reading a receipt link once, on a phone, over a weak connection.
 * Templates stay data-only and every interpolation is escaped, so the only thing a
 * `style-src 'unsafe-inline'` can be made to do here is restyle the page.
 */
const PAGE_CSS = [
  "body{margin:0;background:#f8fafc;color:#111827;font-family:system-ui,-apple-system,'Segoe UI',sans-serif;font-size:15px;line-height:1.5}",
  "main{max-width:32rem;margin:0 auto;padding:2rem 1.25rem;background:#fff;min-height:100vh}",
  "h1{font-size:1.125rem;margin:0 0 .25rem}",
  ".mark{display:block;width:32px;height:32px;border-radius:8px;margin:0 0 .75rem;object-fit:contain}",
  ".initials{display:flex;align-items:center;justify-content:center;background:#111827;color:#fff;font-size:.8125rem;font-weight:600}",
  ".salon{margin:0 0 1rem;color:#374151;font-size:.875rem}",
  "ul{padding-left:1.25rem;margin:0 0 1rem}",
  "li{margin:.25rem 0}",
  "table{width:100%;border-collapse:collapse;margin:0 0 1rem}",
  "td{padding:.1875rem 0}",
  "td:last-child{text-align:right}",
  "tr.total td{font-weight:700;border-top:1px solid #e5e7eb;padding-top:.5rem}",
  "p{margin:.5rem 0}",
  "button{font:inherit;padding:.5rem .875rem;border-radius:8px;border:1px solid #111827;background:#111827;color:#fff;cursor:pointer}",
].join("");

const page = (title: string, body: string, mark = "") =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex,nofollow"><meta name="referrer" content="no-referrer"><title>${escape(title)}</title><style>${PAGE_CSS}</style></head><body><main>${mark}<h1>${escape(title)}</h1>${body}</main></body></html>`;
export const publicMessagingRouter = Router();
publicMessagingRouter.use(
  rateLimit({ windowMs: 60000, limit: 60, standardHeaders: "draft-8", legacyHeaders: false }),
);
publicMessagingRouter.use((_req, res, next) => {
  res.set({
    "Cache-Control": "no-store, private",
    "Referrer-Policy": "no-referrer",
    "X-Robots-Tag": "noindex, nofollow",
    "Content-Security-Policy":
      // `img-src 'self'` is the salon's logo — same origin, and the only image a
      // public page ever draws. `style-src 'unsafe-inline'` is the page's own
      // stylesheet and nothing else: scripts stay refused by `default-src 'none'`, so
      // an injected style can restyle the page and cannot read or send anything.
      "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
  });
  next();
});
publicMessagingRouter.get(
  "/:token",
  handle(async (req, res) => {
    const html = await withPublicLink(String(req.params.token), async (link) => {
      if (link.kind === "UNSUBSCRIBE")
        return page(
          "Messaging choices",
          '<p>Stop appointment updates, receipts and marketing on this channel?</p><form method="post" action="' +
            escape(req.originalUrl.split("?")[0]) +
            '/unsubscribe"><button>Unsubscribe from this channel</button></form>',
        );
      if (link.kind === "BOOKING") {
        const booking = await prisma.appointment.findFirst({
          where: { id: link.targetId, messageRevision: link.revision, status: "SCHEDULED" },
        });
        if (!booking) throw notFound("Booking link is no longer current.");
        const tenant = await prisma.tenant.findUniqueOrThrow({
          where: {
            id: (await prisma.publicLink.findFirstOrThrow({ where: { id: link.id } })).tenantId,
          },
        });
        const when = new Intl.DateTimeFormat(tenant.locale, {
          timeZone: tenant.timeZone,
          dateStyle: "full",
          timeStyle: "short",
        }).format(booking.startsAt);
        const settings = await getMessagingSettings();
        const canCancel =
          booking.startsAt.getTime() - Date.now() > settings.cancellationHours * 3600000;
        return page(
          tenant.name,
          `<p>${escape(when)}</p><p>${booking.customerConfirmedAt ? "Attendance confirmed." : "Please confirm your attendance."}</p><form method="post"><button name="action" value="confirm">Confirm attendance</button></form>${canCancel ? '<form method="get" action="' + escape(req.originalUrl.split("?")[0]) + '/cancel"><button>Cancel appointment…</button></form>' : "<p>Contact the salon to cancel.</p>"}`,
        );
      }
      const { sale, salon } = await publicReceipt(link.targetId);
      return renderCustomerReceiptPage(sale, salon);
    });
    res.type("html").send(html);
  }),
);
publicMessagingRouter.get(
  "/:token/cancel",
  handle(async (req, res) => {
    await withPublicLink(String(req.params.token), async (link) => {
      if (link.kind !== "BOOKING") throw notFound();
    });
    res
      .type("html")
      .send(
        page(
          "Cancel appointment?",
          '<p>This will cancel your booking. No fee is charged by this action.</p><form method="post" action="../' +
            escape(req.params.token) +
            '"><button name="action" value="cancel">Yes, cancel appointment</button></form>',
        ),
      );
  }),
);
publicMessagingRouter.post(
  "/:token",
  handle(async (req, res) => {
    const { action } = bookingActionSchema.parse(req.body);
    await withPublicLink(String(req.params.token), (link) => publicBookingAction(link, action));
    res
      .type("html")
      .send(
        page(
          action === "cancel" ? "Appointment cancelled" : "Attendance confirmed",
          "<p>Your choice has been saved.</p>",
        ),
      );
  }),
);
publicMessagingRouter.post(
  "/:token/unsubscribe",
  handle(async (req, res) => {
    await withPublicLink(String(req.params.token), async (link) => {
      if (link.kind !== "UNSUBSCRIBE") throw notFound();
      await withdrawChannel(link.targetId);
    });
    res
      .type("html")
      .send(page("Unsubscribed", "<p>This channel's messaging permission has been withdrawn.</p>"));
  }),
);
