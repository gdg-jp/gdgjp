import { type CSSProperties, type ReactNode, useEffect, useRef, useState } from "react";

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

function motionStyle({
  axis = "y",
  distance = 4,
  enterDuration = 180,
  exitDuration = 120,
  reducedDuration = 100,
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
  enterDuration = 180,
  exitDuration = 120,
  reducedDuration = 100,
  reducedOpacity = 0.9,
  scale = 1,
  transformOrigin,
}: MotionOptions & { present: boolean; children: ReactNode }) {
  const [rendered, setRendered] = useState(present);
  const [visible, setVisible] = useState(false);
  const lastPresentChildren = useRef(children);

  if (present) lastPresentChildren.current = children;

  useEffect(() => {
    let frame = 0;
    let timer = 0;

    if (present) {
      setRendered(true);
      frame = window.requestAnimationFrame(() => setVisible(true));
    } else {
      setVisible(false);
      timer = window.setTimeout(() => setRendered(false), exitDuration);
    }

    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(timer);
    };
  }, [exitDuration, present]);

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
  stateKey,
  children,
  className,
  axis = "y",
  distance = 4,
  enterDuration = 180,
  exitDuration = 120,
  reducedDuration = 100,
  reducedOpacity = 0.9,
  scale = 1,
  transformOrigin,
}: MotionOptions & { stateKey: string; children: ReactNode }) {
  const [displayed, setDisplayed] = useState({ key: stateKey, children });
  const [visible, setVisible] = useState(false);
  const latestChildren = useRef(children);
  latestChildren.current = children;

  useEffect(() => {
    let frame = 0;
    let timer = 0;

    if (stateKey === displayed.key) {
      frame = window.requestAnimationFrame(() => setVisible(true));
    } else {
      setVisible(false);
      timer = window.setTimeout(() => {
        setDisplayed({ key: stateKey, children: latestChildren.current });
        frame = window.requestAnimationFrame(() => setVisible(true));
      }, exitDuration);
    }

    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(timer);
    };
  }, [displayed.key, exitDuration, stateKey]);

  return (
    <Comp
      data-motion-state={visible ? "open" : "closed"}
      aria-hidden={visible ? undefined : true}
      inert={visible ? undefined : true}
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
      {displayed.key === stateKey && visible ? children : displayed.children}
    </Comp>
  );
}

export { MotionPresence, MotionSwap };
