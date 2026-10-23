import { z } from "zod";
import type { PackageRules } from "@glampro_suite/shared";

const rulesSchema = z.object({
  mode: z.enum(["PER_UNIT", "SERVICE_SET"]),
  requirements: z.array(z.object({ serviceId: z.string(), quantity: z.number().int().positive() })),
});

export function holdingPackageRules(
  snapshot: unknown,
  services: readonly { serviceId: string }[],
): PackageRules {
  return snapshot == null
    ? {
        mode: "PER_UNIT",
        requirements: services.map(({ serviceId }) => ({ serviceId, quantity: 1 })),
      }
    : rulesSchema.parse(snapshot);
}
