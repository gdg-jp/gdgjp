export function normalizeName(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[ァ-ヶ]/gu, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60))
    .replace(/\s+/gu, "");
}

export function matchStaffIds(
  query: string,
  staff: Iterable<{ id: string; name: string }>,
): Set<string> {
  const needle = normalizeName(query);
  const matched = new Set<string>();
  if (!needle) return matched;
  for (const person of staff) {
    if (normalizeName(person.name).includes(needle)) matched.add(person.id);
  }
  return matched;
}
