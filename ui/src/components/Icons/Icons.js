import * as AnimatedIcons from "lucide-animated";
import { forwardRef, useEffect, useImperativeHandle, useRef, useSyncExternalStore } from "react";
import { jsx as _jsx } from "react/jsx-runtime";
import { cn } from "../../utils";
const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";
function subscribeToReducedMotion(onStoreChange) {
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
function resolveIcon(name) {
  const exportName = name.endsWith("Icon") ? name : `${name}Icon`;
  const Icon = AnimatedIcons[exportName];
  if (!Icon) {
    throw new Error(
      `[gdg-ui] Unknown icon "${name}". Use a name exported by lucide-animated, such as "Heart".`,
    );
  }
  return Icon;
}
export const Icons = forwardRef(function Icons(
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
  const iconRef = useRef(null);
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
  return _jsx(Icon, {
    ...props,
    ref: iconRef,
    "aria-label": ariaLabel,
    "aria-labelledby": ariaLabelledBy,
    role: role ?? (ariaLabel || ariaLabelledBy ? "img" : undefined),
    size,
    animateOnHover: false,
    className: cn("gdg-icons", className),
    onMouseEnter: (event) => {
      onMouseEnter?.(event);
      if (shouldAnimateOnHover) iconRef.current?.startAnimation();
    },
    onMouseLeave: (event) => {
      iconRef.current?.stopAnimation();
      onMouseLeave?.(event);
    },
  });
});
Icons.displayName = "Icons";
