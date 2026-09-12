import { renderToStaticMarkup } from "react-dom/server";
import { jsx as _jsx } from "react/jsx-runtime";
import { describe, expect, it } from "vitest";
import { DataTable } from "./DataTable";
const columns = [
  { id: "name", header: "名前", accessorKey: "name" },
  { id: "count", header: "数", accessorKey: "count" },
  { id: "status", header: "状態", accessorKey: "status" },
];
describe("DataTable", () => {
  it("allocates default column widths from each column's maximum content width", () => {
    const markup = renderToStaticMarkup(
      _jsx(DataTable, {
        columns: columns,
        data: [
          { name: "コミュニティの長い名前", count: 1234, status: "公開" },
          { name: "短い名前", count: 5678, status: "準備中" },
        ],
      }),
    );
    const widths = [...markup.matchAll(/<col style="width:([\d.]+)%"/g)].map((match) =>
      Number(match[1]),
    );
    expect(widths).toHaveLength(3);
    expect(widths[0]).toBeGreaterThan(widths[1]);
    expect(widths[1]).toBeGreaterThan(widths[2]);
    expect(widths.reduce((total, width) => total + width, 0)).toBeCloseTo(100);
  });
  it("uses rendered custom cell content for the default width", () => {
    const customColumns = [
      {
        id: "name",
        header: "名前",
        cell: (row) => _jsx("a", { href: `/${row.name}`, children: row.name }),
      },
      { id: "status", header: "状態", accessorKey: "status" },
    ];
    const markup = renderToStaticMarkup(
      _jsx(DataTable, {
        columns: customColumns,
        data: [{ name: "非常に長い表示名", count: 1, status: "公開" }],
      }),
    );
    const widths = [...markup.matchAll(/<col style="width:([\d.]+)%"/g)].map((match) =>
      Number(match[1]),
    );
    expect(markup).toContain(">非常に長い表示名</a>");
    expect(widths[0]).toBeGreaterThan(widths[1]);
  });
});
