import type { Meta, StoryObj } from "@storybook/react-vite";
import {
  Toast,
  ToastAction,
  ToastClose,
  ToastDescription,
  ToastProvider,
  ToastTitle,
  ToastViewport,
} from "./Toast";

const meta = {
  title: "Components/Toast",
  component: Toast,
  parameters: { layout: "centered" },
} satisfies Meta<typeof Toast>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Saved: Story = {
  render: () => (
    <ToastProvider>
      <Toast open>
        <ToastTitle>保存しました</ToastTitle>
        <ToastDescription>イベント情報を更新しました。</ToastDescription>
        <ToastAction altText="元に戻す">元に戻す</ToastAction>
        <ToastClose aria-label="通知を閉じる">×</ToastClose>
      </Toast>
      <ToastViewport />
    </ToastProvider>
  ),
};
