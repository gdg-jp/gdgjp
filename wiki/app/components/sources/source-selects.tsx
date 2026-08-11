import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { SOURCE_VISIBILITIES } from "~/lib/sources-shared";

export function VisibilitySelect({
  t,
  value,
  onValueChange,
  className = "w-full bg-surface-raised sm:w-56",
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
  className = "w-full bg-surface-raised sm:w-56",
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
      return "bg-feedback-success-surface text-feedback-success-foreground";
    case "pending":
    case "fetching":
      return "bg-feedback-warning-surface text-feedback-warning-foreground";
    case "error":
      return "bg-feedback-danger-surface text-feedback-danger-foreground";
    case "archived":
      return "bg-surface-hover text-content-secondary";
    default:
      return "bg-surface-hover text-content-secondary";
  }
}
