import { Trash2 } from "lucide-react";
import { useState } from "react";
import { Button } from "~/components/ui/button";
import { cn } from "~/lib/utils";

const DAYS = [
  { value: 0, label: "Mon" },
  { value: 1, label: "Tue" },
  { value: 2, label: "Wed" },
  { value: 3, label: "Thu" },
  { value: 4, label: "Fri" },
  { value: 5, label: "Sat" },
  { value: 6, label: "Sun" },
];

type Row = { key: number; day: number; time: string };

export function SlotsEditor() {
  const [rows, setRows] = useState<Row[]>([{ key: 1, day: 0, time: "19:00" }]);
  const [nextKey, setNextKey] = useState(2);

  function addRow() {
    setRows((r) => [...r, { key: nextKey, day: 0, time: "19:00" }]);
    setNextKey((k) => k + 1);
  }

  function removeRow(key: number) {
    setRows((r) => (r.length <= 1 ? r : r.filter((row) => row.key !== key)));
  }

  function updateRow(key: number, patch: Partial<Row>) {
    setRows((r) => r.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  }

  const dupes = findDuplicates(rows);

  return (
    <div className="flex flex-col gap-2">
      {rows.map((row) => {
        const dup = dupes.has(`${row.day}-${row.time}`);
        return (
          <div key={row.key} className="flex items-center gap-2">
            <select
              name="slot_day"
              value={row.day}
              onChange={(e) => updateRow(row.key, { day: Number.parseInt(e.target.value, 10) })}
              className={cn(
                "h-9 rounded-md border border-input bg-transparent px-2 text-sm shadow-xs outline-none",
                "focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50",
                dup && "border-destructive",
              )}
            >
              {DAYS.map((d) => (
                <option key={d.value} value={d.value}>
                  {d.label}
                </option>
              ))}
            </select>
            <input
              type="time"
              name="slot_time"
              value={row.time}
              onChange={(e) => updateRow(row.key, { time: e.target.value })}
              required
              className={cn(
                "h-9 rounded-md border border-input bg-transparent px-2 text-sm shadow-xs outline-none",
                "focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50",
                dup && "border-destructive",
              )}
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Remove slot"
              onClick={() => removeRow(row.key)}
              disabled={rows.length <= 1}
            >
              <Trash2 className="size-4" />
            </Button>
          </div>
        );
      })}
      <div>
        <Button type="button" variant="outline" size="sm" onClick={addRow}>
          Add slot
        </Button>
      </div>
      {dupes.size > 0 ? (
        <p className="text-xs text-destructive">Duplicate slots will be merged.</p>
      ) : null}
    </div>
  );
}

function findDuplicates(rows: Row[]): Set<string> {
  const counts = new Map<string, number>();
  for (const r of rows) {
    const k = `${r.day}-${r.time}`;
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return new Set([...counts].filter(([, n]) => n > 1).map(([k]) => k));
}
