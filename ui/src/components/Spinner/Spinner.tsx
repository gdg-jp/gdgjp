import { LoaderCircle } from "lucide-react";
import type { ComponentProps } from "react";
import { cn } from "../../utils";

export function Spinner({
  label = "読み込み中",
  className,
  ...props
}: ComponentProps<"output"> & { label?: string }) {
  return (
    <output {...props} className={cn("gdg-inline", className)}>
      <LoaderCircle className="gdg-spinner" aria-hidden="true" />
      <span className="gdg-sr-only">{label}</span>
    </output>
  );
}
