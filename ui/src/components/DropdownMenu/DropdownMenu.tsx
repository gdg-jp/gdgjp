import { Check } from "lucide-react";
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

export function DropdownMenuCheckboxItem({
  children,
  className,
  ...props
}: ComponentProps<typeof RM.CheckboxItem>) {
  return (
    <RM.CheckboxItem {...props} className={cn("gdg-menu-item", className)}>
      <span className="gdg-menu-item-label">{children}</span>
      <span className="gdg-menu-item-indicator" aria-hidden="true">
        <RM.ItemIndicator>
          <Check size={16} />
        </RM.ItemIndicator>
      </span>
    </RM.CheckboxItem>
  );
}

export const DropdownMenuGroup = RM.Group;
export const DropdownMenuRadioGroup = RM.RadioGroup;

export function DropdownMenuRadioItem({
  children,
  className,
  ...props
}: ComponentProps<typeof RM.RadioItem>) {
  return (
    <RM.RadioItem {...props} className={cn("gdg-menu-item", className)}>
      <span className="gdg-menu-item-label">{children}</span>
      <span className="gdg-menu-item-indicator" aria-hidden="true">
        <RM.ItemIndicator>
          <Check size={16} />
        </RM.ItemIndicator>
      </span>
    </RM.RadioItem>
  );
}

export function DropdownMenuLabel({ className, ...props }: ComponentProps<typeof RM.Label>) {
  return <RM.Label {...props} className={cn("gdg-menu-label", className)} />;
}

export function DropdownMenuSeparator(props: ComponentProps<typeof RM.Separator>) {
  return <RM.Separator {...props} className={cn("gdg-separator", props.className)} />;
}
