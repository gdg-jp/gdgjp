import type { Meta, StoryObj } from "@storybook/react-vite";
import { Info } from "lucide-react";
import { Marker, MarkerContent, MarkerIcon } from "./Marker";

const meta = {
  title: "Components/Marker",
  component: Marker,
  parameters: { layout: "centered" },
} satisfies Meta<typeof Marker>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Notice: Story = {
  render: () => (
    <Marker variant="separator" style={{ width: 420 }}>
      <MarkerIcon>
        <Info size={16} />
      </MarkerIcon>
      <MarkerContent>申し込み期限は9月30日です。</MarkerContent>
    </Marker>
  ),
};
