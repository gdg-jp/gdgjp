import { Slot } from "radix-ui";
import type { ComponentProps } from "react";
import { cn } from "../../utils";

export function Link({
  className,
  asChild,
  ...props
}: ComponentProps<"a"> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : "a";
  return <Comp {...props} className={cn("gdg-link", className)} />;
}
