import { DropdownMenu as RM } from "radix-ui";
import type { ComponentProps } from "react";
import { useMotionRef } from "../../hooks";
import { cn } from "../../utils";

export const DropdownMenu = RM.Root;
export const DropdownMenuTrigger = RM.Trigger;

export function DropdownMenuContent({
  ref,
  className,
  ...props
}: ComponentProps<typeof RM.Content>) {
  const motionRef = useMotionRef(ref);
  return (
    <RM.Portal>
      <RM.Content
        ref={motionRef}
        sideOffset={4}
        {...props}
        className={cn("gdg-popup", "gdg-menu", className)}
      />
    </RM.Portal>
  );
}

export function DropdownMenuItem({ className, ...props }: ComponentProps<typeof RM.Item>) {
  return <RM.Item {...props} className={cn("gdg-menu-item", className)} />;
}

export const DropdownMenuGroup = RM.Group;
export const DropdownMenuLabel = RM.Label;

export function DropdownMenuSeparator(props: ComponentProps<typeof RM.Separator>) {
  return <RM.Separator {...props} className={cn("gdg-separator", props.className)} />;
}
