import { useTranslation } from "react-i18next";
import SourceListItem, { type SourceListItemSource } from "./SourceListItem";

type Chapter = { id: string; nameJa: string; nameEn: string };

export default function SourceList({
  sources,
  expanded,
  onToggle,
  assignableChapters,
  allChapters,
  currentUserId,
  isAdmin,
  language,
  emptyMessage,
}: {
  sources: SourceListItemSource[];
  expanded: Record<string, boolean>;
  onToggle: (sourceId: string) => void;
  assignableChapters: Chapter[];
  allChapters: Chapter[];
  currentUserId: string;
  isAdmin: boolean;
  language: string;
  emptyMessage: string;
}) {
  const { t } = useTranslation();

  if (sources.length === 0) {
    return <p className="text-sm text-content-tertiary">{emptyMessage}</p>;
  }

  return (
    <ul
      className="overflow-hidden rounded-lg border border-border-default bg-surface-raised"
      aria-label={t("sources.title")}
    >
      {sources.map((source) => (
        <SourceListItem
          key={source.id}
          source={source}
          open={expanded[source.id] ?? false}
          onToggle={() => onToggle(source.id)}
          assignableChapters={assignableChapters}
          allChapters={allChapters}
          canEditVisibility={source.addedBy === currentUserId || isAdmin}
          language={language}
        />
      ))}
    </ul>
  );
}
