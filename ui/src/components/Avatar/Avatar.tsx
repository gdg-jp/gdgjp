import { Avatar as RAvatar } from "radix-ui";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "../../utils";

export function Avatar({
  src,
  alt,
  fallback,
  className,
  ...props
}: ComponentProps<typeof RAvatar.Root> & { src?: string; alt: string; fallback: ReactNode }) {
  return (
    <RAvatar.Root {...props} className={cn("gdg-avatar", className)}>
      <RAvatar.Image src={src} alt={alt} />
      <RAvatar.Fallback role="img" aria-label={alt}>
        {fallback}
      </RAvatar.Fallback>
    </RAvatar.Root>
  );
}
