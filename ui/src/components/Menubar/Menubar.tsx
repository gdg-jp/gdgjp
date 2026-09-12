import { Check } from "lucide-react";
import { Menubar as RM } from "radix-ui";
import type { ComponentProps } from "react";
import { useMotionRef } from "../../hooks";
import { cn } from "../../utils";

export function Menubar({ className, ...props }: ComponentProps<typeof RM.Root>) {
  return <RM.Root {...props} className={cn("gdg-menubar", className)} />;
}

export function MenubarMenu({ children, ...props }: ComponentProps<typeof RM.Menu>) {
  return <RM.Menu {...props}>{children}</RM.Menu>;
}

export function MenubarTrigger({ className, ...props }: ComponentProps<typeof RM.Trigger>) {
  return <RM.Trigger {...props} className={cn("gdg-menubar-trigger", className)} />;
}

export function MenubarContent({ ref, className, ...props }: ComponentProps<typeof RM.Content>) {
  const motionRef = useMotionRef(ref);
  return (
    <RM.Portal>
      <RM.Content
        ref={motionRef}
        sideOffset={4}
        {...props}
        className={cn("gdg-popup", "gdg-menubar-content", className)}
      />
    </RM.Portal>
  );
}

export function MenubarItem({ className, ...props }: ComponentProps<typeof RM.Item>) {
  return <RM.Item {...props} className={cn("gdg-menu-item", className)} />;
}

export function MenubarCheckboxItem({
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

export function MenubarRadioGroup({ ...props }: ComponentProps<typeof RM.RadioGroup>) {
  return <RM.RadioGroup {...props} />;
}

export function MenubarRadioItem({
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

export function MenubarLabel({ className, ...props }: ComponentProps<typeof RM.Label>) {
  return <RM.Label {...props} className={cn("gdg-menu-label", className)} />;
}

export function MenubarSeparator({ className, ...props }: ComponentProps<typeof RM.Separator>) {
  return <RM.Separator {...props} className={cn("gdg-separator", className)} />;
}

export const MenubarGroup = RM.Group;
export const MenubarSub = RM.Sub;
export const MenubarSubTrigger = RM.SubTrigger;

export function MenubarSubContent({
  ref,
  className,
  ...props
}: ComponentProps<typeof RM.SubContent>) {
  const motionRef = useMotionRef(ref);
  return (
    <RM.SubContent
      ref={motionRef}
      {...props}
      className={cn("gdg-popup", "gdg-menubar-content", className)}
    />
  );
}

export const MenubarPortal = RM.Portal;
export const MenubarArrow = RM.Arrow;
