import type { Meta, StoryObj } from "@storybook/react-vite";
import { Alert } from "./Alert";

const meta = {
  title: "Components/Alert",
  component: Alert,
  parameters: { layout: "centered" },
  args: { title: "お知らせ", children: "イベントの準備が完了しました。" },
} satisfies Meta<typeof Alert>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Info: Story = { args: { tone: "info" } };
export const Success: Story = { args: { tone: "success", title: "保存しました" } };
export const Warning: Story = { args: { tone: "warning", title: "確認してください" } };
export const Danger: Story = { args: { tone: "danger", title: "保存できません" } };
