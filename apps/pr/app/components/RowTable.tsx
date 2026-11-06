import {
  Button,
  IconButton,
  Icons,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Table,
} from "@gdgjp/design-system";
import { useState } from "react";

export type RowColumn = {
  key: string;
  label: string;
  type: "text" | "int" | "datetime" | "date" | "list" | "select" | "lines" | "textarea";
  options?: { value: string; label: string }[];
  width?: string;
};

/**
 * An editable table whose cells post as `<name(row, column)>`. Rows can be added and removed on
 * the client; the server reads whatever rows arrive. Domain-free.
 */
export function RowTable({
  label,
  columns,
  initialRows,
  name,
  disabled,
}: {
  label: string;
  columns: RowColumn[];
  initialRows: Record<string, string>[];
  name: (row: number, column: string) => string;
  disabled?: boolean;
}) {
  const [rows, setRows] = useState(() => initialRows.map((values, i) => ({ key: i, values })));
  const [next, setNext] = useState(initialRows.length);
  return (
    <div className="space-y-2">
      <Table scrollLabel={`${label}を横にスクロール`}>
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} style={c.width ? { minWidth: c.width } : { minWidth: "10rem" }}>
                {c.label}
              </th>
            ))}
            <th>
              <span className="sr-only">操作</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={row.key}>
              {columns.map((c) => {
                const cellLabel = `${c.label}（${label} ${index + 1} 行目）`;
                const fieldName = name(row.key, c.key);
                const value = row.values[c.key] ?? "";
                return (
                  <td key={c.key}>
                    {c.type === "select" ? (
                      <Select
                        name={fieldName}
                        defaultValue={value || c.options?.[0]?.value}
                        disabled={disabled}
                      >
                        <SelectTrigger aria-label={cellLabel}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {c.options?.map((o) => (
                            <SelectItem key={o.value} value={o.value}>
                              {o.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <Input
                        aria-label={cellLabel}
                        name={fieldName}
                        defaultValue={value}
                        disabled={disabled}
                        type={
                          c.type === "datetime"
                            ? "datetime-local"
                            : c.type === "date"
                              ? "date"
                              : "text"
                        }
                        inputMode={c.type === "int" ? "numeric" : undefined}
                      />
                    )}
                  </td>
                );
              })}
              <td>
                <IconButton
                  aria-label={`${label} ${index + 1} 行目を削除`}
                  variant="ghost"
                  disabled={disabled}
                  onClick={() => setRows((current) => current.filter((r) => r.key !== row.key))}
                >
                  <Icons name="Trash2" size={16} aria-hidden="true" />
                </IconButton>
              </td>
            </tr>
          ))}
        </tbody>
      </Table>
      <Button
        variant="outline"
        size="sm"
        disabled={disabled}
        onClick={() => {
          setRows((current) => [...current, { key: next, values: {} }]);
          setNext((n) => n + 1);
        }}
      >
        <Icons name="Plus" size={14} aria-hidden="true" />
        {label}を追加
      </Button>
    </div>
  );
}
