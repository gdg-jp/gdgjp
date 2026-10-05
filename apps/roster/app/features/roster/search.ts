/**
 * Name search over the shift grids (`/e/:id/roster`, `/r/:viewToken`). Pure —
 * no D1, no React — so the matching rule is testable on its own and both the
 * staff view and the role view highlight exactly the same set of people.
 *
 * Whitespace is stripped from BOTH sides of the comparison, not just trimmed
 * at the ends: staff names are stored with an inner space (`佐藤 陽菜`), and
 * someone searching for a person types their name the way they say it
 * (`佐藤陽菜`) at least as often as the way it was registered.
 */

/**
 * Folds the three ways the same Japanese name gets typed into one form:
 *
 * - **NFKC** collapses width — full-width `Ａｌｉｃｅ` to `alice`, half-width
 *   `ｶﾄｳ` to `カトウ`. Without it a phone IME's full-width digits and latin
 *   never match a name registered in half-width.
 * - **Katakana to hiragana** (a flat +0x60 offset over the katakana block)
 *   so `サトウ` finds `さとう`. Which of the two a person uses is a habit,
 *   not a distinction they expect the search to enforce.
 * - Case, then all whitespace — see the module doc for why inner spaces go.
 */
export function normalizeName(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[ァ-ヶ]/gu, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60))
    .replace(/\s+/gu, "");
}

/**
 * Application ids whose name contains `query`.
 *
 * An empty (or whitespace-only) query returns an EMPTY set, never "all" —
 * the result feeds a highlight, and highlighting every row when the box is
 * empty would be the opposite of what the control is for.
 */
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
