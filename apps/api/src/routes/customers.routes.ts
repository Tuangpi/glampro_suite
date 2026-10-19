import { Router } from "express";
import {
  createCustomerSchema,
  customerListQuerySchema,
  idParamSchema,
  updateCustomerSchema,
  type CreateCustomerInput,
  type CustomerListQuery,
  type UpdateCustomerInput,
} from "@glampro_suite/shared";

import { auth, requireWritableTenant } from "../middleware/auth.js";
import { requireModule } from "../middleware/requireModule.js";
import { validate, validated } from "../middleware/validate.js";
import { unauthorized } from "../lib/http-error.js";
import {
  createCustomer,
  getCustomer,
  getCustomerHoldings,
  listCustomers,
  updateCustomer,
} from "../services/customer.service.js";

/**
 * Customers — handoff screen 07.
 *
 * Reads are open to every signed-in member of the salon; writes additionally
 * require a writable tenant, because a `SUSPENDED` salon may look at its data but
 * must not change it (`docs/saas/TENANCY.md` §6).
 *
 * `requireModule("customers")` is the entitlement boundary — hiding the rail entry
 * is a convenience, this is the rule. `customers` is a core module, so a tenant
 * that exists passes it.
 */
export const customersRouter = Router();

customersRouter.get(
  "/",
  auth,
  requireModule("customers"),
  validate(customerListQuerySchema, "query"),
  async (req, res, next) => {
    try {
      const query = validated<CustomerListQuery>(req, "query");
      res.status(200).json({ data: await listCustomers(query) });
    } catch (error) {
      next(error);
    }
  },
);

customersRouter.get(
  "/:id/holdings",
  auth,
  requireModule("customers"),
  validate(idParamSchema, "params"),
  async (req, res, next) => {
    try {
      const { id } = validated<{ id: string }>(req, "params");
      res.status(200).json({ data: await getCustomerHoldings(id) });
    } catch (error) {
      next(error);
    }
  },
);

customersRouter.get(
  "/:id",
  auth,
  requireModule("customers"),
  validate(idParamSchema, "params"),
  async (req, res, next) => {
    try {
      const { id } = validated<{ id: string }>(req, "params");
      res.status(200).json({ data: await getCustomer(id) });
    } catch (error) {
      next(error);
    }
  },
);

customersRouter.post(
  "/",
  auth,
  requireModule("customers"),
  requireWritableTenant(),
  validate(createCustomerSchema),
  async (req, res, next) => {
    try {
      if (!req.user) throw unauthorized();

      const input = validated<CreateCustomerInput>(req, "body");
      res.status(201).json({ data: await createCustomer(input) });
    } catch (error) {
      next(error);
    }
  },
);

customersRouter.patch(
  "/:id",
  auth,
  requireModule("customers"),
  requireWritableTenant(),
  validate(idParamSchema, "params"),
  validate(updateCustomerSchema),
  async (req, res, next) => {
    try {
      if (!req.user) throw unauthorized();

      const { id } = validated<{ id: string }>(req, "params");
      const input = validated<UpdateCustomerInput>(req, "body");
      res.status(200).json({ data: await updateCustomer(id, input) });
    } catch (error) {
      next(error);
    }
  },
);
