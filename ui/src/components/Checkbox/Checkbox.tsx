import { Check, Minus } from "lucide-react";
import { Checkbox as RC } from "radix-ui";
import type { ComponentProps } from "react";
import { cn } from "../../utils";
import { useField } from "../FormField/field-context";

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
