import type { ComponentProps } from "react";
import { cn } from "../../utils";

export function ButtonGroup({
  orientation = "horizontal",
  className,
  ...props
}: ComponentProps<"div"> & { orientation?: "horizontal" | "vertical" }) {
  return (
    <div
      {...props}
      role={props.role ?? "group"}
      data-orientation={orientation}
      className={cn("gdg-button-group", className)}
    />
  );
}

export function ButtonGroupSeparator({
  orientation = "vertical",
  className,
  ...props
}: ComponentProps<"hr"> & { orientation?: "horizontal" | "vertical" }) {
  return (
    <hr
      {...props}
      aria-orientation={orientation}
      data-orientation={orientation}
      className={cn("gdg-button-group-separator", className)}
    />
  );
}

export function ButtonGroupText({ className, ...props }: ComponentProps<"span">) {
  return <span {...props} className={cn("gdg-button-group-text", className)} />;
}
