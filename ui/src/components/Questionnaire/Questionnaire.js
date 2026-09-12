import { Check, ChevronLeft, ChevronRight } from "lucide-react";
import { createContext, useContext, useId, useRef, useState } from "react";
import { Fragment as _Fragment, jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { cn } from "../../utils";
import { Button } from "../Button";
import { Progress, ProgressIndicator } from "../Progress";
const QuestionnaireContext = createContext(null);
const QuestionnaireItemContext = createContext(null);
function useQuestionnaire() {
  const context = useContext(QuestionnaireContext);
  if (!context) throw new Error("Questionnaire parts must be used inside Questionnaire");
  return context;
}
function useQuestionnaireItem() {
  return useContext(QuestionnaireItemContext);
}
function answerExists(answer) {
  return Array.isArray(answer) ? answer.length > 0 : !!answer?.trim();
}
export function Questionnaire({
  items,
  index: controlledIndex,
  defaultIndex = 0,
  onIndexChange,
  onSubmit,
  className,
  children,
  ...props
}) {
  const [internalIndex, setInternalIndex] = useState(defaultIndex);
  const [answers, setAnswers] = useState({});
  const [errors, setErrors] = useState({});
  const [lastSubmitted, setLastSubmitted] = useState(false);
  const answerRef = useRef(null);
  const index = Math.min(
    Math.max(controlledIndex ?? internalIndex, 0),
    Math.max(items.length - 1, 0),
  );
  const activeItem = items[index];
  const setIndex = (next) => {
    const bounded = Math.min(Math.max(next, 0), Math.max(items.length - 1, 0));
    if (controlledIndex === undefined) setInternalIndex(bounded);
    onIndexChange?.(bounded);
  };
  const setAnswer = (name, answer) => {
    setAnswers((current) => ({ ...current, [name]: answer }));
    setErrors((current) => ({ ...current, [name]: undefined }));
  };
  const validate = () => {
    if (!activeItem?.required || answerExists(answers[activeItem.name])) {
      if (activeItem) setErrors((current) => ({ ...current, [activeItem.name]: undefined }));
      return true;
    }
    if (activeItem)
      setErrors((current) => ({
        ...current,
        [activeItem.name]: "回答を選択または入力してください。",
      }));
    return false;
  };
  const move = (offset) => {
    if (offset > 0 && !validate()) {
      window.requestAnimationFrame(() => answerRef.current?.focus());
      return;
    }
    setIndex(index + offset);
    window.requestAnimationFrame(() => answerRef.current?.focus());
  };
  const focusAnswer = () => answerRef.current?.focus();
  const registerAnswer = (node, active) => {
    if (active) answerRef.current = node;
  };
  const context = {
    items,
    index,
    setIndex,
    answers,
    setAnswer,
    errors,
    setError: (name, error) => setErrors((current) => ({ ...current, [name]: error })),
    activeItem,
    activeIndex: index,
    validate,
    move,
    focusAnswer,
    registerAnswer,
  };
  return _jsx(QuestionnaireContext.Provider, {
    value: context,
    children: _jsx("form", {
      ...props,
      className: cn("gdg-questionnaire", className),
      onKeyDown: (event) => {
        if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement)
          return;
        const shortcut = activeItem?.choices?.find(
          (choice) => choice.shortcut?.toLowerCase() === event.key.toLowerCase(),
        );
        if (shortcut) {
          event.preventDefault();
          const currentAnswer = answers[activeItem.name];
          setAnswer(
            activeItem.name,
            activeItem.multiple
              ? [
                  ...(Array.isArray(currentAnswer) ? currentAnswer : []).filter(
                    (value) => value !== shortcut.value,
                  ),
                  ...(Array.isArray(currentAnswer) && currentAnswer.includes(shortcut.value)
                    ? []
                    : [shortcut.value]),
                ]
              : shortcut.value,
          );
        }
        props.onKeyDown?.(event);
      },
      onSubmit: (event) => {
        if (!validate()) {
          event.preventDefault();
          window.requestAnimationFrame(() => answerRef.current?.focus());
          return;
        }
        if (index < items.length - 1 && !lastSubmitted) {
          event.preventDefault();
          move(1);
          return;
        }
        setLastSubmitted(true);
        onSubmit?.(event);
      },
      children: children,
    }),
  });
}
export function QuestionnaireProgress({ className, ...props }) {
  const context = useQuestionnaire();
  const total = context.items.length;
  const current = total ? context.index + 1 : 0;
  return _jsxs("div", {
    ...props,
    className: cn("gdg-questionnaire-progress", className),
    children: [
      _jsxs("span", { children: ["\u8CEA\u554F ", current, " / ", total] }),
      _jsx(Progress, {
        value: total ? (current / total) * 100 : 0,
        "aria-label": "\u8CEA\u554F\u306E\u9032\u6357",
        children: _jsx(ProgressIndicator, {}),
      }),
    ],
  });
}
export function QuestionnaireItem({ name, required, className, children, ...props }) {
  const context = useQuestionnaire();
  const itemIndex = context.items.findIndex((item) => item.name === name);
  const active = itemIndex === context.index;
  const definition = context.items[itemIndex];
  return _jsx(QuestionnaireItemContext.Provider, {
    value: { definition, active },
    children: _jsx("fieldset", {
      ...props,
      hidden: !active,
      inert: !active ? true : undefined,
      "data-state": active ? "active" : "inactive",
      "data-required": required ?? definition?.required,
      className: cn("gdg-questionnaire-item", className),
      children: children,
    }),
  });
}
export function QuestionnaireTitle({ className, ...props }) {
  return _jsx("legend", { ...props, className: cn("gdg-questionnaire-title", className) });
}
export function QuestionnaireDescription({ className, ...props }) {
  return _jsx("p", { ...props, className: cn("gdg-questionnaire-description", className) });
}
export function QuestionnaireChoices({ className, ...props }) {
  return _jsx("div", { ...props, className: cn("gdg-questionnaire-choices", className) });
}
export function QuestionnaireChoice({ value, className, children, ...props }) {
  const context = useQuestionnaire();
  const itemContext = useQuestionnaireItem();
  const item = itemContext?.definition ?? context.activeItem;
  const active = itemContext?.active ?? true;
  const multiple = item?.multiple ?? false;
  const current = context.answers[item?.name ?? ""];
  const checked = multiple ? Array.isArray(current) && current.includes(value) : current === value;
  const inputName = item?.name ?? "answer";
  return _jsxs("label", {
    ...props,
    "data-state": checked ? "checked" : "unchecked",
    className: cn("gdg-questionnaire-choice", className),
    children: [
      _jsx("input", {
        ref: (node) => context.registerAnswer(node, active),
        type: multiple ? "checkbox" : "radio",
        name: inputName,
        value: value,
        checked: checked,
        onChange: (event) => {
          if (!item) return;
          const next = multiple
            ? event.target.checked
              ? [...(Array.isArray(current) ? current : []), value]
              : (Array.isArray(current) ? current : []).filter((candidate) => candidate !== value)
            : value;
          context.setAnswer(item.name, next);
        },
      }),
      _jsx("span", {
        className: "gdg-questionnaire-choice-indicator",
        "aria-hidden": "true",
        children: _jsx(Check, { size: 14, className: "gdg-questionnaire-choice-check" }),
      }),
      _jsx("span", { className: "gdg-questionnaire-choice-content", children: children }),
    ],
  });
}
export function QuestionnaireInput({ className, name, ...props }) {
  const context = useQuestionnaire();
  const itemContext = useQuestionnaireItem();
  const item = itemContext?.definition ?? context.activeItem;
  const active = itemContext?.active ?? true;
  const inputName = name ?? item?.name ?? "answer";
  return _jsx("input", {
    ...props,
    ref: (node) => context.registerAnswer(node, active),
    name: inputName,
    "aria-label": props["aria-label"] ?? "自由記入欄",
    className: cn("gdg-input", "gdg-questionnaire-input", className),
    onChange: (event) => {
      if (item) context.setAnswer(item.name, event.target.value);
      props.onChange?.(event);
    },
  });
}
export function QuestionnaireError({ className, ...props }) {
  const context = useQuestionnaire();
  const itemContext = useQuestionnaireItem();
  const item = itemContext?.definition ?? context.activeItem;
  const error = item ? context.errors[item.name] : undefined;
  return _jsx("p", {
    ...props,
    role: "alert",
    hidden: !error,
    className: cn("gdg-questionnaire-error", className),
    children: error,
  });
}
export function QuestionnaireActions({ className, ...props }) {
  return _jsx("div", { ...props, className: cn("gdg-questionnaire-actions", className) });
}
export function QuestionnairePrevious({ className, children, ...props }) {
  const context = useQuestionnaire();
  return _jsx(Button, {
    ...props,
    type: "button",
    variant: props.variant ?? "outline",
    disabled: props.disabled ?? context.index === 0,
    className: cn("gdg-questionnaire-previous", className),
    onClick: (event) => {
      props.onClick?.(event);
      if (!event.defaultPrevented) context.move(-1);
    },
    children:
      children ??
      _jsxs(_Fragment, {
        children: [_jsx(ChevronLeft, { size: 16, "aria-hidden": "true" }), "\u524D\u3078"],
      }),
  });
}
export function QuestionnaireNext({ className, children, ...props }) {
  const context = useQuestionnaire();
  return _jsx(Button, {
    ...props,
    type: "button",
    variant: props.variant ?? "primary",
    disabled: props.disabled ?? context.index >= context.items.length - 1,
    className: cn("gdg-questionnaire-next", className),
    onClick: (event) => {
      props.onClick?.(event);
      if (!event.defaultPrevented) context.move(1);
    },
    children:
      children ??
      _jsxs(_Fragment, {
        children: ["\u6B21\u3078", _jsx(ChevronRight, { size: 16, "aria-hidden": "true" })],
      }),
  });
}
export function QuestionnaireSkip({ className, children, ...props }) {
  const context = useQuestionnaire();
  return _jsx(Button, {
    ...props,
    type: "button",
    variant: props.variant ?? "ghost",
    disabled: props.disabled ?? context.index >= context.items.length - 1,
    className: cn("gdg-questionnaire-skip", className),
    onClick: (event) => {
      props.onClick?.(event);
      if (!event.defaultPrevented) context.setIndex(context.index + 1);
    },
    children: children ?? "スキップ",
  });
}
export function QuestionnaireSubmit({ className, children, ...props }) {
  return _jsx(Button, {
    ...props,
    type: "submit",
    className: cn("gdg-questionnaire-submit", className),
    children: children ?? "送信",
  });
}
export { Questionnaire as QuestionnaireNew };
