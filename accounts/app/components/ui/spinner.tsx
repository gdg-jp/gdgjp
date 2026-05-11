import { type VariantProps, cva } from "class-variance-authority";
import { Loader2 } from "lucide-react";
import type * as React from "react";

import { cn } from "~/lib/utils";

const spinnerVariants = cva("animate-spin shrink-0", {
  variants: {
    size: {
      xs: "size-3",
      sm: "size-3.5",
      md: "size-4",
      lg: "size-5",
    },
  },
  defaultVariants: {
    size: "md",
  },
});

type SpinnerProps = React.ComponentProps<"output"> &
  VariantProps<typeof spinnerVariants> & {
    label?: string;
  };

function Spinner({ className, size, label, ...props }: SpinnerProps) {
  return (
    <output aria-live="polite" data-slot="spinner" className="inline-flex items-center" {...props}>
      <Loader2 aria-hidden className={cn(spinnerVariants({ size }), className)} />
      {label ? <span className="sr-only">{label}</span> : null}
    </output>
  );
}

export { Spinner, spinnerVariants };
