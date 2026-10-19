import { Tooltip, TooltipContent, TooltipTrigger } from "@gdgjp/design-system";
import type { ComponentProps, ReactNode } from "react";

/**
 * Meet-style round icon button. `off` paints it red (mic muted, camera off);
 * `active` highlights it (sharing). The tooltip doubles as the accessible name.
 */
export function RoundToggle({
  label,
  off = false,
  active = false,
  danger = false,
  children,
  className,
  ...props
}: Omit<ComponentProps<"button">, "aria-label"> & {
  label: string;
  off?: boolean;
  active?: boolean;
  danger?: boolean;
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          aria-pressed={active || undefined}
          data-off={off || undefined}
          data-active={active || undefined}
          data-danger={danger || undefined}
          className={["sc-round", className].filter(Boolean).join(" ")}
          {...props}
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
