import { Children, isValidElement, useMemo, useState } from "react";
import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { cn } from "../../utils";
import { Table } from "../Table";
function getTextContent(node) {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number" || typeof node === "bigint") {
    return String(node);
  }
  if (isValidElement(node)) {
    return getTextContent(node.props.children);
  }
  let text = "";
  Children.forEach(node, (child) => {
    text += getTextContent(child);
  });
  return text;
}
function getContentWidth(node) {
  return Math.max(
    1,
    ...getTextContent(node)
      .split(/\r?\n/u)
      .map((line) => Array.from(line).length),
  );
}
function getCellContent(column, row, index) {
  return (
    column.cell?.(row, index) ??
    (column.accessor ? column.accessor(row) : String(row[column.accessorKey] ?? ""))
  );
}
function getColumnWidthPercentages(columns, cells) {
  const maxWidths = columns.map((column, columnIndex) =>
    Math.max(
      getContentWidth(column.header) + (column.sortable ? 2 : 0),
      ...cells.map((row) => getContentWidth(row[columnIndex])),
    ),
  );
  const totalWidth = maxWidths.reduce((total, width) => total + width, 0);
  return maxWidths.map((width) => (width / totalWidth) * 100);
}
export function DataTable({
  columns,
  data,
  caption,
  emptyMessage = "表示するデータがありません。",
  getRowId,
  onRowClick,
  className,
  ...props
}) {
  const [sort, setSort] = useState();
  const sortedData = useMemo(() => {
    if (!sort) return data;
    const column = columns.find((candidate) => candidate.id === sort.id);
    if (!column?.accessorKey && !column?.accessor) return data;
    const getValue = (row) => column.accessor?.(row) ?? row[column.accessorKey];
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
  return _jsxs(Table, {
    ...props,
    className: cn("gdg-data-table", className),
    children: [
      caption && _jsx("caption", { children: caption }),
      _jsx("colgroup", {
        children: columns.map((column, index) =>
          _jsx("col", { style: { width: `${columnWidthPercentages[index]}%` } }, column.id),
        ),
      }),
      _jsx("thead", {
        children: _jsx("tr", {
          children: columns.map((column) => {
            const direction = sort?.id === column.id ? sort.direction : undefined;
            return _jsx(
              "th",
              {
                scope: "col",
                "aria-sort": direction
                  ? direction === "asc"
                    ? "ascending"
                    : "descending"
                  : undefined,
                children: column.sortable
                  ? _jsxs("button", {
                      type: "button",
                      className: "gdg-data-table-sort",
                      onClick: () =>
                        setSort({ id: column.id, direction: direction === "asc" ? "desc" : "asc" }),
                      children: [
                        column.header,
                        _jsx("span", {
                          "aria-hidden": "true",
                          children: direction === "asc" ? " ↑" : direction === "desc" ? " ↓" : " ↕",
                        }),
                      ],
                    })
                  : column.header,
              },
              column.id,
            );
          }),
        }),
      }),
      _jsx("tbody", {
        children:
          sortedData.length === 0
            ? _jsx("tr", {
                children: _jsx("td", { colSpan: columns.length, children: emptyMessage }),
              })
            : sortedData.map((row, index) =>
                _jsx(
                  "tr",
                  {
                    tabIndex: onRowClick ? 0 : undefined,
                    onClick: onRowClick ? () => onRowClick(row, index) : undefined,
                    onKeyDown: onRowClick
                      ? (event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            onRowClick(row, index);
                          }
                        }
                      : undefined,
                    children: columns.map((column, columnIndex) =>
                      _jsx("td", { children: cells[index]?.[columnIndex] }, column.id),
                    ),
                  },
                  getRowId?.(row, index) ?? String(index),
                ),
              ),
      }),
    ],
  });
}
