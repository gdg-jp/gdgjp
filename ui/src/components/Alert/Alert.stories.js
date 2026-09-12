import { Alert } from "./Alert";
const meta = {
  title: "Components/Alert",
  component: Alert,
  parameters: { layout: "centered" },
  args: { title: "お知らせ", children: "イベントの準備が完了しました。" },
};
export default meta;
export const Info = { args: { tone: "info" } };
export const Success = { args: { tone: "success", title: "保存しました" } };
export const Warning = { args: { tone: "warning", title: "確認してください" } };
export const Danger = { args: { tone: "danger", title: "保存できません" } };
