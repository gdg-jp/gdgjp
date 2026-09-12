import type { ComponentProps } from "react";
import { cn } from "../../utils";
import { useField } from "../FormField/field-context";

export function Input({ className, ...props }: ComponentProps<"input">) {
  const field = useField(props);
  return <input {...props} {...field} className={cn("gdg-input", className)} />;
}
