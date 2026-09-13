import * as AnimatedIcons from "lucide-animated";
import { forwardRef, useEffect, useImperativeHandle, useRef, useSyncExternalStore } from "react";
import { jsx } from "react/jsx-runtime";
import { cn } from "../../utils";
import { staticIcons } from "./StaticIcons";
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
  const baseName = name.endsWith("Icon") ? name.slice(0, -4) : name;
  const exportName = `${baseName}Icon`;
  const animatedIcons = AnimatedIcons;
  const AnimatedIcon = animatedIcons[exportName];
  if (AnimatedIcon) return { kind: "animated", component: AnimatedIcon };
  const StaticIcon = staticIcons[baseName];
  if (StaticIcon) return { kind: "static", component: StaticIcon };
  throw new Error(
    `[gdg-ui] Unknown icon "${name}". Use a name exported by the shared icon catalog, such as "Heart".`,
  );
}
function withStrokeWidth(style, strokeWidth) {
  if (strokeWidth === void 0) return style;
  return { ...style, strokeWidth };
}
const Icons = forwardRef(function Icons2(
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
  const iconRef = useRef(null);
  const shouldAnimateOnHover =
    resolved.kind === "animated" && animateOnHover && !prefersReducedMotion;
  const outerStyle = withStrokeWidth(style, strokeWidth);
  const labelledRole = role ?? (ariaLabel || ariaLabelledBy ? "img" : void 0);
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
    return /* @__PURE__ */ jsx("div", {
      ...props,
      "aria-label": ariaLabel,
      "aria-labelledby": ariaLabelledBy,
      role: labelledRole,
      style: outerStyle,
      "data-gdg-stroke-width": strokeWidth === void 0 ? void 0 : "true",
      className: cn("gdg-icons", className),
      onMouseEnter: (event) => onMouseEnter?.(event),
      onMouseLeave: (event) => onMouseLeave?.(event),
      children: /* @__PURE__ */ jsx(StaticIcon, {
        size,
        strokeWidth: innerStrokeWidth,
        focusable: "false",
        "aria-hidden": "true",
      }),
    });
  }
  const AnimatedIcon = resolved.component;
  return /* @__PURE__ */ jsx(AnimatedIcon, {
    ...props,
    ref: iconRef,
    "aria-label": ariaLabel,
    "aria-labelledby": ariaLabelledBy,
    role: labelledRole,
    style: outerStyle,
    "data-gdg-stroke-width": strokeWidth === void 0 ? void 0 : "true",
    strokeWidth,
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
export { Icons };
