import { Textarea } from "./Textarea";
const meta = {
  title: "Components/Textarea",
  component: Textarea,
  parameters: { layout: "centered" },
  args: { placeholder: "イベントの説明を入力" },
};
export default meta;
export const Default = {};
export const WithValue = {
  args: { defaultValue: "開発者同士で学び、つながる一日です。" },
};
