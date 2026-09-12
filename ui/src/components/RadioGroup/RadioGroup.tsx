import { RadioGroup as RR } from "radix-ui";
import type { ComponentProps } from "react";
import { useContext } from "react";
import { cn } from "../../utils";
import { FieldContext, useField } from "../FormField/field-context";

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
