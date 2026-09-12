import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
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
};
export default meta;
export const SingleStep = {
  args: { items: [{ name: "interest", required: true }] },
  render: () =>
    _jsxs(QuestionnaireNew, {
      items: [{ name: "interest", required: true }],
      style: { width: 360 },
      children: [
        _jsx(QuestionnaireProgress, {}),
        _jsxs(QuestionnaireItem, {
          name: "interest",
          children: [
            _jsx(QuestionnaireTitle, { children: "\u8208\u5473\u306E\u3042\u308B\u5206\u91CE" }),
            _jsxs(QuestionnaireChoices, {
              children: [
                _jsx(QuestionnaireChoice, { value: "web", children: "Web" }),
                _jsx(QuestionnaireChoice, { value: "cloud", children: "Cloud" }),
              ],
            }),
          ],
        }),
        _jsx(QuestionnaireActions, { children: _jsx(QuestionnaireNext, {}) }),
      ],
    }),
};
