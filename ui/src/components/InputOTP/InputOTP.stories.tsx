import type { Meta, StoryObj } from "@storybook/react-vite";
import { InputOTP, InputOTPGroup, InputOTPSeparator, InputOTPSlot } from "./InputOTP";

const meta = {
  title: "Components/InputOTP",
  component: InputOTP,
  parameters: { layout: "centered" },
} satisfies Meta<typeof InputOTP>;
export default meta;
type Story = StoryObj<typeof meta>;

export const SixDigits: Story = {
  render: () => (
    <InputOTP defaultValue="12" maxLength={6} aria-label="確認コード">
      <InputOTPGroup>
        {[0, 1, 2].map((index) => (
          <InputOTPSlot key={index} index={index} />
        ))}
      </InputOTPGroup>
      <InputOTPSeparator />
      <InputOTPGroup>
        {[3, 4, 5].map((index) => (
          <InputOTPSlot key={index} index={index} />
        ))}
      </InputOTPGroup>
    </InputOTP>
  ),
};
