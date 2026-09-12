import type { Meta, StoryObj } from "@storybook/react-vite";
import { Badge } from "../Badge";
import { Link } from "../Link";
import { Table } from "./Table";

const meta = {
  title: "Components/Table",
  component: Table,
  parameters: { layout: "centered" },
} satisfies Meta<typeof Table>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <Table>
      <caption>開催予定のイベント</caption>
      <thead>
        <tr>
          <th scope="col">イベント名</th>
          <th scope="col">開催日</th>
          <th scope="col">状態</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>
            <Link href="#meetup">GDG Apps Meetup</Link>
          </td>
          <td>2026/09/26</td>
          <td>
            <Badge tone="success">公開中</Badge>
          </td>
        </tr>
        <tr>
          <td>
            <Link href="#workshop">Cloud Workshop</Link>
          </td>
          <td>2026/10/10</td>
          <td>
            <Badge>下書き</Badge>
          </td>
        </tr>
      </tbody>
    </Table>
  ),
};
