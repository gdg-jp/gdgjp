import * as AnimatedIcons from "lucide-animated";
import {
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
import type { IconName } from "./IconName";

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

export type IconsHandle = {
  startAnimation: () => void;
  stopAnimation: () => void;
};

type AnimatedIconProps = HTMLAttributes<HTMLDivElement> & {
  size?: number;
  animateOnHover?: boolean;
};

type AnimatedIconComponent = ForwardRefExoticComponent<
  AnimatedIconProps & RefAttributes<IconsHandle>
>;

type AnimatedIconExportName = Extract<IconName, `${string}Icon`>;

export type IconsProps = Omit<HTMLAttributes<HTMLDivElement>, "children"> & {
  /** Lucide icon name, with or without the `Icon` suffix (for example, `Heart`). */
  name: IconName;
  size?: number;
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

function resolveIcon(name: IconName) {
  const exportName = (name.endsWith("Icon") ? name : `${name}Icon`) as AnimatedIconExportName;
  const Icon = AnimatedIcons[exportName];
  if (!Icon) {
    throw new Error(
      `[gdg-ui] Unknown icon "${name}". Use a name exported by lucide-animated, such as "Heart".`,
    );
  }
  return Icon as AnimatedIconComponent;
}

export const Icons = forwardRef<IconsHandle, IconsProps>(function Icons(
  {
    name,
    size = 24,
    animateOnHover = true,
    className,
    role,
    "aria-label": ariaLabel,
    "aria-labelledby": ariaLabelledBy,
    onMouseEnter,
    onMouseLeave,
    ...props
  },
  ref,
) {
  const Icon = resolveIcon(name);
  const prefersReducedMotion = usePrefersReducedMotion();
  const iconRef = useRef<IconsHandle>(null);
  const shouldAnimateOnHover = animateOnHover && !prefersReducedMotion;

  useImperativeHandle(
    ref,
    () => ({
      startAnimation: () => iconRef.current?.startAnimation(),
      stopAnimation: () => iconRef.current?.stopAnimation(),
    }),
    [],
  );
  useEffect(() => {
    if (!shouldAnimateOnHover) iconRef.current?.stopAnimation();
  }, [shouldAnimateOnHover]);

  return (
    <Icon
      {...props}
      ref={iconRef}
      aria-label={ariaLabel}
      aria-labelledby={ariaLabelledBy}
      role={role ?? (ariaLabel || ariaLabelledBy ? "img" : undefined)}
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
