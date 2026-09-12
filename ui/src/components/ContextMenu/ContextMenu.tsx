import { ContextMenu as RM } from "radix-ui";
import type { ComponentProps } from "react";
import { useMotionRef } from "../../hooks";
import { cn } from "../../utils";

export const ContextMenu = RM.Root;
export const ContextMenuTrigger = RM.Trigger;
export const ContextMenuGroup = RM.Group;
export const ContextMenuRadioGroup = RM.RadioGroup;
export const ContextMenuSub = RM.Sub;

export function ContextMenuContent({
  ref,
  className,
  ...props
}: ComponentProps<typeof RM.Content>) {
  const motionRef = useMotionRef(ref);
  return (
    <RM.Portal>
      <RM.Content
        ref={motionRef}
        {...props}
        className={cn("gdg-popup", "gdg-context-menu", className)}
      />
    </RM.Portal>
  );
}

export function ContextMenuSubContent({
  ref,
  className,
  ...props
}: ComponentProps<typeof RM.SubContent>) {
  const motionRef = useMotionRef(ref);
  return (
    <RM.SubContent
      ref={motionRef}
      {...props}
      className={cn("gdg-popup", "gdg-context-menu", className)}
    />
  );
}

export const ContextMenuSubTrigger = RM.SubTrigger;

export function ContextMenuItem({ className, ...props }: ComponentProps<typeof RM.Item>) {
  return <RM.Item {...props} className={cn("gdg-menu-item", className)} />;
}

export function ContextMenuCheckboxItem({
  className,
  ...props
}: ComponentProps<typeof RM.CheckboxItem>) {
  return <RM.CheckboxItem {...props} className={cn("gdg-menu-item", className)} />;
}

export function ContextMenuRadioItem({ className, ...props }: ComponentProps<typeof RM.RadioItem>) {
  return <RM.RadioItem {...props} className={cn("gdg-menu-item", className)} />;
}

export function ContextMenuLabel({ className, ...props }: ComponentProps<typeof RM.Label>) {
  return <RM.Label {...props} className={cn("gdg-menu-label", className)} />;
}

export function ContextMenuSeparator({ className, ...props }: ComponentProps<typeof RM.Separator>) {
  return <RM.Separator {...props} className={cn("gdg-separator", className)} />;
}

export const ContextMenuPortal = RM.Portal;
export const ContextMenuArrow = RM.Arrow;
