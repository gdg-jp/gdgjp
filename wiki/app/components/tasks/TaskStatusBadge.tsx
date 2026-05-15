import { useTranslation } from "react-i18next";

const STATUS_STYLES: Record<string, string> = {
  todo: "bg-green-100 text-green-700",
  in_progress: "bg-yellow-100 text-yellow-700",
  done: "bg-blue-100 text-blue-700",
  cancelled: "bg-gray-100 text-gray-700",
  duplicated: "bg-gray-100 text-gray-700",
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
