import type { Meta, StoryObj } from "@storybook/react-vite";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./Tabs";

const meta: Meta = {
  title: "Components/Tabs",
  component: Tabs,
  parameters: { layout: "centered" },
} satisfies Meta<typeof Tabs>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <Tabs defaultValue="overview" style={{ width: 360 }}>
      <TabsList aria-label="イベント情報">
        <TabsTrigger value="overview">概要</TabsTrigger>
        <TabsTrigger value="schedule">タイムテーブル</TabsTrigger>
        <TabsTrigger value="access">アクセス</TabsTrigger>
      </TabsList>
      <TabsContent value="overview">イベントの概要を表示します。</TabsContent>
      <TabsContent value="schedule">当日のタイムテーブルを表示します。</TabsContent>
      <TabsContent value="access">会場までのアクセスを表示します。</TabsContent>
    </Tabs>
  ),
};
