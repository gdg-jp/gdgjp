import { ScrollArea as RScrollArea } from "radix-ui";
import type { ComponentProps } from "react";
import { cn } from "../../utils";

export function ScrollArea({
  className,
  children,
  ...props
}: ComponentProps<typeof RScrollArea.Root>) {
  return (
    <RScrollArea.Root {...props} className={cn("gdg-scroll-area", className)}>
      <ScrollAreaViewport>{children}</ScrollAreaViewport>
      <ScrollAreaScrollbar orientation="vertical" />
      <ScrollAreaScrollbar orientation="horizontal" />
      <ScrollAreaCorner />
    </RScrollArea.Root>
  );
}

export function ScrollAreaScrollbar({
  className,
  ...props
}: ComponentProps<typeof RScrollArea.Scrollbar>) {
  return (
    <RScrollArea.Scrollbar {...props} className={cn("gdg-scroll-area-scrollbar", className)}>
      <ScrollAreaThumb />
    </RScrollArea.Scrollbar>
  );
}

export function ScrollAreaViewport({
  className,
  ...props
}: ComponentProps<typeof RScrollArea.Viewport>) {
  return <RScrollArea.Viewport {...props} className={cn("gdg-scroll-area-viewport", className)} />;
}

export function ScrollAreaThumb({ className, ...props }: ComponentProps<typeof RScrollArea.Thumb>) {
  return <RScrollArea.Thumb {...props} className={cn("gdg-scroll-area-thumb", className)} />;
}

export function ScrollAreaCorner({
  className,
  ...props
}: ComponentProps<typeof RScrollArea.Corner>) {
  return <RScrollArea.Corner {...props} className={cn("gdg-scroll-area-corner", className)} />;
}
