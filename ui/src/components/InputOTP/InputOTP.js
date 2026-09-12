import { Minus } from "lucide-react";
import { createContext, useContext, useRef, useState } from "react";
import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { cn } from "../../utils";
const InputOTPContext = createContext(null);
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
}) {
  const [internalValue, setInternalValue] = useState(defaultValue);
  const [focused, setFocused] = useState(false);
  const inputRef = useRef(null);
  const currentValue = value ?? internalValue;
  const focus = () => inputRef.current?.focus();
  return _jsx(InputOTPContext.Provider, {
    value: { value: currentValue, maxLength, focused, focus },
    children: _jsxs("div", {
      className: cn("gdg-input-otp", containerClassName),
      children: [
        children,
        _jsx("input", {
          ...props,
          ref: inputRef,
          value: currentValue,
          maxLength: maxLength,
          pattern: pattern,
          inputMode: inputMode,
          "aria-label": props["aria-label"] ?? "認証コード",
          className: cn("gdg-input-otp-input", className),
          onFocus: (event) => {
            setFocused(true);
            props.onFocus?.(event);
          },
          onBlur: (event) => {
            setFocused(false);
            props.onBlur?.(event);
          },
          onChange: (event) => {
            const next = event.target.value.slice(0, maxLength);
            if (value === undefined) setInternalValue(next);
            onChange?.(next);
          },
        }),
      ],
    }),
  });
}
export function InputOTPGroup({ className, ...props }) {
  return _jsx("div", { ...props, className: cn("gdg-input-otp-group", className) });
}
export function InputOTPSlot({ index, className, ...props }) {
  const context = useInputOTPContext();
  const character = context.value[index] ?? "";
  return _jsx("span", {
    ...props,
    "data-active": context.focused && context.value.length === index,
    className: cn("gdg-input-otp-slot", className),
    onClick: context.focus,
    children:
      character ||
      (context.focused && context.value.length === index
        ? _jsx("span", { className: "gdg-input-otp-caret", "aria-hidden": "true" })
        : null),
  });
}
export function InputOTPSeparator({ className, ...props }) {
  return _jsx("span", {
    ...props,
    "aria-hidden": "true",
    className: cn("gdg-input-otp-separator", className),
    children: _jsx(Minus, { size: 14 }),
  });
}
