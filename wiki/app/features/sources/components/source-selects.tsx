import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@gdgjp/ui";
import { SOURCE_VISIBILITIES } from "~/features/sources/shared";

export function VisibilitySelect({
  t,
  value,
  onValueChange,
  className = "w-full bg-surface sm:w-56",
}: {
  t: (key: string) => string;
  value: string;
  onValueChange: (value: string) => void;
  className?: string;
}) {
  return (
    <Select value={value || undefined} onValueChange={onValueChange}>
      <SelectTrigger className={className} aria-label={t("sources.visibility_label")}>
        <SelectValue placeholder={t("sources.visibility_placeholder")} />
      </SelectTrigger>
      <SelectContent position="popper">
        {SOURCE_VISIBILITIES.map((option) => (
          <SelectItem key={option} value={option}>
            {t(`sources.visibility.${option}`)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function ChapterSelect({
  chapters,
  language,
  t,
  value,
  onValueChange,
  className = "w-full bg-surface sm:w-56",
}: {
  chapters: Array<{ id: string; nameJa: string; nameEn: string }>;
  language: string;
  t: (key: string) => string;
  value: string;
  onValueChange: (value: string) => void;
  className?: string;
}) {
  if (chapters.length === 0) {
    return (
      <Select disabled>
        <SelectTrigger className={className} aria-label={t("sources.chapter_label")}>
          <SelectValue placeholder={t("sources.chapter_empty")} />
        </SelectTrigger>
      </Select>
    );
  }

  return (
    <Select value={value || undefined} onValueChange={onValueChange}>
      <SelectTrigger className={className} aria-label={t("sources.chapter_label")}>
        <SelectValue placeholder={t("sources.chapter_placeholder")} />
      </SelectTrigger>
      <SelectContent position="popper">
        {chapters.map((chapter) => (
          <SelectItem key={chapter.id} value={chapter.id}>
            {language.startsWith("en") ? chapter.nameEn : chapter.nameJa}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function statusBadgeClass(status: string): string {
  switch (status) {
    case "ready":
      return "bg-[var(--gdg-success-surface)] text-success";
    case "pending":
    case "fetching":
      return "bg-[var(--gdg-warning-surface)] text-warning";
    case "error":
      return "bg-[var(--gdg-danger-surface)] text-danger";
    case "archived":
      return "bg-neutral text-muted";
    default:
      return "bg-neutral text-muted";
  }
}
