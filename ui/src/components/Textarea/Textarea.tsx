import type { ComponentProps } from "react";
import { cn } from "../../utils";
import { useField } from "../FormField/field-context";

export function Textarea({ className, ...props }: ComponentProps<"textarea">) {
  const field = useField(props);
  return <textarea {...props} {...field} className={cn("gdg-input", "gdg-textarea", className)} />;
}
