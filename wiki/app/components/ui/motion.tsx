import {
  type CSSProperties,
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import { cn } from "~/lib/utils";

type MotionStyle = CSSProperties & {
  "--motion-translate-x": string;
  "--motion-translate-y": string;
  "--motion-scale": number;
  "--motion-enter-duration": string;
  "--motion-exit-duration": string;
  "--motion-reduced-duration": string;
  "--motion-reduced-opacity": number;
};

type MotionOptions = {
  as?: "div" | "span";
  axis?: "x" | "y";
  className?: string;
  distance?: number;
  enterDuration?: number;
  exitDuration?: number;
  reducedDuration?: number;
  reducedOpacity?: number;
  scale?: number;
  transformOrigin?: CSSProperties["transformOrigin"];
};

// Mirrors the canonical CSS tokens in wiki/app/app.css:152-154. These remain
// numeric because exit timers require millisecond values.
const MOTION_DURATION_ENTER_MS = 200;
const MOTION_DURATION_EXIT_MS = 140;
const MOTION_DURATION_REDUCED_MS = 100;

function useAutoHeightMotion(enabled: boolean) {
  const containerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const container = containerRef.current;
    const content = contentRef.current;
    if (!enabled || !container || !content) return;

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
      animation = container.animate(
        [{ height: `${currentHeight}px` }, { height: `${targetHeight}px` }],
        {
          duration: 240,
          easing: "cubic-bezier(0.23, 1, 0.32, 1)",
          fill: "both",
        },
      );
      animation.onfinish = () => {
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
  }, [enabled]);

  return { containerRef, contentRef };
}

function motionStyle({
  axis = "y",
  distance = 4,
  enterDuration = MOTION_DURATION_ENTER_MS,
  exitDuration = MOTION_DURATION_EXIT_MS,
  reducedDuration = MOTION_DURATION_REDUCED_MS,
  reducedOpacity = 0.9,
  scale = 1,
  transformOrigin,
}: Omit<MotionOptions, "className">): MotionStyle {
  return {
    "--motion-translate-x": axis === "x" ? `${distance}px` : "0px",
    "--motion-translate-y": axis === "y" ? `${distance}px` : "0px",
    "--motion-scale": scale,
    "--motion-enter-duration": `${enterDuration}ms`,
    "--motion-exit-duration": `${exitDuration}ms`,
    "--motion-reduced-duration": `${reducedDuration}ms`,
    "--motion-reduced-opacity": reducedOpacity,
    transformOrigin,
  };
}

/**
 * Keeps content mounted through its exit transition. Use around conditional
 * non-modal content such as inline feedback or a section of a dialog.
 */
function MotionPresence({
  as: Comp = "div",
  present,
  children,
  className,
  axis = "y",
  distance = 4,
  enterDuration = MOTION_DURATION_ENTER_MS,
  exitDuration = MOTION_DURATION_EXIT_MS,
  reducedDuration = MOTION_DURATION_REDUCED_MS,
  reducedOpacity = 0.9,
  scale = 1,
  transformOrigin,
}: MotionOptions & { present: boolean; children: ReactNode }) {
  const [rendered, setRendered] = useState(present);
  const [visible, setVisible] = useState(false);
  const lastPresentChildren = useRef(children);

  if (present) lastPresentChildren.current = children;

  useEffect(() => {
    let timer = 0;

    if (present) {
      setRendered(true);
    } else {
      setVisible(false);
      timer = window.setTimeout(() => setRendered(false), exitDuration);
    }

    return () => window.clearTimeout(timer);
  }, [exitDuration, present]);

  useEffect(() => {
    if (!present || !rendered) return;

    // Mount and reveal must happen in separate painted frames. A single RAF can
    // still be batched with the mount in React 19, skipping the transition.
    let revealFrame = 0;
    const mountFrame = window.requestAnimationFrame(() => {
      revealFrame = window.requestAnimationFrame(() => setVisible(true));
    });

    return () => {
      window.cancelAnimationFrame(mountFrame);
      window.cancelAnimationFrame(revealFrame);
    };
  }, [present, rendered]);

  if (!rendered) return null;

  return (
    <Comp
      data-motion-state={visible ? "open" : "closed"}
      aria-hidden={visible ? undefined : true}
      inert={present ? undefined : true}
      className={cn("motion-presence", className)}
      style={motionStyle({
        axis,
        distance,
        enterDuration,
        exitDuration,
        reducedDuration,
        reducedOpacity,
        scale,
        transformOrigin,
      })}
    >
      {present ? children : lastPresentChildren.current}
    </Comp>
  );
}

/**
 * Crossfades one keyed state through an exit-before-enter transition.
 */
function MotionSwap({
  as: Comp = "div",
  autoHeight = false,
  stateKey,
  children,
  className,
  axis = "y",
  distance = 4,
  enterDuration = MOTION_DURATION_ENTER_MS,
  exitDuration = MOTION_DURATION_EXIT_MS,
  reducedDuration = MOTION_DURATION_REDUCED_MS,
  reducedOpacity = 0.9,
  scale = 1,
  transformOrigin,
}: MotionOptions & { autoHeight?: boolean; stateKey: string; children: ReactNode }) {
  const [displayed, setDisplayed] = useState({ key: stateKey, children });
  const [visible, setVisible] = useState(false);
  const latestChildren = useRef(children);
  const { containerRef, contentRef } = useAutoHeightMotion(autoHeight);
  latestChildren.current = children;

  useEffect(() => {
    let revealFrame = 0;
    let timer = 0;

    if (stateKey === displayed.key) {
      const mountFrame = window.requestAnimationFrame(() => {
        revealFrame = window.requestAnimationFrame(() => setVisible(true));
      });
      return () => {
        window.cancelAnimationFrame(mountFrame);
        window.cancelAnimationFrame(revealFrame);
      };
    }

    setVisible(false);
    timer = window.setTimeout(() => {
      setDisplayed({ key: stateKey, children: latestChildren.current });
    }, exitDuration);

    return () => window.clearTimeout(timer);
  }, [displayed.key, exitDuration, stateKey]);

  const displayedChildren = displayed.key === stateKey && visible ? children : displayed.children;
  const style = motionStyle({
    axis,
    distance,
    enterDuration,
    exitDuration,
    reducedDuration,
    reducedOpacity,
    scale,
    transformOrigin,
  });

  if (autoHeight) {
    return (
      <div
        ref={containerRef}
        data-motion-auto-height
        data-motion-state={visible ? "open" : "closed"}
        aria-hidden={visible ? undefined : true}
        inert={visible ? undefined : true}
        className={cn("motion-presence overflow-hidden", className)}
        style={style}
      >
        <div ref={contentRef}>{displayedChildren}</div>
      </div>
    );
  }

  return (
    <Comp
      data-motion-state={visible ? "open" : "closed"}
      aria-hidden={visible ? undefined : true}
      inert={visible ? undefined : true}
      className={cn("motion-presence", className)}
      style={style}
    >
      {displayedChildren}
    </Comp>
  );
}

export { MotionPresence, MotionSwap };
