import { type CSSProperties, type ReactNode, useEffect, useRef, useState } from "react";

import { cn } from "~/lib/utils";

type MotionStyle = CSSProperties & {
  "--motion-distance": string;
  "--motion-enter-duration": string;
  "--motion-exit-duration": string;
  "--motion-reduced-duration": string;
  "--motion-reduced-opacity": number;
};

type MotionOptions = {
  className?: string;
  distance?: number;
  enterDuration?: number;
  exitDuration?: number;
  reducedDuration?: number;
  reducedOpacity?: number;
};

function motionStyle({
  distance = 4,
  enterDuration = 180,
  exitDuration = 120,
  reducedDuration = 120,
  reducedOpacity = 0.9,
}: Omit<MotionOptions, "className">): MotionStyle {
  return {
    "--motion-distance": `${distance}px`,
    "--motion-enter-duration": `${enterDuration}ms`,
    "--motion-exit-duration": `${exitDuration}ms`,
    "--motion-reduced-duration": `${reducedDuration}ms`,
    "--motion-reduced-opacity": reducedOpacity,
  };
}

function MotionPresence({
  present,
  children,
  className,
  distance = 4,
  enterDuration = 180,
  exitDuration = 120,
  reducedDuration = 120,
  reducedOpacity = 0.9,
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
    <div
      data-motion-state={visible ? "open" : "closed"}
      aria-hidden={visible ? undefined : true}
      inert={present ? undefined : true}
      className={cn("motion-presence", className)}
      style={motionStyle({
        distance,
        enterDuration,
        exitDuration,
        reducedDuration,
        reducedOpacity,
      })}
    >
      {present ? children : lastPresentChildren.current}
    </div>
  );
}

function MotionSwap({
  stateKey,
  children,
  className,
  distance = 4,
  enterDuration = 180,
  exitDuration = 120,
  reducedDuration = 120,
  reducedOpacity = 0.9,
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
    <div
      data-motion-state={visible ? "open" : "closed"}
      aria-hidden={visible ? undefined : true}
      className={cn("motion-presence", className)}
      style={motionStyle({
        distance,
        enterDuration,
        exitDuration,
        reducedDuration,
        reducedOpacity,
      })}
    >
      {displayed.key === stateKey && visible ? children : displayed.children}
    </div>
  );
}

export { MotionPresence, MotionSwap };
