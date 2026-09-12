import type { Meta, StoryObj } from "@storybook/react-vite";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "./Accordion";

const meta: Meta = {
  title: "Components/Accordion",
  component: Accordion,
  parameters: { layout: "centered" },
} satisfies Meta<typeof Accordion>;
export default meta;
type Story = StoryObj;

export const Default: Story = {
  render: () => (
    <Accordion type="single" collapsible defaultValue="registration">
      <AccordionItem value="registration">
        <AccordionTrigger>参加方法を教えてください</AccordionTrigger>
        <AccordionContent>イベントページから参加登録できます。</AccordionContent>
      </AccordionItem>
      <AccordionItem value="venue">
        <AccordionTrigger>会場はどこですか？</AccordionTrigger>
        <AccordionContent>開催前にメールで会場の詳細をお知らせします。</AccordionContent>
      </AccordionItem>
    </Accordion>
  ),
};
