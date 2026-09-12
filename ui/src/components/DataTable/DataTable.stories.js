import { jsx as _jsx } from "react/jsx-runtime";
import { DataTable } from "./DataTable";
const meta = {
  title: "Components/DataTable",
  component: ChapterTable,
  parameters: { layout: "centered" },
};
export default meta;
const columns = [
  { id: "name", header: "チャプター", accessorKey: "name", sortable: true },
  { id: "members", header: "参加者", accessorKey: "members", sortable: true },
  { id: "status", header: "状態", accessorKey: "status" },
];
const data = [
  { id: "tokyo", name: "Tokyo", members: 128, status: "公開" },
  { id: "osaka", name: "Osaka", members: 84, status: "準備中" },
];
function ChapterTable({ columns, data, ...props }) {
  return _jsx(DataTable, { ...props, columns: columns, data: data });
}
export const Sortable = {
  args: { columns, data },
  render: () =>
    _jsx(DataTable, {
      columns: columns,
      data: data,
      caption: "\u30C1\u30E3\u30D7\u30BF\u30FC\u4E00\u89A7",
      getRowId: (row) => row.id,
      style: { minWidth: 420 },
    }),
};
export const ContentWeighted = {
  args: { columns, data },
  render: () =>
    _jsx(DataTable, {
      columns: columns,
      data: [
        { id: "tokyo", name: "Tokyo chapter", members: 128, status: "公開" },
        { id: "osaka", name: "Osaka", members: 84, status: "準備中" },
      ],
      caption: "\u5185\u5BB9\u306B\u5FDC\u3058\u305F\u5217\u5E45",
      getRowId: (row) => row.id,
      style: { minWidth: 420 },
    }),
};
