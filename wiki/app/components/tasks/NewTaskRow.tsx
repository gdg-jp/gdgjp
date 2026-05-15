import { useState } from "react";
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
}

interface NewTaskRowProps {
  number: number;
  teams: Team[];
  members: Member[];
  allTasks: Task[];
  onCreate: (data: {
    title: string;
    description: string;
    status: string;
    type: string;
    dueDate: string | null;
    assigneeId: string | null;
    assigneeName: string | null;
    teamId: string | null;
    dependencies: string[];
  }) => Promise<void>;
}

interface CommitFields {
  status: string;
  type: string;
  dueDate: string | null;
  assigneeId: string | null;
  assigneeName: string | null;
  teamId: string | null;
  dependencies: string[];
}

export default function NewTaskRow({
  number,
  teams,
  members,
  allTasks,
  onCreate,
}: NewTaskRowProps) {
  const { t } = useTranslation();
  const [titleDraft, setTitleDraft] = useState("");
  const [descDraft, setDescDraft] = useState("");
  // Empty string = unset (shows "—" placeholder via DropdownMenu)
  const [status, setStatus] = useState("");
  const [type, setType] = useState("");
  const [dueDate, setDueDate] = useState<string | null>(null);
  const [assigneeId, setAssigneeId] = useState<string | null>(null);
  const [assigneeName, setAssigneeName] = useState<string | null>(null);
  const [teamId, setTeamId] = useState<string | null>(null);
  const [dependencies, setDependencies] = useState<string[]>([]);

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

  // Accepts explicit field values to work around async state updates after setX calls
  function commitWith(fields: CommitFields) {
    const lines = titleDraft
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    if (lines.length === 0) return;

    for (const line of lines) {
      onCreate({
        title: line,
        description: descDraft.trim(),
        status: fields.status || "todo",
        type: fields.type || "task",
        dueDate: fields.dueDate,
        assigneeId: fields.assigneeId,
        assigneeName: fields.assigneeName,
        teamId: fields.teamId,
        dependencies: fields.dependencies,
      });
    }

    setTitleDraft("");
    setDescDraft("");
    setStatus("");
    setType("");
    setDueDate(null);
    setAssigneeId(null);
    setAssigneeName(null);
    setTeamId(null);
    setDependencies([]);
  }

  // Current state snapshot — passed when a non-title field triggers creation
  function current(): CommitFields {
    return { status, type, dueDate, assigneeId, assigneeName, teamId, dependencies };
  }

  function handleRowBlur(e: React.FocusEvent<HTMLTableRowElement>) {
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      commitWith(current());
    }
  }

  return (
    <tr className="bg-gray-50/50" onBlur={handleRowBlur}>
      {/* # */}
      <td className="whitespace-nowrap px-3 py-2 text-sm italic text-gray-300">#{number}</td>

      {/* Status */}
      <td className="overflow-hidden px-3 py-2">
        <DropdownMenu
          value={status}
          options={statusOptions}
          onChange={(v) => {
            setStatus(v);
            commitWith({ ...current(), status: v });
          }}
          variant="chip"
          placeholder="—"
        />
      </td>

      {/* Due Date */}
      <td className="overflow-hidden px-3 py-2">
        <DatePickerDropdown
          value={dueDate}
          onChange={(date) => {
            setDueDate(date);
            commitWith({ ...current(), dueDate: date });
          }}
        />
      </td>

      {/* Assignee */}
      <td className="overflow-hidden px-3 py-2">
        <AssigneeCell
          assigneeId={assigneeId}
          assigneeName={assigneeName}
          members={members}
          onChange={(update) => {
            setAssigneeId(update.assigneeId);
            setAssigneeName(update.assigneeName);
            commitWith({
              ...current(),
              assigneeId: update.assigneeId,
              assigneeName: update.assigneeName,
            });
          }}
        />
      </td>

      {/* Team */}
      <td className="overflow-hidden px-3 py-2">
        {teams.length > 0 ? (
          <DropdownMenu
            value={teamId ?? ""}
            options={teamOptions}
            onChange={(v) => {
              const val = v || null;
              setTeamId(val);
              commitWith({ ...current(), teamId: val });
            }}
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
          taskId=""
          value={dependencies}
          options={allTasks}
          onChange={(ids) => {
            setDependencies(ids);
            commitWith({ ...current(), dependencies: ids });
          }}
        />
      </td>

      {/* Type */}
      <td className="overflow-hidden px-3 py-2">
        <DropdownMenu
          value={type}
          options={typeOptions}
          onChange={(v) => {
            setType(v);
            commitWith({ ...current(), type: v });
          }}
          variant="chip"
          placeholder="—"
        />
      </td>

      {/* Title */}
      <td
        className="break-words px-3 py-2 text-sm"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
      >
        <textarea
          rows={1}
          className="w-full resize-none overflow-hidden rounded border-0 bg-transparent text-sm text-gray-500 placeholder:italic placeholder:text-gray-300 focus:outline-none focus:ring-1 focus:ring-blue-400"
          placeholder={t("tasks.add_task_placeholder")}
          value={titleDraft}
          onChange={(e) => setTitleDraft(e.target.value)}
          onInput={(e) => {
            const el = e.currentTarget;
            el.style.height = "auto";
            el.style.height = `${el.scrollHeight}px`;
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              commitWith(current());
            }
          }}
        />
      </td>

      {/* Description */}
      <td
        className="break-words px-3 py-2 text-sm"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
      >
        <input
          type="text"
          className="w-full rounded border-0 bg-transparent text-sm text-gray-400 placeholder:italic placeholder:text-gray-300 focus:outline-none focus:ring-1 focus:ring-blue-400"
          placeholder={t("tasks.add_desc_placeholder")}
          value={descDraft}
          onChange={(e) => setDescDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") commitWith(current());
          }}
        />
      </td>
    </tr>
  );
}
