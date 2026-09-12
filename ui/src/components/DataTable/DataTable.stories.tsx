import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ComponentProps } from "react";
import { DataTable, type DataTableColumn } from "./DataTable";

const meta = {
  title: "Components/DataTable",
  component: ChapterTable,
  parameters: { layout: "centered" },
} satisfies Meta<typeof ChapterTable>;
export default meta;
type Story = StoryObj<typeof meta>;

type Chapter = { id: string; name: string; members: number; status: string };
const columns: DataTableColumn<Chapter>[] = [
  { id: "name", header: "チャプター", accessorKey: "name", sortable: true },
  { id: "members", header: "参加者", accessorKey: "members", sortable: true },
  { id: "status", header: "状態", accessorKey: "status" },
];
const data: Chapter[] = [
  { id: "tokyo", name: "Tokyo", members: 128, status: "公開" },
  { id: "osaka", name: "Osaka", members: 84, status: "準備中" },
];

function ChapterTable({
  columns,
  data,
  ...props
}: ComponentProps<"table"> & {
  columns: DataTableColumn<Chapter>[];
  data: Chapter[];
}) {
  return <DataTable<Chapter> {...props} columns={columns} data={data} />;
}

export const Sortable: Story = {
  args: { columns, data },
  render: () => (
    <DataTable
      columns={columns}
      data={data}
      caption="チャプター一覧"
      getRowId={(row) => row.id}
      style={{ minWidth: 420 }}
    />
  ),
};

export const ContentWeighted: Story = {
  args: { columns, data },
  render: () => (
    <DataTable
      columns={columns}
      data={[
        { id: "tokyo", name: "Tokyo chapter", members: 128, status: "公開" },
        { id: "osaka", name: "Osaka", members: 84, status: "準備中" },
      ]}
      caption="内容に応じた列幅"
      getRowId={(row) => row.id}
      style={{ minWidth: 420 }}
    />
  ),
};
