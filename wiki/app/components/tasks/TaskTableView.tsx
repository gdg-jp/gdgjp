import { ArrowUpRight, Settings, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import SidebarDialog from "~/components/SidebarDialog";
import SidebarPopover from "~/components/SidebarPopover";
import { useMediaQuery } from "~/hooks/useMediaQuery";
import ColumnFilterPopover from "./ColumnFilterPopover";
import NewTaskRow from "./NewTaskRow";
import TaskRow from "./TaskRow";
import TeamManager from "./TeamManager";

interface Team {
  id: string;
  name: string;
  color: string | null;
  sortOrder: number | null;
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

interface TaskTableViewProps {
  tasks: Task[];
  teams: Team[];
  members: Member[];
  onUpdate: (
    taskId: string,
    fieldOrUpdates: string | Record<string, unknown>,
    value?: unknown,
  ) => void;
  onTaskClick: (taskId: string) => void;
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
  onDelete: (taskId: string) => void;
  nextTaskNumber: number;
  canManage?: boolean;
  taskListId?: string;
  onTeamsRefresh?: () => void;
}

export default function TaskTableView({
  tasks,
  teams,
  members,
  onUpdate,
  onTaskClick,
  onCreate,
  onDelete,
  nextTaskNumber,
  canManage,
  taskListId,
  onTeamsRefresh,
}: TaskTableViewProps) {
  const { t } = useTranslation();
  const [statusFilter, setStatusFilter] = useState<string[]>([]);
  const [typeFilter, setTypeFilter] = useState<string[]>([]);
  const [assigneeFilter, setAssigneeFilter] = useState<string[]>([]);
  const [teamFilter, setTeamFilter] = useState<string[]>([]);
  const [showTeamSettings, setShowTeamSettings] = useState(false);
  const [tipKey, setTipKey] = useState("tasks.add_task_tip_multiline");
  useEffect(() => {
    setTipKey(Math.random() < 0.5 ? "tasks.add_task_tip_multiline" : "tasks.add_task_tip_discord");
  }, []);
  const teamSettingsBtnRef = useRef<HTMLButtonElement>(null);
  const isMobile = useMediaQuery("(max-width: 768px)");

  const maxNumber = tasks.length > 0 ? Math.max(...tasks.map((t) => t.number)) : 0;

  const filtered = tasks.filter((task) => {
    if (statusFilter.length > 0 && !statusFilter.includes(task.status)) return false;
    if (typeFilter.length > 0 && !typeFilter.includes(task.type)) return false;
    if (assigneeFilter.length > 0) {
      const wantUnassigned = assigneeFilter.includes("unassigned");
      const ids = assigneeFilter.filter((v) => v !== "unassigned");
      const matchUnassigned = wantUnassigned && !task.assigneeId && !task.assigneeName;
      const matchId = ids.length > 0 && task.assigneeId !== null && ids.includes(task.assigneeId);
      if (!matchUnassigned && !matchId) return false;
    }
    if (teamFilter.length > 0) {
      const wantUnteamed = teamFilter.includes("unteamed");
      const ids = teamFilter.filter((v) => v !== "unteamed");
      const matchUnteamed = wantUnteamed && !task.teamId;
      const matchId = ids.length > 0 && task.teamId !== null && ids.includes(task.teamId);
      if (!matchUnteamed && !matchId) return false;
    }
    return true;
  });

  function handleTeamsRefresh() {
    onTeamsRefresh?.();
    setShowTeamSettings(false);
  }

  const statusOptions = ["todo", "in_progress", "done", "cancelled", "duplicated"].map((s) => ({
    value: s,
    label: t(`tasks.status_${s}`),
  }));

  const typeOptions = ["task", "discussion"].map((tp) => ({
    value: tp,
    label: t(`tasks.type_${tp}`),
  }));

  const assigneeOptions = [
    { value: "unassigned", label: t("tasks.filter_unassigned") },
    ...members.map((m) => ({ value: m.id, label: m.name })),
  ];

  const teamOptions = [
    { value: "unteamed", label: t("tasks.filter_unassigned") },
    ...teams.map((team) => ({ value: team.id, label: team.name, dot: team.color ?? "#6b7280" })),
  ];

  const teamSettingsContent = (
    <div className="p-4">
      <div className="mb-4 flex items-center justify-between">
        <span className="text-sm font-semibold text-gray-700">{t("tasks.teams")}</span>
        <button
          type="button"
          onClick={() => setShowTeamSettings(false)}
          className="text-gray-400 hover:text-gray-600"
        >
          <X size={16} />
        </button>
      </div>
      {taskListId && (
        <TeamManager teams={teams} taskListId={taskListId} onRefresh={handleTeamsRefresh} />
      )}
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="overflow-x-auto border-y border-gray-200">
        <table className="min-w-[900px] w-full table-fixed divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="w-[3%] px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                #
              </th>
              <th className="w-[7%] overflow-hidden px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                <span className="flex items-center justify-between">
                  {t("tasks.col_status")}
                  <ColumnFilterPopover
                    label={t("tasks.col_status")}
                    options={statusOptions}
                    selected={statusFilter}
                    onChange={setStatusFilter}
                  />
                </span>
              </th>
              <th className="w-[6%] overflow-hidden px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                {t("tasks.col_due_date")}
              </th>
              <th className="w-[6%] overflow-hidden px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                <span className="flex items-center justify-between">
                  {t("tasks.col_assignee")}
                  <ColumnFilterPopover
                    label={t("tasks.col_assignee")}
                    options={assigneeOptions}
                    selected={assigneeFilter}
                    onChange={setAssigneeFilter}
                    searchable
                    searchPlaceholder={t("tasks.filter_assignee")}
                  />
                </span>
              </th>
              <th className="w-[6%] overflow-hidden px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                <span className="flex items-center justify-between">
                  {t("tasks.col_team")}
                  <span className="flex items-center gap-1">
                    <ColumnFilterPopover
                      label={t("tasks.col_team")}
                      options={teamOptions}
                      selected={teamFilter}
                      onChange={setTeamFilter}
                    />
                    {canManage && (
                      <button
                        ref={teamSettingsBtnRef}
                        type="button"
                        onClick={() => setShowTeamSettings(true)}
                        className="text-gray-400 hover:text-gray-600"
                      >
                        <Settings size={12} />
                      </button>
                    )}
                  </span>
                </span>
              </th>
              <th className="w-[6%] overflow-hidden px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                {t("tasks.col_deps")}
              </th>
              <th className="w-[6%] overflow-hidden px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                <span className="flex items-center justify-between">
                  {t("tasks.col_type")}
                  <ColumnFilterPopover
                    label={t("tasks.col_type")}
                    options={typeOptions}
                    selected={typeFilter}
                    onChange={setTypeFilter}
                  />
                </span>
              </th>
              <th className="w-[18%] px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                {t("tasks.col_title")}
              </th>
              <th className="w-[25%] px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                {t("tasks.description")}
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 bg-white">
            {filtered.map((task) => (
              <TaskRow
                key={task.id}
                task={task}
                teams={teams}
                members={members}
                allTasks={tasks}
                onUpdate={onUpdate}
                onClick={onTaskClick}
                isLast={task.number === maxNumber}
                onDelete={onDelete}
              />
            ))}
            {canManage && (
              <NewTaskRow
                number={nextTaskNumber}
                teams={teams}
                members={members}
                allTasks={tasks}
                onCreate={onCreate}
              />
            )}
          </tbody>
        </table>
      </div>

      {canManage && (
        <div className="mt-2 pb-4 flex flex-col items-center gap-1 text-center text-sm text-gray-400">
          <ArrowUpRight size={32} className="translate-x-12" />
          <p>{t("tasks.add_task_hint")}</p>
          <p className="text-xs text-gray-300">{t(tipKey)}</p>
        </div>
      )}

      {canManage &&
        (isMobile ? (
          <SidebarDialog open={showTeamSettings} onClose={() => setShowTeamSettings(false)}>
            {teamSettingsContent}
          </SidebarDialog>
        ) : (
          <SidebarPopover
            open={showTeamSettings}
            onClose={() => setShowTeamSettings(false)}
            anchorRef={teamSettingsBtnRef}
          >
            {teamSettingsContent}
          </SidebarPopover>
        ))}
    </div>
  );
}
