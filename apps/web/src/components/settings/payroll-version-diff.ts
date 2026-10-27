type Change = { path: string; before: unknown; after: unknown };

/** Keyed rule arrays compare by stable identity; band/award rows retain their order. */
export function payrollDefinitionChanges(
  before: unknown,
  after: unknown,
  path = "definition",
): Change[] {
  if (JSON.stringify(before) === JSON.stringify(after)) return [];
  if (Array.isArray(before) && Array.isArray(after)) {
    const keyed = [...before, ...after].every(
      (item) => item && typeof item === "object" && typeof item.key === "string",
    );
    if (keyed) {
      const left = new Map(before.map((item) => [item.key, item]));
      const right = new Map(after.map((item) => [item.key, item]));
      return [...new Set([...left.keys(), ...right.keys()])].flatMap((key) =>
        payrollDefinitionChanges(left.get(key), right.get(key), `${path}[${key}]`),
      );
    }
  }
  if (
    before &&
    after &&
    !Array.isArray(before) &&
    !Array.isArray(after) &&
    typeof before === "object" &&
    typeof after === "object"
  ) {
    const left = before as Record<string, unknown>;
    const right = after as Record<string, unknown>;
    return [...new Set([...Object.keys(left), ...Object.keys(right)])].flatMap((key) =>
      payrollDefinitionChanges(left[key], right[key], `${path}.${key}`),
    );
  }
  return [{ path, before, after }];
}
