import { X } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "~/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "~/components/ui/dialog";
import DropdownMenu, { type DropdownOption } from "./DropdownMenu";

interface Team {
  id: string;
  name: string;
  color: string | null;
}

interface Member {
  id: string;
  name: string;
}

interface TaskCreateDialogProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (data: {
    title: string;
    description: string;
    status: string;
    type: string;
    dueDate: string | null;
    assigneeId: string | null;
    teamId: string | null;
  }) => void;
  teams: Team[];
  members: Member[];
  initial?: {
    title?: string;
    description?: string;
    status?: string;
    type?: string;
    dueDate?: string | null;
    assigneeId?: string | null;
    teamId?: string | null;
  };
}

export default function TaskCreateDialog({
  open,
  onClose,
  onSubmit,
  teams,
  members,
  initial,
}: TaskCreateDialogProps) {
  const { t } = useTranslation();
  const [title, setTitle] = useState(initial?.title ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [status, setStatus] = useState(initial?.status ?? "todo");
  const [type, setType] = useState(initial?.type ?? "task");
  const [dueDate, setDueDate] = useState(initial?.dueDate ?? "");
  const [assigneeId, setAssigneeId] = useState(initial?.assigneeId ?? "");
  const [teamId, setTeamId] = useState(initial?.teamId ?? "");

  useEffect(() => {
    if (!open) return;
    setTitle(initial?.title ?? "");
    setDescription(initial?.description ?? "");
    setStatus(initial?.status ?? "todo");
    setType(initial?.type ?? "task");
    setDueDate(initial?.dueDate ?? "");
    setAssigneeId(initial?.assigneeId ?? "");
    setTeamId(initial?.teamId ?? "");
  }, [open, initial]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    onSubmit({
      title: title.trim(),
      description,
      status,
      type,
      dueDate: dueDate || null,
      assigneeId: assigneeId || null,
      teamId: teamId || null,
    });
    // Reset
    setTitle("");
    setDescription("");
    setStatus("todo");
    setType("task");
    setDueDate("");
    setAssigneeId("");
    setTeamId("");
  }

  const inputClass =
    "w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500";

  const statusOptions: DropdownOption[] = [
    "todo",
    "in_progress",
    "done",
    "cancelled",
    "duplicated",
  ].map((s) => ({ value: s, label: t(`tasks.status_${s}`) }));

  const typeOptions: DropdownOption[] = [
    { value: "task", label: t("tasks.type_task") },
    { value: "discussion", label: t("tasks.type_discussion") },
  ];

  const assigneeOptions: DropdownOption[] = [
    { value: "", label: t("tasks.filter_unassigned") },
    ...members.map((m) => ({ value: m.id, label: m.name })),
  ];

  const teamOptions: DropdownOption[] = [
    { value: "", label: "—" },
    ...teams.map((tm) => ({ value: tm.id, label: tm.name, dot: tm.color ?? "#6b7280" })),
  ];

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && onClose()}>
      <DialogContent
        showCloseButton={false}
        aria-describedby={undefined}
        className="max-h-[calc(100dvh-2rem)] max-w-lg overflow-y-auto rounded-2xl bg-card p-6 text-card-foreground shadow-2xl shadow-black/20"
      >
        <div className="mb-4 flex items-center justify-between">
          <DialogTitle className="text-lg font-semibold">
            {initial ? t("tasks.edit_task") : t("tasks.new_task")}
          </DialogTitle>
          <Button
            variant="ghost"
            size="icon"
            onClick={onClose}
            className="-mr-2 rounded-full text-muted-foreground"
            aria-label={t("close")}
          >
            <X size={18} />
          </Button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="task-title" className="mb-1 block text-sm font-medium text-gray-700">
              {t("tasks.col_title")} *
            </label>
            <input
              id="task-title"
              type="text"
              className={inputClass}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>

          <div>
            <label htmlFor="task-desc" className="mb-1 block text-sm font-medium text-gray-700">
              {t("tasks.description")}
            </label>
            <textarea
              id="task-desc"
              className={`${inputClass} min-h-[80px]`}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t("tasks.description_placeholder")}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <span className="mb-1 block text-sm font-medium text-gray-700">
                {t("tasks.col_status")}
              </span>
              <DropdownMenu
                value={status}
                options={statusOptions}
                onChange={setStatus}
                variant="field"
              />
            </div>

            <div>
              <span className="mb-1 block text-sm font-medium text-gray-700">
                {t("tasks.col_type")}
              </span>
              <DropdownMenu value={type} options={typeOptions} onChange={setType} variant="field" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <span className="mb-1 block text-sm font-medium text-gray-700">
                {t("tasks.col_assignee")}
              </span>
              <DropdownMenu
                value={assigneeId}
                options={assigneeOptions}
                onChange={setAssigneeId}
                variant="field"
                searchable
                header={t("tasks.select_assignees")}
                searchPlaceholder={t("tasks.filter_assignee")}
              />
            </div>

            {teams.length > 0 && (
              <div>
                <span className="mb-1 block text-sm font-medium text-gray-700">
                  {t("tasks.col_team")}
                </span>
                <DropdownMenu
                  value={teamId}
                  options={teamOptions}
                  onChange={setTeamId}
                  variant="field"
                />
              </div>
            )}
          </div>

          <div>
            <label htmlFor="task-due" className="mb-1 block text-sm font-medium text-gray-700">
              {t("tasks.col_due_date")}
            </label>
            <input
              id="task-due"
              type="date"
              className={inputClass}
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={onClose}>
              {t("cancel")}
            </Button>
            <Button type="submit" disabled={!title.trim()}>
              {initial ? t("tasks.save") : t("tasks.create")}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
