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
  "#6b7280", // design-token-policy: allow-dynamic-color
  "#ef4444", // design-token-policy: allow-dynamic-color
  "#f97316", // design-token-policy: allow-dynamic-color
  "#eab308", // design-token-policy: allow-dynamic-color
  "#22c55e", // design-token-policy: allow-dynamic-color
  "#3b82f6", // design-token-policy: allow-dynamic-color
  "#8b5cf6", // design-token-policy: allow-dynamic-color
  "#ec4899", // design-token-policy: allow-dynamic-color
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
          className={`h-5 w-5 rounded-full border-2 ${value === c ? "border-strong" : "border-transparent"}`}
          style={{ backgroundColor: c }}
        />
      ))}
    </div>
  );
}

export default function TeamManager({ teams, taskListId, onRefresh }: TeamManagerProps) {
  const { t } = useTranslation();
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState("#6b7280"); // design-token-policy: allow-dynamic-color
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
      setNewColor("#6b7280"); // design-token-policy: allow-dynamic-color
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
      {error && <p className="text-xs text-feedback-danger-foreground">{error}</p>}
      {/* Existing teams */}
      {teams.map((team) => {
        return editingId === team.id ? (
          <div
            key={team.id}
            className="space-y-2 rounded-md border border-feedback-info-border px-3 py-2"
          >
            <input
              type="text"
              className="w-full rounded border border-strong px-2 py-1.5 text-sm focus:border-focus focus:outline-none focus:ring-1 focus:ring-border-focus"
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleUpdate(team.id)}
            />
            <ColorPicker value={editColor} onChange={setEditColor} />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setEditingId(null)}
                className="rounded-md border border-strong px-2 py-1 text-sm text-content-secondary hover:bg-surface-canvas"
              >
                {t("cancel")}
              </button>
              <button
                type="button"
                onClick={() => handleUpdate(team.id)}
                className="rounded-md bg-action-primary px-2 py-1 text-sm text-content-inverse hover:bg-action-primary-hover"
              >
                {t("tasks.save")}
              </button>
            </div>
          </div>
        ) : (
          <div
            key={team.id}
            className="flex items-center gap-2 rounded-md border border-default px-3 py-2"
          >
            <div
              className="h-4 w-4 flex-shrink-0 rounded-full"
              style={{ backgroundColor: team.color ?? "#6b7280" }} // design-token-policy: allow-dynamic-color
            />
            <span className="flex-1 text-sm">{team.name}</span>
            <button
              type="button"
              aria-label={`Edit team ${team.name}`}
              onClick={() => {
                setEditingId(team.id);
                setEditName(team.name);
                setEditColor(team.color ?? "#6b7280"); // design-token-policy: allow-dynamic-color
              }}
              className="text-content-tertiary hover:text-content-secondary"
            >
              <Pencil size={14} />
            </button>
            <button
              type="button"
              aria-label={`Delete team ${team.name}`}
              onClick={() => handleDelete(team.id)}
              className="text-content-tertiary hover:text-feedback-danger-foreground"
            >
              <Trash2 size={14} />
            </button>
          </div>
        );
      })}

      {/* New team form */}
      <div className="space-y-2 border-t border-subtle pt-3">
        <p className="text-xs font-semibold text-content-secondary">{t("tasks.new_team")}</p>
        <input
          type="text"
          className="w-full rounded-md border border-strong px-2 py-1.5 text-sm focus:border-focus focus:outline-none focus:ring-1 focus:ring-border-focus"
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
            className="inline-flex items-center gap-1 rounded-md bg-action-primary px-2 py-1.5 text-sm text-content-inverse hover:bg-action-primary-hover disabled:opacity-50"
          >
            <Plus size={14} />
            {t("tasks.add_team")}
          </button>
        </div>
      </div>
    </div>
  );
}
