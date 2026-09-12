import { Button } from "../Button";

export function Pagination({
  page,
  pageCount,
  onPageChange,
  label = "ページ切替",
}: { page: number; pageCount: number; onPageChange: (page: number) => void; label?: string }) {
  return (
    <nav className="gdg-inline" aria-label={label}>
      <Button variant="outline" disabled={page <= 1} onClick={() => onPageChange(page - 1)}>
        前へ
      </Button>
      <span aria-live="polite">
        {pageCount === 0 ? 0 : page} / {pageCount}
      </span>
      <Button variant="outline" disabled={page >= pageCount} onClick={() => onPageChange(page + 1)}>
        次へ
      </Button>
    </nav>
  );
}
