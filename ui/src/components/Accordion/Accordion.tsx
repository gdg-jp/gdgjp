import { ChevronDown } from "lucide-react";
import { Accordion as RAccordion } from "radix-ui";
import type { ComponentProps } from "react";
import { useMotionRef } from "../../hooks";
import { cn } from "../../utils";

export const Accordion = RAccordion.Root;

export function AccordionItem({ className, ...props }: ComponentProps<typeof RAccordion.Item>) {
  return <RAccordion.Item {...props} className={cn("gdg-accordion-item", className)} />;
}

export function AccordionTrigger({
  className,
  children,
  ...props
}: ComponentProps<typeof RAccordion.Trigger>) {
  return (
    <RAccordion.Header className="gdg-accordion-heading">
      <RAccordion.Trigger {...props} className={cn("gdg-accordion-trigger", className)}>
        {children}
        <ChevronDown size={16} />
      </RAccordion.Trigger>
    </RAccordion.Header>
  );
}

export function AccordionContent({
  ref,
  className,
  children,
  ...props
}: ComponentProps<typeof RAccordion.Content>) {
  const motionRef = useMotionRef(ref);
  return (
    <RAccordion.Content
      ref={motionRef}
      {...props}
      className={cn("gdg-accordion-content", className)}
    >
      <div className="gdg-accordion-inner">{children}</div>
    </RAccordion.Content>
  );
}
