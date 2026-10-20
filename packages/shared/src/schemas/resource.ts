/**
 * Rooms and equipment — TK2610-0020 phase D, `/api/resources`.
 *
 * A resource is the other half of "one party per window": phase B gave every
 * service line a performer, and this gives it a room or a machine. The two
 * rules are deliberately the same shape, so a salon describes *which* resources a
 * service may use and the server picks one that is free, exactly as it picks a
 * performer from the service's department (ADR 0013) and rejects an overlap for
 * either (ADR 0014).
 *
 * **Rooms and equipment share one contract.** They differ only in the word the
 * screen prints; the occupancy rule, the archive-by-status rule and the overlap
 * rule are identical, so a second model would be a second thing to keep in step.
 */
import { z } from "zod";

import { catalogStatusSchema } from "./catalogue.js";

/** Mirrors the `ResourceKind` database enum. */
export const RESOURCE_KINDS = ["ROOM", "EQUIPMENT"] as const;

export const resourceKindSchema = z.enum(RESOURCE_KINDS);

export type ResourceKindValue = z.infer<typeof resourceKindSchema>;

/**
 * Guard against a client loop when a whole catalogue is ticked onto one room.
 * A salon with more than this many services on a single resource needs a second
 * resource, not a longer list.
 */
export const MAX_RESOURCE_SERVICES = 200;

/**
 * One room or piece of equipment.
 *
 * `serviceIds` is the **eligibility** set — the services that may be performed
 * here — not a schedule and not a list of simultaneous needs. A booking takes one
 * resource from the set that is free for the line's window.
 */
export const resourceSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  kind: resourceKindSchema,
  /** `INACTIVE` is the archive: existing bookings keep what they hold. */
  status: catalogStatusSchema,
  serviceIds: z.array(z.string()),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type ResourceSummary = z.infer<typeof resourceSummarySchema>;

/** The editor needs no columns the list does not have. */
export const resourceDetailSchema = resourceSummarySchema;

export type ResourceDetail = z.infer<typeof resourceDetailSchema>;

/** `?kind=&status=&search=` — the list is short, so it is not paginated. */
export const resourceListQuerySchema = z.object({
  kind: resourceKindSchema.optional(),
  status: catalogStatusSchema.optional(),
  search: z.string().trim().max(200).optional(),
});

export type ResourceListQuery = z.infer<typeof resourceListQuerySchema>;

export const createResourceSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(120),
  kind: resourceKindSchema.default("ROOM"),
  status: catalogStatusSchema.optional(),
  /** Absent = none of the catalogue may use it yet. */
  serviceIds: z.array(z.string().min(1).max(64)).max(MAX_RESOURCE_SERVICES).optional(),
});

export type CreateResourceInput = z.infer<typeof createResourceSchema>;

/**
 * Updating a resource. Absent means unchanged — the PATCH rule every other
 * editor keeps. `serviceIds` **replaces** the set outright, because a checkbox
 * list only ever sends the boxes that were ticked.
 *
 * There is no `null` for `serviceIds`: an empty array is how "no service uses
 * this room" is said, which is a real state (`status: INACTIVE` is the archive,
 * not an empty set).
 */
export const updateResourceSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(120).optional(),
  kind: resourceKindSchema.optional(),
  status: catalogStatusSchema.optional(),
  serviceIds: z.array(z.string().min(1).max(64)).max(MAX_RESOURCE_SERVICES).optional(),
});

export type UpdateResourceInput = z.infer<typeof updateResourceSchema>;
