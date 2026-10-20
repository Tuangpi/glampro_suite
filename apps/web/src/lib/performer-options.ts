interface Performer {
  id: string;
  name: string;
  email?: string | null;
}

/** Keep identities distinct: equal names are not evidence of duplicate accounts. */
export function performerOptions(people: readonly Performer[]) {
  const unique = [...new Map(people.map((person) => [person.id, person])).values()];
  const nameKey = (person: Performer) => person.name.trim().replace(/\s+/g, " ").toLowerCase();
  const counts = new Map<string, number>();
  for (const person of unique) {
    const key = nameKey(person);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  return unique.map((person) => ({
    value: person.id,
    label:
      (counts.get(nameKey(person)) ?? 0) > 1
        ? `${person.name} (${person.email?.trim() || person.id})`
        : person.name,
  }));
}
