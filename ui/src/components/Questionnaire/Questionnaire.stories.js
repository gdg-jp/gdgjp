import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
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
};
export default meta;
const items = [
  { name: "format", required: true, prompt: "参加形式" },
  { name: "topic", required: true, prompt: "興味のあるテーマ" },
];
export const Steps = {
  args: { items },
  render: () =>
    _jsxs(Questionnaire, {
      items: items,
      style: { width: 420 },
      children: [
        _jsx(QuestionnaireProgress, {}),
        _jsxs(QuestionnaireItem, {
          name: "format",
          children: [
            _jsx(QuestionnaireTitle, { children: "\u53C2\u52A0\u5F62\u5F0F" }),
            _jsx(QuestionnaireDescription, {
              children:
                "\u53C2\u52A0\u3057\u3084\u3059\u3044\u65B9\u6CD5\u3092\u9078\u629E\u3057\u3066\u304F\u3060\u3055\u3044\u3002",
            }),
            _jsxs(QuestionnaireChoices, {
              children: [
                _jsx(QuestionnaireChoice, { value: "venue", children: "\u4F1A\u5834" }),
                _jsx(QuestionnaireChoice, {
                  value: "online",
                  children: "\u30AA\u30F3\u30E9\u30A4\u30F3",
                }),
              ],
            }),
            _jsx(QuestionnaireError, {}),
          ],
        }),
        _jsxs(QuestionnaireItem, {
          name: "topic",
          children: [
            _jsx(QuestionnaireTitle, {
              children: "\u8208\u5473\u306E\u3042\u308B\u30C6\u30FC\u30DE",
            }),
            _jsxs(QuestionnaireChoices, {
              children: [
                _jsx(QuestionnaireChoice, { value: "web", children: "Web" }),
                _jsx(QuestionnaireChoice, { value: "ai", children: "\u751F\u6210AI" }),
              ],
            }),
            _jsx(QuestionnaireError, {}),
          ],
        }),
        _jsxs(QuestionnaireActions, {
          children: [
            _jsx(QuestionnairePrevious, {}),
            _jsx(QuestionnaireNext, {}),
            _jsx(QuestionnaireSubmit, {}),
          ],
        }),
      ],
    }),
};
