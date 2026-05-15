import { useTranslation } from "react-i18next";
import { Link } from "react-router";

interface TagChipProps {
  tagSlug: string;
  labelJa: string;
  labelEn: string;
  color: string;
  /** Preserve a text query in the /search?tag= URL */
  q?: string;
  /** sm = compact (px-2 py-0.5), md = normal (px-2.5 py-1) */
  size?: "sm" | "md";
  /** Optionally display a page count after the label */
  pageCount?: number;
  onClick?: React.MouseEventHandler<HTMLAnchorElement>;
}

export default function TagChip({
  tagSlug,
  labelJa,
  labelEn,
  color,
  q,
  size = "sm",
  pageCount,
  onClick,
}: TagChipProps) {
  const { i18n } = useTranslation();
  const label = i18n.language === "ja" ? labelJa : labelEn;
  const to = `/search?tag=${tagSlug}${q ? `&q=${encodeURIComponent(q)}` : ""}`;
  const padding = size === "md" ? "px-2.5 py-1" : "px-2 py-0.5";

  return (
    <Link
      to={to}
      className={`inline-flex items-center gap-1 rounded-full ${padding} text-xs font-medium text-white hover:opacity-80 transition-opacity`}
      style={{ backgroundColor: color }}
      onClick={onClick}
    >
      {label}
      {pageCount != null && pageCount > 0 && <span className="opacity-70">({pageCount})</span>}
    </Link>
  );
}
