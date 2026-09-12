import type { Meta, StoryObj } from "@storybook/react-vite";
import { Inline } from "../Inline";
import { RadioGroup, RadioGroupItem } from "./RadioGroup";

const meta = {
  title: "Components/RadioGroup",
  component: RadioGroup,
  parameters: { layout: "centered" },
} satisfies Meta<typeof RadioGroup>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <RadioGroup aria-label="参加方法" defaultValue="venue">
      <Inline>
        <RadioGroupItem id="venue-option" value="venue" />
        <label htmlFor="venue-option">会場</label>
        <RadioGroupItem id="online-option" value="online" />
        <label htmlFor="online-option">オンライン</label>
      </Inline>
    </RadioGroup>
  ),
};
