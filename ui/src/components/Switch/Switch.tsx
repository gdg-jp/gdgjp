import { Switch as RS } from "radix-ui";
import type { ComponentProps } from "react";
import { cn } from "../../utils";
import { useField } from "../FormField/field-context";

export function Switch({ className, ...props }: ComponentProps<typeof RS.Root>) {
  const field = useField(props);
  return (
    <RS.Root {...props} {...field} className={cn("gdg-switch", className)}>
      <RS.Thumb className="gdg-switch-thumb" />
    </RS.Root>
  );
}
