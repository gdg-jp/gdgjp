import { Check, ChevronDown, Minus } from "lucide-react";
import { Checkbox as RC, RadioGroup as RR, Switch as RS, Select as RSelect } from "radix-ui";
import {
  type ComponentProps,
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useId,
  useRef,
  useState,
} from "react";
import { useExitPresence, useMotionRef } from "./motion";
import { cn } from "./utils";
const FieldContext = createContext<{
  id: string;
  description?: string;
  invalid?: boolean;
  required?: boolean;
  disabled?: boolean;
} | null>(null);
function useField(props: {
  id?: string;
  "aria-describedby"?: string;
  "aria-invalid"?: ComponentProps<"input">["aria-invalid"];
  disabled?: boolean;
  required?: boolean;
}) {
  const field = useContext(FieldContext);
  return {
    id: props.id ?? field?.id,
    "aria-describedby":
      [field?.description, props["aria-describedby"]].filter(Boolean).join(" ") || undefined,
    "aria-invalid": props["aria-invalid"] ?? field?.invalid,
    disabled: props.disabled ?? field?.disabled,
    required: props.required ?? field?.required,
  };
}
export function FormField({
  id: suppliedId,
  label,
  description,
  error,
  required,
  disabled,
  children,
  className,
}: {
  id?: string;
  label: ReactNode;
  description?: ReactNode;
  error?: ReactNode;
  required?: boolean;
  disabled?: boolean;
  children: ReactNode;
  className?: string;
}) {
  const generatedId = useId();
  const id = suppliedId ?? generatedId;
  return (
    <FieldContext.Provider
      value={{
        id,
        description:
          [description && `${id}-help`, error && `${id}-error`].filter(Boolean).join(" ") ||
          undefined,
        invalid: !!error,
        required,
        disabled,
      }}
    >
      <div className={cn("gdg-field", className)}>
        <label id={`${id}-label`} htmlFor={id}>
          {label}
          {required && <span aria-hidden="true"> *</span>}
        </label>
        {children}
        {description && (
          <p id={`${id}-help`} className="gdg-field-help">
            {description}
          </p>
        )}
        {error && (
          <p id={`${id}-error`} className="gdg-field-error">
            {error}
          </p>
        )}
      </div>
    </FieldContext.Provider>
  );
}
export function Input({ className, ...props }: ComponentProps<"input">) {
  const field = useField(props);
  return <input {...props} {...field} className={cn("gdg-input", className)} />;
}
export function Textarea({ className, ...props }: ComponentProps<"textarea">) {
  const field = useField(props);
  return <textarea {...props} {...field} className={cn("gdg-input", "gdg-textarea", className)} />;
}
export function Checkbox({ className, ...props }: ComponentProps<typeof RC.Root>) {
  const field = useField(props);
  return (
    <RC.Root {...props} {...field} className={cn("gdg-checkbox", className)}>
      <RC.Indicator>
        <Check size={14} className="gdg-check-mark" />
        <Minus size={14} className="gdg-check-mixed" />
      </RC.Indicator>
    </RC.Root>
  );
}
export function Switch({ className, ...props }: ComponentProps<typeof RS.Root>) {
  const field = useField(props);
  return (
    <RS.Root {...props} {...field} className={cn("gdg-switch", className)}>
      <RS.Thumb className="gdg-switch-thumb" />
    </RS.Root>
  );
}
export function RadioGroup({ className, ...props }: ComponentProps<typeof RR.Root>) {
  const field = useField(props);
  const context = useContext(FieldContext);
  return (
    <RR.Root
      aria-labelledby={context ? `${context.id}-label` : undefined}
      {...props}
      {...field}
      className={cn("gdg-stack", className)}
    />
  );
}
export function RadioGroupItem({ className, ...props }: ComponentProps<typeof RR.Item>) {
  return (
    <RR.Item {...props} className={cn("gdg-radio", className)}>
      <RR.Indicator className="gdg-radio-indicator" />
    </RR.Item>
  );
}
const SelectMotionContext = createContext<{
  open: boolean;
  contentRef: { current: HTMLDivElement | null };
} | null>(null);
export function Select({
  open: controlledOpen,
  defaultOpen = false,
  onOpenChange,
  ...props
}: ComponentProps<typeof RSelect.Root>) {
  const [internalOpen, setInternalOpen] = useState(defaultOpen);
  const open = controlledOpen ?? internalOpen;
  const contentRef = useRef<HTMLDivElement | null>(null);
  const present = useExitPresence(open, contentRef);
  const field = useContext(FieldContext);
  return (
    <SelectMotionContext.Provider value={{ open, contentRef }}>
      <RSelect.Root
        {...props}
        required={props.required ?? field?.required}
        disabled={props.disabled ?? field?.disabled}
        open={present}
        onOpenChange={(next) => {
          if (controlledOpen === undefined) setInternalOpen(next);
          onOpenChange?.(next);
        }}
      />
    </SelectMotionContext.Provider>
  );
}
export const SelectValue = RSelect.Value;
export function SelectTrigger({
  children,
  className,
  ...props
}: ComponentProps<typeof RSelect.Trigger>) {
  const field = useField(props);
  const motion = useContext(SelectMotionContext);
  return (
    <RSelect.Trigger
      {...props}
      {...field}
      aria-expanded={motion?.open}
      className={cn("gdg-input", "gdg-select-trigger", className)}
    >
      {children}
      <RSelect.Icon>
        <ChevronDown size={16} />
      </RSelect.Icon>
    </RSelect.Trigger>
  );
}
export function SelectContent({
  ref,
  children,
  className,
  ...props
}: ComponentProps<typeof RSelect.Content>) {
  const motion = useContext(SelectMotionContext);
  const motionRef = useMotionRef(ref);
  const contentRef = motion?.contentRef;
  const setRef = useCallback(
    (node: HTMLDivElement | null) => {
      if (contentRef) contentRef.current = node;
      return motionRef(node);
    },
    [contentRef, motionRef],
  );
  return (
    <RSelect.Portal>
      <RSelect.Content
        ref={setRef}
        position="popper"
        sideOffset={4}
        {...props}
        data-state={motion?.open ? "open" : "closed"}
        inert={motion ? !motion.open : undefined}
        className={cn("gdg-popup", "gdg-select-content", className)}
      >
        <RSelect.ScrollUpButton>↑</RSelect.ScrollUpButton>
        <RSelect.Viewport>{children}</RSelect.Viewport>
        <RSelect.ScrollDownButton>↓</RSelect.ScrollDownButton>
      </RSelect.Content>
    </RSelect.Portal>
  );
}
export function SelectItem({ children, className, ...props }: ComponentProps<typeof RSelect.Item>) {
  return (
    <RSelect.Item {...props} className={cn("gdg-menu-item", className)}>
      <RSelect.ItemText>{children}</RSelect.ItemText>
      <RSelect.ItemIndicator>
        <Check size={16} />
      </RSelect.ItemIndicator>
    </RSelect.Item>
  );
}
export const SelectGroup = RSelect.Group;
export const SelectLabel = RSelect.Label;
