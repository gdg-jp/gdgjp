import { Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

interface Team {
  id: string;
  name: string;
  color: string | null;
  sortOrder: number | null;
}

interface TeamManagerProps {
  teams: Team[];
  taskListId: string;
  onRefresh: () => void;
}

const PRESET_COLORS = [
  "#6b7280",
  "#ef4444",
  "#f97316",
  "#eab308",
  "#22c55e",
  "#3b82f6",
  "#8b5cf6",
  "#ec4899",
];

function ColorPicker({ value, onChange }: { value: string; onChange: (c: string) => void }) {
  return (
    <div className="flex gap-1">
      {PRESET_COLORS.map((c) => (
        <button
          key={c}
          type="button"
          onClick={() => onChange(c)}
          aria-label={`Select color ${c}`}
          aria-pressed={value === c}
          className={`h-5 w-5 rounded-full border-2 ${value === c ? "border-gray-800" : "border-transparent"}`}
          style={{ backgroundColor: c }}
        />
      ))}
    </div>
  );
}

export default function TeamManager({ teams, taskListId, onRefresh }: TeamManagerProps) {
  const { t } = useTranslation();
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState("#6b7280");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editColor, setEditColor] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function handleCreate() {
    if (!newName.trim()) return;
    setError(null);
    const response = await fetch(`/api/tasks/${taskListId}/teams`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ intent: "create", name: newName.trim(), color: newColor }),
    });
    if (response.ok) {
      setNewName("");
      setNewColor("#6b7280");
      onRefresh();
    } else {
      setError(`Failed to create team (${response.status})`);
    }
  }

  async function handleUpdate(id: string) {
    if (!editName.trim()) return;
    setError(null);
    const response = await fetch(`/api/tasks/${taskListId}/teams`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ intent: "update", id, name: editName.trim(), color: editColor }),
    });
    if (response.ok) {
      setEditingId(null);
      onRefresh();
    } else {
      setError(`Failed to update team (${response.status})`);
    }
  }

  async function handleDelete(id: string) {
    setError(null);
    const response = await fetch(`/api/tasks/${taskListId}/teams`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ intent: "delete", id }),
    });
    if (response.ok) {
      onRefresh();
    } else {
      setError(`Failed to delete team (${response.status})`);
    }
  }

  return (
    <div className="space-y-2">
      {error && <p className="text-xs text-red-600">{error}</p>}
      {/* Existing teams */}
      {teams.map((team) => {
        return editingId === team.id ? (
          <div key={team.id} className="space-y-2 rounded-md border border-blue-300 px-3 py-2">
            <input
              type="text"
              className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleUpdate(team.id)}
            />
            <ColorPicker value={editColor} onChange={setEditColor} />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setEditingId(null)}
                className="rounded-md border border-gray-300 px-2 py-1 text-sm text-gray-600 hover:bg-gray-50"
              >
                {t("cancel")}
              </button>
              <button
                type="button"
                onClick={() => handleUpdate(team.id)}
                className="rounded-md bg-blue-600 px-2 py-1 text-sm text-white hover:bg-blue-700"
              >
                {t("tasks.save")}
              </button>
            </div>
          </div>
        ) : (
          <div
            key={team.id}
            className="flex items-center gap-2 rounded-md border border-gray-200 px-3 py-2"
          >
            <div
              className="h-4 w-4 flex-shrink-0 rounded-full"
              style={{ backgroundColor: team.color ?? "#6b7280" }}
            />
            <span className="flex-1 text-sm">{team.name}</span>
            <button
              type="button"
              aria-label={`Edit team ${team.name}`}
              onClick={() => {
                setEditingId(team.id);
                setEditName(team.name);
                setEditColor(team.color ?? "#6b7280");
              }}
              className="text-gray-400 hover:text-gray-600"
            >
              <Pencil size={14} />
            </button>
            <button
              type="button"
              aria-label={`Delete team ${team.name}`}
              onClick={() => handleDelete(team.id)}
              className="text-gray-400 hover:text-red-500"
            >
              <Trash2 size={14} />
            </button>
          </div>
        );
      })}

      {/* New team form */}
      <div className="space-y-2 border-t border-gray-100 pt-3">
        <p className="text-xs font-semibold text-gray-500">{t("tasks.new_team")}</p>
        <input
          type="text"
          className="w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder={t("tasks.team_name_placeholder")}
          onKeyDown={(e) => e.key === "Enter" && handleCreate()}
        />
        <ColorPicker value={newColor} onChange={setNewColor} />
        <div className="flex justify-end">
          <button
            type="button"
            onClick={handleCreate}
            disabled={!newName.trim()}
            className="inline-flex items-center gap-1 rounded-md bg-blue-600 px-2 py-1.5 text-sm text-white hover:bg-blue-700 disabled:opacity-50"
          >
            <Plus size={14} />
            {t("tasks.add_team")}
          </button>
        </div>
      </div>
    </div>
  );
}
