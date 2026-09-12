import { Check, ChevronDown } from "lucide-react";
import { Select as RSelect } from "radix-ui";
import {
  type ComponentProps,
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
} from "react";
import { useExitPresence, useMotionRef } from "../../hooks";
import { cn } from "../../utils";
import { FieldContext, useField } from "../FormField/field-context";

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
      <span className="gdg-menu-item-label">
        <RSelect.ItemText>{children}</RSelect.ItemText>
      </span>
      <span className="gdg-menu-item-indicator" aria-hidden="true">
        <RSelect.ItemIndicator>
          <Check size={16} />
        </RSelect.ItemIndicator>
      </span>
    </RSelect.Item>
  );
}

export const SelectGroup = RSelect.Group;
export const SelectLabel = RSelect.Label;
