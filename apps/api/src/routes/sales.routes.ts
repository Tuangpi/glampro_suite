import { Router } from "express";
import {
  completeSaleSchema,
  createSaleSchema,
  emailSaleReceiptSchema,
  idParamSchema,
  saleItemSearchQuerySchema,
  saleListQuerySchema,
  voidSaleSchema,
  type CompleteSaleInput,
  type CreateSaleInput,
  type EmailSaleReceiptInput,
  type SaleItemSearchQuery,
  type SaleListQuery,
  type VoidSaleInput,
} from "@glampro_suite/shared";

import { auth, requireRole, requireWritableTenant } from "../middleware/auth.js";
import { requireModule } from "../middleware/requireModule.js";
import { receiptEmailLimiter } from "../middleware/rateLimit.js";
import { validate, validated } from "../middleware/validate.js";
import { unauthorized } from "../lib/http-error.js";
import { emailSaleReceipt } from "../services/receipt-email.service.js";
import {
  completeSale,
  createSale,
  discardHold,
  getSale,
  listSales,
  searchSaleItems,
  voidSale,
} from "../services/sale.service.js";

/**
 * Sales — handoff screens 01–02, `/api/sales`.
 *
 * Six routes, in four groups: the item search the cashier types into (5b.1); the write that
 * rings the cart up and the receipt it returns (5b.2); the hold flow that parks a cart,
 * lists the parked ones, rings one up later and abandons one (5g, ADR 0015); and the void
 * that takes a rung-up sale off the books (5h, ADR 0016).
 *
 * The guard is `sales`, a **core** module, so it always passes for a tenant. It is
 * mounted deliberately: it is what enters the tenant scope with the same refusal shape
 * as every other mount, and `requireModule("sales")` is the honest statement that this
 * path is the sales feature. What these routes do **not** do is refuse for the add-ons
 * the kinds belong to — `/items` leaves an unentitled kind out of the list and names it
 * in `searchableKinds`, while `POST /` refuses it outright. `sale.service.ts` holds the
 * reasoning for that asymmetry.
 *
 * Every write carries `requireWritableTenant()`: a suspended salon may read its history
 * but may not take money, which is the same rule every other write here follows. The
 * list and the single receipt do not — reading stays open (TENANCY.md §6).
 */
export const salesRouter = Router();

salesRouter.get(
  "/items",
  auth,
  requireModule("sales"),
  validate(saleItemSearchQuerySchema, "query"),
  async (req, res, next) => {
    try {
      const query = validated<SaleItemSearchQuery>(req, "query");
      res.status(200).json({ data: await searchSaleItems(query) });
    } catch (error) {
      next(error);
    }
  },
);

/**
 * The till's sale list — the parked carts, unless `?status=` says otherwise.
 *
 * Mounted **before** `/:id` deliberately, and for the reason the comment below gives: a
 * literal path stays ahead of a parameterised one.
 */
salesRouter.get(
  "/",
  auth,
  requireModule("sales"),
  validate(saleListQuerySchema, "query"),
  async (req, res, next) => {
    try {
      const query = validated<SaleListQuery>(req, "query");
      res.status(200).json({ data: await listSales(query) });
    } catch (error) {
      next(error);
    }
  },
);

/**
 * The receipt.
 *
 * Mounted **after** `/items` deliberately: the two paths are literals, but keeping the
 * static route first is what makes the intent obvious to the next reader rather than
 * leaving it to depend on segment names.
 */
salesRouter.get(
  "/:id",
  auth,
  requireModule("sales"),
  validate(idParamSchema, "params"),
  async (req, res, next) => {
    try {
      const { id } = validated<{ id: string }>(req, "params");
      res.status(200).json({ data: await getSale(id) });
    } catch (error) {
      next(error);
    }
  },
);

/**
 * `201` with the receipt as the body.
 *
 * `201` because a sale is a resource that now exists and has a URL of its own, and the
 * body is that receipt rather than a bare id — the confirmation screen is the receipt
 * (`docs/roadmap.md` → Phase 5d), so a client that has to re-fetch it before drawing
 * anything is doing a round trip for no reason.
 *
 * The cashier who rang the sale up is the signed-in user when the body does not name
 * one: `Sale.staffId` is "who rang it up", and a till that defaulted it to nothing
 * would leave every sale with no author.
 */
salesRouter.post(
  "/",
  auth,
  requireModule("sales"),
  requireWritableTenant(),
  validate(createSaleSchema),
  async (req, res, next) => {
    try {
      if (!req.user) throw unauthorized();
      const input = validated<CreateSaleInput>(req, "body");
      const receipt = await createSale({ ...input, staffId: input.staffId ?? req.user.id });
      res.status(201).json({ data: receipt });
    } catch (error) {
      next(error);
    }
  },
);

/**
 * Rings up a cart that was parked (ADR 0015).
 *
 * `200`, not `201`: the resource existed before this request — a hold is a row with an
 * id — so nothing was created. The body is the receipt, the same shape the write above
 * answers with, because the confirmation screen is one screen whichever path reached it.
 *
 * The cashier completing the sale is the signed-in user when the body names nobody: the
 * hold may have been parked by a colleague, and `Sale.staffId` is "who rang it up".
 */
salesRouter.post(
  "/:id/complete",
  auth,
  requireModule("sales"),
  requireWritableTenant(),
  validate(idParamSchema, "params"),
  validate(completeSaleSchema),
  async (req, res, next) => {
    try {
      if (!req.user) throw unauthorized();
      const { id } = validated<{ id: string }>(req, "params");
      const input = validated<CompleteSaleInput>(req, "body");
      const receipt = await completeSale(id, { ...input, staffId: input.staffId ?? req.user.id });
      res.status(200).json({ data: receipt });
    } catch (error) {
      next(error);
    }
  },
);

/**
 * Voids a rung-up sale (ADR 0016).
 *
 * `requireRole` is what puts this out of a cashier's reach: authorising your own reversal
 * is not a control, and the first admin-only write in this build (`staff.routes.ts`) is
 * the same rule.
 *
 * The reason arrives in the body and the actor does **not** — it is the verified token's
 * user, which is why `voidSale` takes them as two arguments rather than one object.
 */
salesRouter.post(
  "/:id/void",
  auth,
  requireModule("sales"),
  requireWritableTenant(),
  requireRole("SUPER_ADMIN", "MANAGER"),
  validate(idParamSchema, "params"),
  validate(voidSaleSchema),
  async (req, res, next) => {
    try {
      if (!req.user) throw unauthorized();
      const { id } = validated<{ id: string }>(req, "params");
      const { reason } = validated<VoidSaleInput>(req, "body");
      res.status(200).json({ data: await voidSale(id, { reason }, req.user.id) });
    } catch (error) {
      next(error);
    }
  },
);

/**
 * Emails a copy of a receipt (TK2610-0010).
 *
 * A receipt is a record, not a new sale: `200` with where it went, not `201`. The send is
 * a side effect with a provider cost, so it carries its own limiter; the body names only
 * the destination, and the receipt itself is read fresh under the caller's tenant scope.
 */
salesRouter.post(
  "/:id/receipt/email",
  auth,
  requireModule("sales"),
  requireWritableTenant(),
  receiptEmailLimiter,
  validate(idParamSchema, "params"),
  validate(emailSaleReceiptSchema),
  async (req, res, next) => {
    try {
      const { id } = validated<{ id: string }>(req, "params");
      const { email } = validated<EmailSaleReceiptInput>(req, "body");
      res.status(200).json({ data: await emailSaleReceipt(id, email) });
    } catch (error) {
      next(error);
    }
  },
);

/**
 * Abandons a parked cart.
 *
 * `200` with the deleted id rather than a bodyless `204`, because every other response
 * on this mount travels in the `{ data }` envelope and a caller that has to know which
 * shape it is holding is a caller that will get it wrong. `discardHold` refuses a sale
 * that is no longer held, so this cannot be used to delete a receipt.
 */
salesRouter.delete(
  "/:id",
  auth,
  requireModule("sales"),
  requireWritableTenant(),
  validate(idParamSchema, "params"),
  async (req, res, next) => {
    try {
      const { id } = validated<{ id: string }>(req, "params");
      await discardHold(id);
      res.status(200).json({ data: { id } });
    } catch (error) {
      next(error);
    }
  },
);
