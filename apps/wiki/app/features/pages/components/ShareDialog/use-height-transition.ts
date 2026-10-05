import { useLayoutEffect, useRef } from "react";

/** Animates a container's height to match its content on resize. */
export function useHeightTransition() {
  const containerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const container = containerRef.current;
    const content = contentRef.current;
    if (!container || !content) return;

    let initialized = false;
    let animation: Animation | null = null;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

    const resize = () => {
      const targetHeight = content.getBoundingClientRect().height;
      const currentHeight = container.getBoundingClientRect().height;

      if (!initialized || reducedMotion.matches) {
        initialized = true;
        animation?.cancel();
        container.style.height = `${targetHeight}px`;
        return;
      }
      if (Math.abs(currentHeight - targetHeight) < 1) return;

      animation?.cancel();
      const nextAnimation = container.animate(
        [{ height: `${currentHeight}px` }, { height: `${targetHeight}px` }],
        {
          duration: 240,
          easing: "cubic-bezier(0.23, 1, 0.32, 1)",
          fill: "both",
        },
      );
      animation = nextAnimation;
      nextAnimation.onfinish = () => {
        if (animation !== nextAnimation) return;
        container.style.height = `${targetHeight}px`;
        animation = null;
      };
    };

    const observer = new ResizeObserver(resize);
    observer.observe(content);
    resize();

    return () => {
      observer.disconnect();
      animation?.cancel();
    };
  }, []);

  return { containerRef, contentRef };
}
