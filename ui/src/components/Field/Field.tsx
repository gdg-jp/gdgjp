import type { ComponentProps, ReactNode } from "react";
import { cn } from "../../utils";

export function FieldSet({ className, ...props }: ComponentProps<"fieldset">) {
  return <fieldset {...props} className={cn("gdg-field-set", className)} />;
}

export function FieldLegend({
  variant = "legend",
  className,
  ...props
}: ComponentProps<"legend"> & { variant?: "legend" | "label" }) {
  return <legend {...props} data-variant={variant} className={cn("gdg-field-legend", className)} />;
}

export function FieldGroup({ className, ...props }: ComponentProps<"div">) {
  return <div {...props} className={cn("gdg-field-group", className)} />;
}

export function Field({ className, ...props }: ComponentProps<"div">) {
  return (
    <div {...props} role={props.role ?? "group"} className={cn("gdg-field-primitive", className)} />
  );
}

export function FieldContent({ className, ...props }: ComponentProps<"div">) {
  return <div {...props} className={cn("gdg-field-content", className)} />;
}

export function FieldLabel({ className, ...props }: ComponentProps<"label">) {
  // biome-ignore lint/a11y/noLabelWithoutControl: this primitive delegates the input association to htmlFor.
  return <label {...props} htmlFor={props.htmlFor} className={cn("gdg-field-label", className)} />;
}

export function FieldTitle({ className, ...props }: ComponentProps<"div">) {
  return <div {...props} className={cn("gdg-field-title", className)} />;
}

export function FieldDescription({ className, ...props }: ComponentProps<"p">) {
  return <p {...props} className={cn("gdg-field-description", className)} />;
}

export function FieldSeparator({ className, children, ...props }: ComponentProps<"div">) {
  return (
    <div {...props} className={cn("gdg-field-separator", className)}>
      {children && <span>{children}</span>}
    </div>
  );
}

export function FieldError({
  errors,
  issues,
  children,
  className,
  ...props
}: ComponentProps<"p"> & {
  errors?: Array<{ message?: ReactNode } | undefined>;
  issues?: Array<{ message?: ReactNode } | undefined>;
}) {
  const messages = [...(errors ?? []), ...(issues ?? [])]
    .map((error) => error?.message)
    .filter(Boolean);
  return (
    <p {...props} role="alert" className={cn("gdg-field-error", className)}>
      {messages.length > 1 ? (
        <ul>
          {messages.map((message) => (
            <li key={String(message)}>{message}</li>
          ))}
        </ul>
      ) : (
        (messages[0] ?? children)
      )}
    </p>
  );
}
