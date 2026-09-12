import type { Meta, StoryObj } from "@storybook/react-vite";
import {
  QuestionnaireActions,
  QuestionnaireChoice,
  QuestionnaireChoices,
  QuestionnaireItem,
  QuestionnaireNext,
  QuestionnaireProgress,
  QuestionnaireTitle,
} from "../Questionnaire/Questionnaire";
import { QuestionnaireNew } from "./index";

const meta = {
  title: "Components/QuestionnaireNew",
  component: QuestionnaireNew,
  parameters: { layout: "centered" },
} satisfies Meta<typeof QuestionnaireNew>;
export default meta;
type Story = StoryObj<typeof meta>;

export const SingleStep: Story = {
  args: { items: [{ name: "interest", required: true }] },
  render: () => (
    <QuestionnaireNew items={[{ name: "interest", required: true }]} style={{ width: 360 }}>
      <QuestionnaireProgress />
      <QuestionnaireItem name="interest">
        <QuestionnaireTitle>興味のある分野</QuestionnaireTitle>
        <QuestionnaireChoices>
          <QuestionnaireChoice value="web">Web</QuestionnaireChoice>
          <QuestionnaireChoice value="cloud">Cloud</QuestionnaireChoice>
        </QuestionnaireChoices>
      </QuestionnaireItem>
      <QuestionnaireActions>
        <QuestionnaireNext />
      </QuestionnaireActions>
    </QuestionnaireNew>
  ),
};
