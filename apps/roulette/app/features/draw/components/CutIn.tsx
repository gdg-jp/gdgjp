import { type RefObject, useEffect, useRef } from "react";
import { reducedMotion } from "../feedback";
import type { CutInLevel } from "../staging";
import { PachiText } from "./PachiText";

/**
 * The CHANCE cut-in: a dark band with glowing edges slashes across the wheel
 * and the word slams in from the right, then both leave. Its color is the
 * level (blue, red, gold, rainbow). Fixed to the viewport, lined up with
 * `anchor`, so shaking the wheel does not shake it.
 */
export function CutIn({
  level,
  runKey,
  anchor,
}: {
  level: CutInLevel;
  runKey: number;
  anchor: RefObject<HTMLElement | null>;
}) {
  const root = useRef<HTMLDivElement>(null);
  const band = useRef<HTMLDivElement>(null);
  const lines = useRef<HTMLDivElement>(null);
  const word = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!runKey || reducedMotion()) return;
    const box = anchor.current?.getBoundingClientRect();
    if (root.current && box) root.current.style.top = `${box.top + box.height / 2}px`;
    const timing = { duration: 1300, fill: "both" as const };
    const animations = [
      band.current?.animate(
        [
          { transform: "skewY(-6deg) scaleY(0)" },
          { transform: "skewY(-6deg) scaleY(1.25)", offset: 0.1 },
          { transform: "skewY(-6deg) scaleY(1)", offset: 0.18 },
          { transform: "skewY(-6deg) scaleY(1)", offset: 0.84 },
          { transform: "skewY(-6deg) scaleY(0)" },
        ],
        { ...timing, easing: "ease-out" },
      ),
      lines.current?.animate(
        [{ backgroundPosition: "0 0" }, { backgroundPosition: "-600px 0" }],
        timing,
      ),
      word.current?.animate(
        [
          { transform: "translateX(110vw) skewX(-10deg) scale(1.6)" },
          { transform: "translateX(-3vw) skewX(-10deg) scale(1)", offset: 0.16 },
          { transform: "translateX(0) skewX(-10deg) scale(1)", offset: 0.24 },
          { transform: "translateX(1vw) skewX(-10deg) scale(1.06)", offset: 0.82 },
          { transform: "translateX(-110vw) skewX(-10deg) scale(1)" },
        ],
        { ...timing, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)" },
      ),
    ];
    return () => {
      for (const animation of animations) animation?.cancel();
    };
  }, [runKey, anchor]);

  return (
    <div
      ref={root}
      aria-hidden="true"
      className={`pachi-${level} pointer-events-none fixed inset-x-0 top-1/3 z-40 -translate-y-1/2`}
    >
      <div
        ref={band}
        className="pachi-band relative h-32 overflow-hidden"
        style={{ transform: "scaleY(0)" }}
      >
        <div ref={lines} className="pachi-lines absolute inset-0" />
      </div>
      <div
        ref={word}
        className="absolute inset-0 flex items-center justify-center"
        style={{ transform: "translateX(110vw)" }}
      >
        <PachiText text="CHANCE" tone={level} className="text-6xl md:text-8xl" />
      </div>
    </div>
  );
}
