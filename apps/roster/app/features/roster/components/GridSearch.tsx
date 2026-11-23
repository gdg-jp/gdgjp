import { useEffect, useId } from "react";

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
