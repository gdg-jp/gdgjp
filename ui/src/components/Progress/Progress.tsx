import { Progress as RProgress } from "radix-ui";
import { type ComponentProps, createContext, useContext } from "react";
import { cn } from "../../utils";

const ProgressValueContext = createContext<number | null | undefined>(undefined);

export function Progress({ className, value, ...props }: ComponentProps<typeof RProgress.Root>) {
  return (
    <ProgressValueContext.Provider value={value}>
      <RProgress.Root
        {...props}
        value={value}
        aria-label={props["aria-label"] ?? "進捗"}
        className={cn("gdg-progress", className)}
      />
    </ProgressValueContext.Provider>
  );
}

export function ProgressIndicator({
  className,
  style,
  ...props
}: ComponentProps<typeof RProgress.Indicator>) {
  const value = useContext(ProgressValueContext);
  const transform =
    value == null ? undefined : `translateX(-${100 - Math.min(100, Math.max(0, value))}%)`;
  return (
    <RProgress.Indicator
      {...props}
      style={{ transform, ...style }}
      className={cn("gdg-progress-indicator", className)}
    />
  );
}
