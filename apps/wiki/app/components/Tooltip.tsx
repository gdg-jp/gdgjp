import { TooltipContent, Tooltip as TooltipPrimitive, TooltipTrigger } from "@gdgjp/design-system";

/**
 * Wraps children with a tooltip label.
 * Disabled controls need a non-disabled trigger wrapper because native disabled
 * buttons cannot receive tooltip events. Interaction remains owned by the
 * shared Radix tooltip primitive.
 */
export default function Tooltip({
  label,
  disabled = false,
  children,
}: {
  label: string;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  if (!disabled) return <>{children}</>;

  return (
    <TooltipPrimitive>
      <TooltipTrigger asChild>
        <span className="inline-flex">{children}</span>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </TooltipPrimitive>
  );
}
