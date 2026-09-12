import type { ReactNode } from "react";
import { useId } from "react";
import { cn } from "../../utils";
import { FieldContext } from "./field-context";

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
