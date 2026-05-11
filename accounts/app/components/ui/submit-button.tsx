import type { VariantProps } from "class-variance-authority";
import type * as React from "react";

import { Button, type buttonVariants } from "~/components/ui/button";
import { Spinner, type spinnerVariants } from "~/components/ui/spinner";

type ButtonSize = NonNullable<VariantProps<typeof buttonVariants>["size"]>;
type SpinnerSize = NonNullable<VariantProps<typeof spinnerVariants>["size"]>;

const spinnerSizeForButton: Record<ButtonSize, SpinnerSize> = {
  default: "md",
  xs: "xs",
  sm: "sm",
  lg: "md",
  icon: "md",
  "icon-xs": "xs",
  "icon-sm": "sm",
  "icon-lg": "md",
};

type SubmitButtonProps = React.ComponentProps<typeof Button> & {
  pending?: boolean;
  pendingLabel?: string;
};

function SubmitButton({
  pending = false,
  pendingLabel,
  disabled,
  size,
  type,
  children,
  ...props
}: SubmitButtonProps) {
  const resolvedSize: ButtonSize = size ?? "default";
  const isIcon = resolvedSize.startsWith("icon");

  return (
    <Button
      type={type ?? "submit"}
      size={size}
      disabled={disabled || pending}
      aria-busy={pending || undefined}
      data-pending={pending || undefined}
      {...props}
    >
      {pending ? (
        <>
          <Spinner size={spinnerSizeForButton[resolvedSize]} label={pendingLabel} />
          {isIcon ? <span className="sr-only">{children}</span> : children}
        </>
      ) : (
        children
      )}
    </Button>
  );
}

export { SubmitButton };
