import type { Meta, StoryObj } from "@storybook/react-vite";
import {
  Questionnaire,
  QuestionnaireActions,
  QuestionnaireChoice,
  QuestionnaireChoices,
  QuestionnaireDescription,
  QuestionnaireError,
  QuestionnaireItem,
  QuestionnaireNext,
  QuestionnairePrevious,
  QuestionnaireProgress,
  QuestionnaireSubmit,
  QuestionnaireTitle,
} from "./Questionnaire";

const meta = {
  title: "Components/Questionnaire",
  component: Questionnaire,
  parameters: { layout: "centered" },
} satisfies Meta<typeof Questionnaire>;
export default meta;
type Story = StoryObj<typeof meta>;

const items = [
  { name: "format", required: true, prompt: "参加形式" },
  { name: "topic", required: true, prompt: "興味のあるテーマ" },
];

export const Steps: Story = {
  args: { items },
  render: () => (
    <Questionnaire items={items} style={{ width: 420 }}>
      <QuestionnaireProgress />
      <QuestionnaireItem name="format">
        <QuestionnaireTitle>参加形式</QuestionnaireTitle>
        <QuestionnaireDescription>参加しやすい方法を選択してください。</QuestionnaireDescription>
        <QuestionnaireChoices>
          <QuestionnaireChoice value="venue">会場</QuestionnaireChoice>
          <QuestionnaireChoice value="online">オンライン</QuestionnaireChoice>
        </QuestionnaireChoices>
        <QuestionnaireError />
      </QuestionnaireItem>
      <QuestionnaireItem name="topic">
        <QuestionnaireTitle>興味のあるテーマ</QuestionnaireTitle>
        <QuestionnaireChoices>
          <QuestionnaireChoice value="web">Web</QuestionnaireChoice>
          <QuestionnaireChoice value="ai">生成AI</QuestionnaireChoice>
        </QuestionnaireChoices>
        <QuestionnaireError />
      </QuestionnaireItem>
      <QuestionnaireActions>
        <QuestionnairePrevious />
        <QuestionnaireNext />
        <QuestionnaireSubmit />
      </QuestionnaireActions>
    </Questionnaire>
  ),
};
