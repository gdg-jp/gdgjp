import { Check, ChevronLeft, ChevronRight } from "lucide-react";
import {
  type ComponentProps,
  type FormEvent,
  type ReactNode,
  createContext,
  useContext,
  useId,
  useRef,
  useState,
} from "react";
import { cn } from "../../utils";
import { Button, type ButtonProps } from "../Button";
import { Progress, ProgressIndicator } from "../Progress";

export type QuestionnaireChoiceDefinition = {
  value: string;
  label?: ReactNode;
  description?: ReactNode;
  shortcut?: string;
};

export type QuestionnaireItemDefinition = {
  name: string;
  required?: boolean;
  multiple?: boolean;
  prompt?: ReactNode;
  description?: ReactNode;
  choices?: QuestionnaireChoiceDefinition[];
};

type Answer = string | string[] | undefined;
type QuestionnaireContextValue = {
  items: QuestionnaireItemDefinition[];
  index: number;
  setIndex: (index: number) => void;
  answers: Record<string, Answer>;
  setAnswer: (name: string, answer: Answer) => void;
  errors: Record<string, ReactNode | undefined>;
  setError: (name: string, error: ReactNode | undefined) => void;
  activeItem?: QuestionnaireItemDefinition;
  activeIndex: number;
  validate: () => boolean;
  move: (offset: number) => void;
  focusAnswer: () => void;
  registerAnswer: (node: HTMLElement | null, active: boolean) => void;
};

type QuestionnaireItemContextValue = {
  definition?: QuestionnaireItemDefinition;
  active: boolean;
};

const QuestionnaireContext = createContext<QuestionnaireContextValue | null>(null);
const QuestionnaireItemContext = createContext<QuestionnaireItemContextValue | null>(null);

function useQuestionnaire() {
  const context = useContext(QuestionnaireContext);
  if (!context) throw new Error("Questionnaire parts must be used inside Questionnaire");
  return context;
}

function useQuestionnaireItem() {
  return useContext(QuestionnaireItemContext);
}

function answerExists(answer: Answer) {
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
}: Omit<ComponentProps<"form">, "onSubmit"> & {
  items: QuestionnaireItemDefinition[];
  index?: number;
  defaultIndex?: number;
  onIndexChange?: (index: number) => void;
  onSubmit?: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const [internalIndex, setInternalIndex] = useState(defaultIndex);
  const [answers, setAnswers] = useState<Record<string, Answer>>({});
  const [errors, setErrors] = useState<Record<string, ReactNode | undefined>>({});
  const [lastSubmitted, setLastSubmitted] = useState(false);
  const answerRef = useRef<HTMLElement | null>(null);
  const index = Math.min(
    Math.max(controlledIndex ?? internalIndex, 0),
    Math.max(items.length - 1, 0),
  );
  const activeItem = items[index];
  const setIndex = (next: number) => {
    const bounded = Math.min(Math.max(next, 0), Math.max(items.length - 1, 0));
    if (controlledIndex === undefined) setInternalIndex(bounded);
    onIndexChange?.(bounded);
  };
  const setAnswer = (name: string, answer: Answer) => {
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
  const move = (offset: number) => {
    if (offset > 0 && !validate()) {
      window.requestAnimationFrame(() => answerRef.current?.focus());
      return;
    }
    setIndex(index + offset);
    window.requestAnimationFrame(() => answerRef.current?.focus());
  };
  const focusAnswer = () => answerRef.current?.focus();
  const registerAnswer = (node: HTMLElement | null, active: boolean) => {
    if (active) answerRef.current = node;
  };
  const context: QuestionnaireContextValue = {
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

  return (
    <QuestionnaireContext.Provider value={context}>
      <form
        {...props}
        className={cn("gdg-questionnaire", className)}
        onKeyDown={(event) => {
          if (
            event.target instanceof HTMLInputElement ||
            event.target instanceof HTMLTextAreaElement
          )
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
        }}
        onSubmit={(event) => {
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
        }}
      >
        {children}
      </form>
    </QuestionnaireContext.Provider>
  );
}

export function QuestionnaireProgress({ className, ...props }: ComponentProps<"div">) {
  const context = useQuestionnaire();
  const total = context.items.length;
  const current = total ? context.index + 1 : 0;
  return (
    <div {...props} className={cn("gdg-questionnaire-progress", className)}>
      <span>
        質問 {current} / {total}
      </span>
      <Progress value={total ? (current / total) * 100 : 0} aria-label="質問の進捗">
        <ProgressIndicator />
      </Progress>
    </div>
  );
}

export function QuestionnaireItem({
  name,
  required,
  className,
  children,
  ...props
}: ComponentProps<"fieldset"> & { name: string; required?: boolean }) {
  const context = useQuestionnaire();
  const itemIndex = context.items.findIndex((item) => item.name === name);
  const active = itemIndex === context.index;
  const definition = context.items[itemIndex];
  return (
    <QuestionnaireItemContext.Provider value={{ definition, active }}>
      <fieldset
        {...props}
        hidden={!active}
        inert={!active ? true : undefined}
        data-state={active ? "active" : "inactive"}
        data-required={required ?? definition?.required}
        className={cn("gdg-questionnaire-item", className)}
      >
        {children}
      </fieldset>
    </QuestionnaireItemContext.Provider>
  );
}

export function QuestionnaireTitle({ className, ...props }: ComponentProps<"legend">) {
  return <legend {...props} className={cn("gdg-questionnaire-title", className)} />;
}

export function QuestionnaireDescription({ className, ...props }: ComponentProps<"p">) {
  return <p {...props} className={cn("gdg-questionnaire-description", className)} />;
}

export function QuestionnaireChoices({ className, ...props }: ComponentProps<"div">) {
  return <div {...props} className={cn("gdg-questionnaire-choices", className)} />;
}

export function QuestionnaireChoice({
  value,
  className,
  children,
  ...props
}: ComponentProps<"label"> & { value: string }) {
  const context = useQuestionnaire();
  const itemContext = useQuestionnaireItem();
  const item = itemContext?.definition ?? context.activeItem;
  const active = itemContext?.active ?? true;
  const multiple = item?.multiple ?? false;
  const current = context.answers[item?.name ?? ""];
  const checked = multiple ? Array.isArray(current) && current.includes(value) : current === value;
  const inputName = item?.name ?? "answer";
  return (
    <label
      {...props}
      data-state={checked ? "checked" : "unchecked"}
      className={cn("gdg-questionnaire-choice", className)}
    >
      <input
        ref={(node) => context.registerAnswer(node, active)}
        type={multiple ? "checkbox" : "radio"}
        name={inputName}
        value={value}
        checked={checked}
        onChange={(event) => {
          if (!item) return;
          const next = multiple
            ? event.target.checked
              ? [...(Array.isArray(current) ? current : []), value]
              : (Array.isArray(current) ? current : []).filter((candidate) => candidate !== value)
            : value;
          context.setAnswer(item.name, next);
        }}
      />
      <span className="gdg-questionnaire-choice-indicator" aria-hidden="true">
        <Check size={14} className="gdg-questionnaire-choice-check" />
      </span>
      <span className="gdg-questionnaire-choice-content">{children}</span>
    </label>
  );
}

export function QuestionnaireInput({ className, name, ...props }: ComponentProps<"input">) {
  const context = useQuestionnaire();
  const itemContext = useQuestionnaireItem();
  const item = itemContext?.definition ?? context.activeItem;
  const active = itemContext?.active ?? true;
  const inputName = name ?? item?.name ?? "answer";
  return (
    <input
      {...props}
      ref={(node) => context.registerAnswer(node, active)}
      name={inputName}
      aria-label={props["aria-label"] ?? "自由記入欄"}
      className={cn("gdg-input", "gdg-questionnaire-input", className)}
      onChange={(event) => {
        if (item) context.setAnswer(item.name, event.target.value);
        props.onChange?.(event);
      }}
    />
  );
}

export function QuestionnaireError({ className, ...props }: ComponentProps<"p">) {
  const context = useQuestionnaire();
  const itemContext = useQuestionnaireItem();
  const item = itemContext?.definition ?? context.activeItem;
  const error = item ? context.errors[item.name] : undefined;
  return (
    <p {...props} role="alert" hidden={!error} className={cn("gdg-questionnaire-error", className)}>
      {error}
    </p>
  );
}

export function QuestionnaireActions({ className, ...props }: ComponentProps<"div">) {
  return <div {...props} className={cn("gdg-questionnaire-actions", className)} />;
}

export function QuestionnairePrevious({ className, children, ...props }: ButtonProps) {
  const context = useQuestionnaire();
  return (
    <Button
      {...props}
      type="button"
      variant={props.variant ?? "outline"}
      disabled={props.disabled ?? context.index === 0}
      className={cn("gdg-questionnaire-previous", className)}
      onClick={(event) => {
        props.onClick?.(event);
        if (!event.defaultPrevented) context.move(-1);
      }}
    >
      {children ?? (
        <>
          <ChevronLeft size={16} aria-hidden="true" />
          前へ
        </>
      )}
    </Button>
  );
}

export function QuestionnaireNext({ className, children, ...props }: ButtonProps) {
  const context = useQuestionnaire();
  return (
    <Button
      {...props}
      type="button"
      variant={props.variant ?? "primary"}
      disabled={props.disabled ?? context.index >= context.items.length - 1}
      className={cn("gdg-questionnaire-next", className)}
      onClick={(event) => {
        props.onClick?.(event);
        if (!event.defaultPrevented) context.move(1);
      }}
    >
      {children ?? (
        <>
          次へ
          <ChevronRight size={16} aria-hidden="true" />
        </>
      )}
    </Button>
  );
}

export function QuestionnaireSkip({ className, children, ...props }: ButtonProps) {
  const context = useQuestionnaire();
  return (
    <Button
      {...props}
      type="button"
      variant={props.variant ?? "ghost"}
      disabled={props.disabled ?? context.index >= context.items.length - 1}
      className={cn("gdg-questionnaire-skip", className)}
      onClick={(event) => {
        props.onClick?.(event);
        if (!event.defaultPrevented) context.setIndex(context.index + 1);
      }}
    >
      {children ?? "スキップ"}
    </Button>
  );
}

export function QuestionnaireSubmit({ className, children, ...props }: ButtonProps) {
  return (
    <Button {...props} type="submit" className={cn("gdg-questionnaire-submit", className)}>
      {children ?? "送信"}
    </Button>
  );
}

export { Questionnaire as QuestionnaireNew };
