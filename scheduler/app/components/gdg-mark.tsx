import { cn } from "~/lib/utils";

type Size = "sm" | "md" | "lg";

const SIZE_MAP: Record<Size, string> = {
  sm: "h-7 w-7",
  md: "h-10 w-10",
  lg: "h-20 w-20",
};

export function GdgMark({
  size = "md",
  className,
}: {
  size?: Size;
  className?: string;
}) {
  return (
    <img
      src="/app-icon.png"
      alt="Scheduler"
      width={1254}
      height={1254}
      className={cn(SIZE_MAP[size], "select-none object-contain", className)}
      draggable={false}
    />
  );
}
