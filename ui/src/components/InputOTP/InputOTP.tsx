import { Minus } from "lucide-react";
import { type ComponentProps, createContext, useContext, useRef, useState } from "react";
import { cn } from "../../utils";

type InputOTPContextValue = {
  value: string;
  maxLength: number;
  focused: boolean;
  focus: () => void;
};

const InputOTPContext = createContext<InputOTPContextValue | null>(null);

function useInputOTPContext() {
  const context = useContext(InputOTPContext);
  if (!context) throw new Error("InputOTP parts must be used inside InputOTP");
  return context;
}

export function InputOTP({
  maxLength = 6,
  value,
  defaultValue = "",
  onChange,
  pattern,
  inputMode = "numeric",
  className,
  containerClassName,
  children,
  ...props
}: Omit<ComponentProps<"input">, "value" | "defaultValue" | "onChange" | "size" | "className"> & {
  maxLength?: number;
  value?: string;
  defaultValue?: string;
  onChange?: (value: string) => void;
  containerClassName?: string;
  className?: string;
}) {
  const [internalValue, setInternalValue] = useState(defaultValue);
  const [focused, setFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const currentValue = value ?? internalValue;
  const focus = () => inputRef.current?.focus();
  return (
    <InputOTPContext.Provider value={{ value: currentValue, maxLength, focused, focus }}>
      <div className={cn("gdg-input-otp", containerClassName)}>
        {children}
        <input
          {...props}
          ref={inputRef}
          value={currentValue}
          maxLength={maxLength}
          pattern={pattern}
          inputMode={inputMode}
          aria-label={props["aria-label"] ?? "認証コード"}
          className={cn("gdg-input-otp-input", className)}
          onFocus={(event) => {
            setFocused(true);
            props.onFocus?.(event);
          }}
          onBlur={(event) => {
            setFocused(false);
            props.onBlur?.(event);
          }}
          onChange={(event) => {
            const next = event.target.value.slice(0, maxLength);
            if (value === undefined) setInternalValue(next);
            onChange?.(next);
          }}
        />
      </div>
    </InputOTPContext.Provider>
  );
}

export function InputOTPGroup({ className, ...props }: ComponentProps<"div">) {
  return <div {...props} className={cn("gdg-input-otp-group", className)} />;
}

export function InputOTPSlot({
  index,
  className,
  ...props
}: ComponentProps<"span"> & { index: number }) {
  const context = useInputOTPContext();
  const character = context.value[index] ?? "";
  return (
    <span
      {...props}
      data-active={context.focused && context.value.length === index}
      className={cn("gdg-input-otp-slot", className)}
      onClick={context.focus}
    >
      {character ||
        (context.focused && context.value.length === index ? (
          <span className="gdg-input-otp-caret" aria-hidden="true" />
        ) : null)}
    </span>
  );
}

export function InputOTPSeparator({ className, ...props }: ComponentProps<"span">) {
  return (
    <span {...props} aria-hidden="true" className={cn("gdg-input-otp-separator", className)}>
      <Minus size={14} />
    </span>
  );
}
