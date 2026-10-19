import { IconButton, Popover, PopoverContent, PopoverTrigger } from "@gdgjp/design-system";
import type { ReactNode } from "react";
import { CircleHelp } from "~/components/icons";

/** The (?) next to an area: a short explanation on demand, never inline. */
export function Help({ label = "ヘルプ", children }: { label?: string; children: ReactNode }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <IconButton aria-label={label} variant="ghost" size="sm" className="sc-help">
          <CircleHelp size={16} aria-hidden="true" />
        </IconButton>
      </PopoverTrigger>
      <PopoverContent className="sc-help-body" align="end">
        {children}
      </PopoverContent>
    </Popover>
  );
}
