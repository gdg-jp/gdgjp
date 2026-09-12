import { ArrowLeft, ArrowRight } from "lucide-react";
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { jsx as _jsx } from "react/jsx-runtime";
import { cn } from "../../utils";
import { Button } from "../Button";
const CarouselContext = createContext(null);
function useCarouselContext() {
  const context = useContext(CarouselContext);
  if (!context) throw new Error("Carousel parts must be used inside Carousel");
  return context;
}
export function Carousel({
  orientation = "horizontal",
  opts,
  setApi,
  className,
  children,
  ...props
}) {
  const [viewport, setViewport] = useState(null);
  const [canPrev, setCanPrev] = useState(false);
  const [canNext, setCanNext] = useState(false);
  const loop = opts?.loop ?? false;
  const updateButtons = useCallback(() => {
    if (!viewport) {
      setCanPrev(false);
      setCanNext(false);
      return;
    }
    const max =
      orientation === "horizontal"
        ? viewport.scrollWidth - viewport.clientWidth
        : viewport.scrollHeight - viewport.clientHeight;
    const current = orientation === "horizontal" ? viewport.scrollLeft : viewport.scrollTop;
    setCanPrev(current > 1 || loop);
    setCanNext(current < max - 1 || loop);
  }, [loop, orientation, viewport]);
  const scroll = useCallback(
    (direction) => {
      if (!viewport) return;
      const distance = orientation === "horizontal" ? viewport.clientWidth : viewport.clientHeight;
      const current = orientation === "horizontal" ? viewport.scrollLeft : viewport.scrollTop;
      const max =
        orientation === "horizontal"
          ? viewport.scrollWidth - viewport.clientWidth
          : viewport.scrollHeight - viewport.clientHeight;
      let target = current + direction * Math.max(distance, 1);
      if (loop && direction < 0 && current <= 1) target = max;
      if (loop && direction > 0 && current >= max - 1) target = 0;
      viewport.scrollTo({
        [orientation === "horizontal" ? "left" : "top"]: target,
        behavior: "smooth",
      });
    },
    [loop, orientation, viewport],
  );
  useEffect(() => {
    updateButtons();
    if (!viewport) return;
    viewport.addEventListener("scroll", updateButtons, { passive: true });
    window.addEventListener("resize", updateButtons);
    return () => {
      viewport.removeEventListener("scroll", updateButtons);
      window.removeEventListener("resize", updateButtons);
    };
  }, [updateButtons, viewport]);
  useEffect(() => {
    setApi?.({
      scrollPrev: () => scroll(-1),
      scrollNext: () => scroll(1),
      canScrollPrev: () => canPrev,
      canScrollNext: () => canNext,
    });
  }, [canNext, canPrev, scroll, setApi]);
  return _jsx(CarouselContext.Provider, {
    value: { orientation, loop, viewport, setViewport, canPrev, canNext, scroll },
    children: _jsx("div", {
      ...props,
      "data-orientation": orientation,
      className: cn("gdg-carousel", className),
      children: children,
    }),
  });
}
export function CarouselContent({ ref, className, children, ...props }) {
  const context = useCarouselContext();
  const setRef = (node) => {
    context.setViewport(node);
    if (typeof ref === "function") ref(node);
    else if (ref) ref.current = node;
  };
  return _jsx("div", {
    ref: setRef,
    ...props,
    className: cn("gdg-carousel-viewport", className),
    children: _jsx("div", { className: "gdg-carousel-content", children: children }),
  });
}
export function CarouselItem({ className, ...props }) {
  return _jsx("div", {
    ...props,
    role: "group",
    "aria-roledescription": "slide",
    className: cn("gdg-carousel-item", className),
  });
}
export function CarouselPrevious({ className, children, ...props }) {
  const context = useCarouselContext();
  return _jsx(Button, {
    ...props,
    type: props.type ?? "button",
    variant: props.variant ?? "outline",
    size: props.size ?? "sm",
    disabled: props.disabled ?? !context.canPrev,
    "aria-label": props["aria-label"] ?? "前のスライド",
    className: cn("gdg-carousel-previous", className),
    onClick: (event) => {
      props.onClick?.(event);
      if (!event.defaultPrevented) context.scroll(-1);
    },
    children: children ?? _jsx(ArrowLeft, { size: 18, "aria-hidden": "true" }),
  });
}
export function CarouselNext({ className, children, ...props }) {
  const context = useCarouselContext();
  return _jsx(Button, {
    ...props,
    type: props.type ?? "button",
    variant: props.variant ?? "outline",
    size: props.size ?? "sm",
    disabled: props.disabled ?? !context.canNext,
    "aria-label": props["aria-label"] ?? "次のスライド",
    className: cn("gdg-carousel-next", className),
    onClick: (event) => {
      props.onClick?.(event);
      if (!event.defaultPrevented) context.scroll(1);
    },
    children: children ?? _jsx(ArrowRight, { size: 18, "aria-hidden": "true" }),
  });
}
export function CarouselViewport({ ref, className, ...props }) {
  const context = useCarouselContext();
  const setRef = (node) => {
    context.setViewport(node);
    if (typeof ref === "function") ref(node);
    else if (ref) ref.current = node;
  };
  return _jsx("div", { ref: setRef, ...props, className: cn("gdg-carousel-viewport", className) });
}
