import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import AssigneeCell from "./AssigneeCell";
import DatePickerDropdown from "./DatePickerDropdown";
import DepsDropdown from "./DepsDropdown";
import DropdownMenu, { type DropdownOption } from "./DropdownMenu";
import { STATUSES, STATUS_CHIP, TYPES, TYPE_CHIP } from "./task-options";

interface Team {
  id: string;
  name: string;
  color: string | null;
}

interface Member {
  id: string;
  name: string;
  image: string | null;
}

interface Task {
  id: string;
  number: number;
  title: string;
  description: string;
  status: string;
  type: string;
  dueDate: string | null;
  assigneeId: string | null;
  assigneeName: string | null;
  teamId: string | null;
  dependencies: string[];
}

interface TaskRowProps {
  task: Task;
  teams: Team[];
  members: Member[];
  allTasks: Task[];
  onUpdate: (
    taskId: string,
    fieldOrUpdates: string | Record<string, unknown>,
    value?: unknown,
  ) => void;
  onClick: (taskId: string) => void;
  isLast?: boolean;
  onDelete?: (taskId: string) => void;
}

export default function TaskRow({
  task,
  teams,
  members,
  allTasks,
  onUpdate,
  onClick,
  isLast,
  onDelete,
}: TaskRowProps) {
  const { t } = useTranslation();

  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState(task.title);
  const [editingDesc, setEditingDesc] = useState(false);
  const [descDraft, setDescDraft] = useState(task.description);
  const titleInputRef = useRef<HTMLInputElement>(null);
  const descInputRef = useRef<HTMLInputElement>(null);
  const skipTitleBlurRef = useRef(false);

  useEffect(() => {
    if (editingTitle) titleInputRef.current?.focus();
  }, [editingTitle]);

  useEffect(() => {
    if (editingDesc) descInputRef.current?.focus();
  }, [editingDesc]);

  // Sync drafts from props when not actively editing (keeps display in sync after remote updates)
  useEffect(() => {
    if (!editingTitle) setTitleDraft(task.title);
  }, [task.title, editingTitle]);

  useEffect(() => {
    if (!editingDesc) setDescDraft(task.description);
  }, [task.description, editingDesc]);

  const statusOptions: DropdownOption[] = STATUSES.map((s) => ({
    value: s,
    label: t(`tasks.status_${s}`),
    chipClass: STATUS_CHIP[s],
  }));

  const typeOptions: DropdownOption[] = TYPES.map((tp) => ({
    value: tp,
    label: t(`tasks.type_${tp}`),
    chipClass: TYPE_CHIP[tp],
  }));

  const teamOptions: DropdownOption[] = [
    { value: "", label: "—" },
    ...teams.map((tm) => ({ value: tm.id, label: tm.name, dot: tm.color ?? "#6b7280" })),
  ];

  return (
    <tr
      className="group border-b border-gray-100 hover:bg-gray-50"
      onClick={() => onClick(task.id)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") onClick(task.id);
      }}
    >
      {/* # — focusable button so keyboard users can open the task detail */}
      <td className="whitespace-nowrap px-3 py-2 text-sm text-gray-400">
        <button
          type="button"
          className="cursor-pointer focus:outline-none focus-visible:underline"
          onClick={(e) => {
            e.stopPropagation();
            onClick(task.id);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              e.stopPropagation();
              onClick(task.id);
            }
          }}
          aria-label={`Open task #${task.number}`}
        >
          #{task.number}
        </button>
      </td>

      {/* Status */}
      <td className="overflow-hidden px-3 py-2">
        <DropdownMenu
          value={task.status}
          options={statusOptions}
          onChange={(v) => onUpdate(task.id, "status", v)}
          variant="chip"
        />
      </td>

      {/* Due Date */}
      <td
        className="overflow-hidden px-3 py-2"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
      >
        <DatePickerDropdown
          value={task.dueDate}
          onChange={(date) => onUpdate(task.id, "dueDate", date)}
        />
      </td>

      {/* Assignee */}
      <td className="overflow-hidden px-3 py-2">
        <AssigneeCell
          assigneeId={task.assigneeId}
          assigneeName={task.assigneeName}
          members={members}
          onChange={(update) => onUpdate(task.id, update)}
        />
      </td>

      {/* Team */}
      <td className="overflow-hidden px-3 py-2">
        {teams.length > 0 ? (
          <DropdownMenu
            value={task.teamId ?? ""}
            options={teamOptions}
            onChange={(v) => onUpdate(task.id, "teamId", v || null)}
            labelClass="max-w-[60px]"
          />
        ) : (
          <span className="text-sm text-gray-400">—</span>
        )}
      </td>

      {/* Dependencies */}
      <td
        className="overflow-hidden px-3 py-2"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
      >
        <DepsDropdown
          taskId={task.id}
          value={task.dependencies}
          options={allTasks.filter((t) => t.id !== task.id)}
          onChange={(ids) => onUpdate(task.id, "dependencies", ids)}
        />
      </td>

      {/* Type */}
      <td className="overflow-hidden px-3 py-2">
        <DropdownMenu
          value={task.type}
          options={typeOptions}
          onChange={(v) => onUpdate(task.id, "type", v)}
          variant="chip"
        />
      </td>

      {/* Title — inline-editable cell */}
      <td className="break-words px-3 py-2 text-sm font-medium text-gray-900">
        {editingTitle ? (
          <input
            ref={titleInputRef}
            type="text"
            className="w-full rounded border border-blue-400 px-1 py-0.5 text-sm font-medium text-gray-900 focus:outline-none focus:ring-1 focus:ring-blue-500"
            value={titleDraft}
            onChange={(e) => setTitleDraft(e.target.value)}
            onBlur={() => {
              if (skipTitleBlurRef.current) {
                skipTitleBlurRef.current = false;
                return;
              }
              const trimmed = titleDraft.trim();
              if (!trimmed && isLast && onDelete) {
                onDelete(task.id);
              } else {
                onUpdate(task.id, "title", trimmed || task.title);
              }
              setEditingTitle(false);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                const trimmed = titleDraft.trim();
                if (!trimmed && isLast && onDelete) {
                  onDelete(task.id);
                } else {
                  onUpdate(task.id, "title", trimmed || task.title);
                }
                skipTitleBlurRef.current = true;
                setEditingTitle(false);
              } else if (e.key === "Escape") {
                setTitleDraft(task.title);
                skipTitleBlurRef.current = true;
                setEditingTitle(false);
              }
            }}
            onClick={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
          />
        ) : (
          <button
            type="button"
            className="w-full break-words text-left text-sm font-medium text-gray-900"
            title={t("tasks.click_to_edit")}
            onClick={(e) => {
              e.stopPropagation();
              setEditingTitle(true);
              setTitleDraft(task.title);
            }}
          >
            {titleDraft}
          </button>
        )}
      </td>

      {/* Description — inline-editable cell */}
      <td className="break-words px-3 py-2 text-sm text-gray-500">
        {editingDesc ? (
          <input
            ref={descInputRef}
            type="text"
            className="w-full rounded border border-blue-400 px-1 py-0.5 text-sm text-gray-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            value={descDraft}
            onChange={(e) => setDescDraft(e.target.value)}
            onBlur={() => {
              onUpdate(task.id, "description", descDraft);
              setEditingDesc(false);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                onUpdate(task.id, "description", descDraft);
                setEditingDesc(false);
              } else if (e.key === "Escape") {
                setDescDraft(task.description);
                setEditingDesc(false);
              }
            }}
            onClick={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
          />
        ) : (
          <button
            type="button"
            className="w-full break-words text-left text-sm text-gray-500"
            title={t("tasks.click_to_edit")}
            onClick={(e) => {
              e.stopPropagation();
              setEditingDesc(true);
              setDescDraft(task.description);
            }}
          >
            {descDraft || "—"}
          </button>
        )}
      </td>
    </tr>
  );
}
