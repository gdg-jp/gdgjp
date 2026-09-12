import type { Meta, StoryObj } from "@storybook/react-vite";
import { Button } from "../Button";
import { ButtonGroup, ButtonGroupSeparator, ButtonGroupText } from "./ButtonGroup";

const meta = {
  title: "Components/ButtonGroup",
  component: ButtonGroup,
  parameters: { layout: "centered" },
} satisfies Meta<typeof ButtonGroup>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Actions: Story = {
  render: () => (
    <ButtonGroup aria-label="表示操作">
      <Button variant="outline">前へ</Button>
      <ButtonGroupSeparator />
      <Button variant="outline">次へ</Button>
      <ButtonGroupText>3 / 8</ButtonGroupText>
    </ButtonGroup>
  ),
};
