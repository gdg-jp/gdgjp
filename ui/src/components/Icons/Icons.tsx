import * as AnimatedIcons from "lucide-animated";
import type { LucideIcon } from "lucide-react";
import {
  type CSSProperties,
  type ForwardRefExoticComponent,
  type HTMLAttributes,
  type MouseEvent,
  type RefAttributes,
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useSyncExternalStore,
} from "react";
import { cn } from "../../utils";
import type { IconBaseName, IconName } from "./IconName";
import { type StaticIconName, staticIcons } from "./StaticIcons";

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

export type IconsHandle = {
  startAnimation: () => void;
  stopAnimation: () => void;
};

type AnimatedIconProps = HTMLAttributes<HTMLDivElement> & {
  size?: number;
  strokeWidth?: number | string;
  animateOnHover?: boolean;
};

type AnimatedIconComponent = ForwardRefExoticComponent<
  AnimatedIconProps & RefAttributes<IconsHandle>
>;

type ResolvedIcon =
  | { kind: "animated"; component: AnimatedIconComponent }
  | { kind: "static"; component: LucideIcon };

export type IconsProps = Omit<HTMLAttributes<HTMLDivElement>, "children"> & {
  /** Lucide icon name, with or without the `Icon` suffix (for example, `Heart`). */
  name: IconName;
  size?: number;
  strokeWidth?: number | string;
  animateOnHover?: boolean;
};

function subscribeToReducedMotion(onStoreChange: () => void) {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return () => {};

  const mediaQuery = window.matchMedia(REDUCED_MOTION_QUERY);
  const listener = () => onStoreChange();
  if (typeof mediaQuery.addEventListener === "function") {
    mediaQuery.addEventListener("change", listener);
    return () => mediaQuery.removeEventListener("change", listener);
  }
  mediaQuery.addListener(listener);
  return () => mediaQuery.removeListener(listener);
}

function getReducedMotionSnapshot() {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia(REDUCED_MOTION_QUERY).matches
  );
}

function usePrefersReducedMotion() {
  return useSyncExternalStore(subscribeToReducedMotion, getReducedMotionSnapshot, () => false);
}

function resolveIcon(name: IconName): ResolvedIcon {
  const baseName = (name.endsWith("Icon") ? name.slice(0, -4) : name) as IconBaseName;
  const exportName = `${baseName}Icon` as Extract<IconName, `${string}Icon`>;
  const animatedIcons = AnimatedIcons as Record<string, unknown>;
  const AnimatedIcon = animatedIcons[exportName] as AnimatedIconComponent | undefined;
  if (AnimatedIcon) return { kind: "animated", component: AnimatedIcon };

  const StaticIcon = staticIcons[baseName as StaticIconName];
  if (StaticIcon) return { kind: "static", component: StaticIcon };

  throw new Error(
    `[gdg-ui] Unknown icon "${name}". Use a name exported by the shared icon catalog, such as "Heart".`,
  );
}

function withStrokeWidth(
  style: CSSProperties | undefined,
  strokeWidth: number | string | undefined,
) {
  if (strokeWidth === undefined) return style;
  return { ...style, strokeWidth };
}

export const Icons = forwardRef<IconsHandle, IconsProps>(function Icons(
  {
    name,
    size = 24,
    strokeWidth,
    animateOnHover = true,
    className,
    role,
    style,
    "aria-label": ariaLabel,
    "aria-labelledby": ariaLabelledBy,
    onMouseEnter,
    onMouseLeave,
    ...props
  },
  ref,
) {
  const resolved = resolveIcon(name);
  const prefersReducedMotion = usePrefersReducedMotion();
  const iconRef = useRef<IconsHandle>(null);
  const shouldAnimateOnHover =
    resolved.kind === "animated" && animateOnHover && !prefersReducedMotion;
  const outerStyle = withStrokeWidth(style, strokeWidth);
  const labelledRole = role ?? (ariaLabel || ariaLabelledBy ? "img" : undefined);

  useImperativeHandle(
    ref,
    () => ({
      startAnimation: () => {
        if (resolved.kind === "animated") iconRef.current?.startAnimation();
      },
      stopAnimation: () => {
        if (resolved.kind === "animated") iconRef.current?.stopAnimation();
      },
    }),
    [resolved.kind],
  );

  useEffect(() => {
    if (resolved.kind === "animated" && !shouldAnimateOnHover) iconRef.current?.stopAnimation();
  }, [resolved.kind, shouldAnimateOnHover]);

  if (resolved.kind === "static") {
    const StaticIcon = resolved.component;
    const innerStrokeWidth = typeof strokeWidth === "string" ? Number(strokeWidth) : strokeWidth;
    return (
      <div
        {...props}
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledBy}
        role={labelledRole}
        style={outerStyle}
        data-gdg-stroke-width={strokeWidth === undefined ? undefined : "true"}
        className={cn("gdg-icons", className)}
        onMouseEnter={(event: MouseEvent<HTMLDivElement>) => onMouseEnter?.(event)}
        onMouseLeave={(event: MouseEvent<HTMLDivElement>) => onMouseLeave?.(event)}
      >
        <StaticIcon
          size={size}
          strokeWidth={innerStrokeWidth}
          focusable="false"
          aria-hidden="true"
        />
      </div>
    );
  }

  const AnimatedIcon = resolved.component;
  return (
    <AnimatedIcon
      {...props}
      ref={iconRef}
      aria-label={ariaLabel}
      aria-labelledby={ariaLabelledBy}
      role={labelledRole}
      style={outerStyle}
      data-gdg-stroke-width={strokeWidth === undefined ? undefined : "true"}
      strokeWidth={strokeWidth}
      size={size}
      animateOnHover={false}
      className={cn("gdg-icons", className)}
      onMouseEnter={(event: MouseEvent<HTMLDivElement>) => {
        onMouseEnter?.(event);
        if (shouldAnimateOnHover) iconRef.current?.startAnimation();
      }}
      onMouseLeave={(event: MouseEvent<HTMLDivElement>) => {
        iconRef.current?.stopAnimation();
        onMouseLeave?.(event);
      }}
    />
  );
});

Icons.displayName = "Icons";
