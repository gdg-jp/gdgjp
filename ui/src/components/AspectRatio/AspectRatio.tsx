import { AspectRatio as RAspectRatio } from "radix-ui";
import type { ComponentProps } from "react";
import { cn } from "../../utils";

export function AspectRatio({
  ratio = 16 / 9,
  className,
  ...props
}: ComponentProps<typeof RAspectRatio.Root>) {
  return (
    <RAspectRatio.Root {...props} ratio={ratio} className={cn("gdg-aspect-ratio", className)} />
  );
}
