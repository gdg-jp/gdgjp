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
      src="/gdg_logo.png"
      alt="GDG"
      width={512}
      height={512}
      className={cn(SIZE_MAP[size], "select-none object-contain", className)}
      draggable={false}
    />
  );
}
