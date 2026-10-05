import { useEffect, useId } from "react";

/**
 * Name search over the shift grid (`/e/:id/roster`). Matching is
 * `~/features/roster/search.ts#matchStaffIds`; this component owns only the
 * input and the "scroll the first hit into view" side effect.
 *
 * The scroll finds `[data-search-match="true"]` in the document rather than
 * taking a ref down through `StaffGrid`/`RoleGrid`: exactly one grid is
 * mounted at a time, and each already marks its own hits — the staff view its
 * column headers, the role view every name in a cell's lineup. `querySelector`
 * returns the first in DOM order, which is the leftmost/earliest hit either
 * way. Ref plumbing would mean two more props on both grids to move one
 * `scrollIntoView`.
 *
 * **Mount this with `key={view}`.** Switching views swaps the grid underneath,
 * and the remount is what re-runs the scroll against the newly rendered one —
 * there is deliberately no "which view" prop here.
 *
 * `block: "nearest"` keeps the page from jumping vertically when the hit is
 * already on screen; `inline: "center"` is what actually does the work in the
 * staff view, where the column sits off to the right and centring it clears
 * the sticky time column.
 */
export function GridSearch({
  query,
  onQueryChange,
  matchCount,
}: {
  query: string;
  onQueryChange: (value: string) => void;
  matchCount: number;
}) {
  const inputId = useId();
  const hasQuery = query.trim().length > 0;

  useEffect(() => {
    if (!query.trim() || matchCount === 0) return;
    const target = document.querySelector('[data-search-match="true"]');
    if (!target) return;
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    target.scrollIntoView({
      block: "nearest",
      inline: "center",
      behavior: reduced ? "auto" : "smooth",
    });
  }, [query, matchCount]);

  return (
    <div className="grid-search">
      <label className="sr-only" htmlFor={inputId}>
        スタッフ名で検索
      </label>
      <input
        id={inputId}
        type="search"
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
        placeholder="スタッフ名で検索"
        autoComplete="off"
      />
      {hasQuery ? (
        <output className="grid-search-status" data-empty={matchCount === 0}>
          {matchCount === 0 ? "該当するスタッフはいません" : `${matchCount}名が一致`}
        </output>
      ) : null}
    </div>
  );
}
