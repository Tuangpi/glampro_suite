import { Router } from "express";
import {
  createVoucherSchema,
  idParamSchema,
  updateVoucherSchema,
  voucherListQuerySchema,
  type CreateVoucherInput,
  type UpdateVoucherInput,
  type VoucherListQuery,
} from "@glampro_suite/shared";

import { auth, requireRole, requireWritableTenant } from "../middleware/auth.js";
import { validate, validated } from "../middleware/validate.js";
import { unauthorized } from "../lib/http-error.js";
import {
  createVoucher,
  getVoucher,
  listVouchers,
  updateVoucher,
} from "../services/voucher.service.js";

/**
 * Vouchers — manager-published discount campaigns (ADR 0020).
 *
 * Reads are open to every signed-in member of the salon: the till has to be able to
 * list what is running before it can ring a code up. Creating and changing a campaign
 * is a **manager's** act, the same `requireRole("SUPER_ADMIN", "MANAGER")` boundary the
 * void route uses, because a cashier who could publish their own code could discount
 * their own sale.
 *
 * There is no `DELETE`: a campaign that must stop is switched off with
 * `PATCH { isActive: false }`, so its redemption history keeps pointing at a row that
 * still exists. A hard delete would orphan `VoucherRedemption` or be refused by the
 * `Restrict` on its foreign key.
 */
export const vouchersRouter = Router();

vouchersRouter.get("/", auth, validate(voucherListQuerySchema, "query"), async (req, res, next) => {
  try {
    const query = validated<VoucherListQuery>(req, "query");
    res.status(200).json({ data: await listVouchers(query) });
  } catch (error) {
    next(error);
  }
});

vouchersRouter.get("/:id", auth, validate(idParamSchema, "params"), async (req, res, next) => {
  try {
    const { id } = validated<{ id: string }>(req, "params");
    res.status(200).json({ data: await getVoucher(id) });
  } catch (error) {
    next(error);
  }
});

vouchersRouter.post(
  "/",
  auth,
  requireWritableTenant(),
  requireRole("SUPER_ADMIN", "MANAGER"),
  validate(createVoucherSchema),
  async (req, res, next) => {
    try {
      if (!req.user) throw unauthorized();

      const input = validated<CreateVoucherInput>(req, "body");
      res.status(201).json({ data: await createVoucher(input, req.user.id) });
    } catch (error) {
      next(error);
    }
  },
);

vouchersRouter.patch(
  "/:id",
  auth,
  requireWritableTenant(),
  requireRole("SUPER_ADMIN", "MANAGER"),
  validate(idParamSchema, "params"),
  validate(updateVoucherSchema),
  async (req, res, next) => {
    try {
      const { id } = validated<{ id: string }>(req, "params");
      const input = validated<UpdateVoucherInput>(req, "body");
      res.status(200).json({ data: await updateVoucher(id, input) });
    } catch (error) {
      next(error);
    }
  },
);
