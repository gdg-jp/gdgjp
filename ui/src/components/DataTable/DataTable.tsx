import {
  Children,
  type ComponentProps,
  type ReactNode,
  isValidElement,
  useMemo,
  useState,
} from "react";
import { cn } from "../../utils";
import { Table } from "../Table";

export type DataTableColumn<T> = {
  id: string;
  header: ReactNode;
  accessorKey?: keyof T;
  accessor?: (row: T) => ReactNode;
  cell?: (row: T, index: number) => ReactNode;
  sortable?: boolean;
};

type SortState = { id: string; direction: "asc" | "desc" } | undefined;

function getTextContent(node: ReactNode): string {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number" || typeof node === "bigint") {
    return String(node);
  }
  if (isValidElement(node)) {
    return getTextContent((node.props as { children?: ReactNode }).children);
  }

  let text = "";
  Children.forEach(node, (child) => {
    text += getTextContent(child);
  });
  return text;
}

function getContentWidth(node: ReactNode): number {
  return Math.max(
    1,
    ...getTextContent(node)
      .split(/\r?\n/u)
      .map((line) => Array.from(line).length),
  );
}

function getCellContent<T extends object>(
  column: DataTableColumn<T>,
  row: T,
  index: number,
): ReactNode {
  return (
    column.cell?.(row, index) ??
    (column.accessor ? column.accessor(row) : String(row[column.accessorKey as keyof T] ?? ""))
  );
}

function getColumnWidthPercentages<T extends object>(
  columns: DataTableColumn<T>[],
  cells: ReactNode[][],
): number[] {
  const maxWidths = columns.map((column, columnIndex) =>
    Math.max(
      getContentWidth(column.header) + (column.sortable ? 2 : 0),
      ...cells.map((row) => getContentWidth(row[columnIndex])),
    ),
  );
  const totalWidth = maxWidths.reduce((total, width) => total + width, 0);
  return maxWidths.map((width) => (width / totalWidth) * 100);
}

export function DataTable<T extends object>({
  columns,
  data,
  caption,
  emptyMessage = "表示するデータがありません。",
  getRowId,
  onRowClick,
  className,
  ...props
}: ComponentProps<"table"> & {
  columns: DataTableColumn<T>[];
  data: T[];
  caption?: ReactNode;
  emptyMessage?: ReactNode;
  getRowId?: (row: T, index: number) => string;
  onRowClick?: (row: T, index: number) => void;
}) {
  const [sort, setSort] = useState<SortState>();
  const sortedData = useMemo(() => {
    if (!sort) return data;
    const column = columns.find((candidate) => candidate.id === sort.id);
    if (!column?.accessorKey && !column?.accessor) return data;
    const getValue = (row: T) => column.accessor?.(row) ?? row[column.accessorKey as keyof T];
    return data
      .map((row, index) => ({ row, index, value: getValue(row) }))
      .sort((a, b) => {
        const left = String(a.value ?? "");
        const right = String(b.value ?? "");
        return (
          left.localeCompare(right, "ja", { numeric: true }) * (sort.direction === "asc" ? 1 : -1)
        );
      })
      .map((item) => item.row);
  }, [columns, data, sort]);
  const cells = useMemo(
    () =>
      sortedData.map((row, index) => columns.map((column) => getCellContent(column, row, index))),
    [columns, sortedData],
  );
  const columnWidthPercentages = useMemo(
    () => getColumnWidthPercentages(columns, cells),
    [cells, columns],
  );

  return (
    <Table {...props} className={cn("gdg-data-table", className)}>
      {caption && <caption>{caption}</caption>}
      <colgroup>
        {columns.map((column, index) => (
          <col key={column.id} style={{ width: `${columnWidthPercentages[index]}%` }} />
        ))}
      </colgroup>
      <thead>
        <tr>
          {columns.map((column) => {
            const direction = sort?.id === column.id ? sort.direction : undefined;
            return (
              <th
                key={column.id}
                scope="col"
                aria-sort={
                  direction ? (direction === "asc" ? "ascending" : "descending") : undefined
                }
              >
                {column.sortable ? (
                  <button
                    type="button"
                    className="gdg-data-table-sort"
                    onClick={() =>
                      setSort({ id: column.id, direction: direction === "asc" ? "desc" : "asc" })
                    }
                  >
                    {column.header}
                    <span aria-hidden="true">
                      {direction === "asc" ? " ↑" : direction === "desc" ? " ↓" : " ↕"}
                    </span>
                  </button>
                ) : (
                  column.header
                )}
              </th>
            );
          })}
        </tr>
      </thead>
      <tbody>
        {sortedData.length === 0 ? (
          <tr>
            <td colSpan={columns.length}>{emptyMessage}</td>
          </tr>
        ) : (
          sortedData.map((row, index) => (
            <tr
              key={getRowId?.(row, index) ?? String(index)}
              tabIndex={onRowClick ? 0 : undefined}
              onClick={onRowClick ? () => onRowClick(row, index) : undefined}
              onKeyDown={
                onRowClick
                  ? (event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        onRowClick(row, index);
                      }
                    }
                  : undefined
              }
            >
              {columns.map((column, columnIndex) => (
                <td key={column.id}>{cells[index]?.[columnIndex]}</td>
              ))}
            </tr>
          ))
        )}
      </tbody>
    </Table>
  );
}
