import type { Meta, StoryObj } from "@storybook/react-vite";
import {
  Typography,
  TypographyBlockquote,
  TypographyH1,
  TypographyH2,
  TypographyInlineCode,
  TypographyLead,
  TypographyList,
} from "./Typography";

const meta = {
  title: "Components/Typography",
  component: Typography,
  parameters: { layout: "centered" },
} satisfies Meta<typeof Typography>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Scale: Story = {
  render: () => (
    <div style={{ width: 520 }}>
      <TypographyH1>GDG Apps</TypographyH1>
      <TypographyLead>コミュニティの活動を、明瞭に伝える。</TypographyLead>
      <TypographyH2>イベントを探す</TypographyH2>
      <Typography variant="p">本文の読みやすさと操作の分かりやすさをそろえます。</Typography>
      <TypographyBlockquote>学び、つながり、共有する。</TypographyBlockquote>
      <TypographyList>
        <li>アクセシビリティ</li>
        <li>テーマ対応</li>
      </TypographyList>
      <TypographyInlineCode>pnpm test</TypographyInlineCode>
    </div>
  ),
};
