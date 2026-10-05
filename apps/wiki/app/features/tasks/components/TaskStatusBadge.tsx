import { useTranslation } from "react-i18next";

const STATUS_STYLES: Record<string, string> = {
  todo: "bg-[var(--gdg-success-surface)] text-success",
  in_progress: "bg-[var(--gdg-warning-surface)] text-warning",
  done: "bg-selected text-link",
  cancelled: "bg-neutral text-muted",
  duplicated: "bg-neutral text-muted",
};

export default function TaskStatusBadge({ status }: { status: string }) {
  const { t } = useTranslation();
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[status] ?? STATUS_STYLES.todo}`}
    >
      {t(`tasks.status_${status}`)}
    </span>
  );
}
