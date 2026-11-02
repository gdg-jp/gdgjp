import { type RefObject, useEffect, useRef } from "react";
import { reducedMotion } from "../feedback";
import type { CutInKind } from "../use-spin";

// Manga style: light letters outlined in black, or dark letters in white on the yellow band.
const lightInk = "text-(--gdg-white) [-webkit-text-stroke:3px_var(--gdg-black)]";
const darkInk = "text-(--gdg-black) [-webkit-text-stroke:3px_var(--gdg-white)]";

const looks: Record<CutInKind, { text: string; band: string; ink: string }> = {
  blue: { text: "チャンス！", band: "bg-gdg-blue", ink: lightInk },
  red: { text: "激アツ！！", band: "bg-gdg-red", ink: lightInk },
  gold: { text: "超激アツ！！！", band: "bg-gdg-yellow", ink: darkInk },
  revive: {
    text: "復活！！",
    band: "[background-image:linear-gradient(90deg,var(--gdg-blue),var(--gdg-red),var(--gdg-yellow),var(--gdg-green))]",
    ink: lightInk,
  },
};

/**
 * The reach cut-in: a band slashes across the wheel and the word slams in
 * from the right, then both leave. Fixed to the viewport (lined up with
 * `anchor`) so shaking the wheel does not shake it.
 */
export function CutIn({
  kind,
  runKey,
  anchor,
}: {
  kind: CutInKind;
  runKey: number;
  anchor: RefObject<HTMLElement | null>;
}) {
  const root = useRef<HTMLDivElement>(null);
  const band = useRef<HTMLDivElement>(null);
  const lines = useRef<HTMLDivElement>(null);
  const word = useRef<HTMLDivElement>(null);
  const look = looks[kind];

  useEffect(() => {
    if (!runKey || reducedMotion()) return;
    const box = anchor.current?.getBoundingClientRect();
    if (root.current && box) root.current.style.top = `${box.top + box.height / 2}px`;
    const timing = { duration: 1300, fill: "both" as const };
    const animations = [
      band.current?.animate(
        [
          { transform: "skewY(-6deg) scaleY(0)" },
          { transform: "skewY(-6deg) scaleY(1.2)", offset: 0.1 },
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
          { transform: "translateX(110vw) skewX(-12deg) scale(1.4)" },
          { transform: "translateX(-3vw) skewX(-12deg) scale(1)", offset: 0.16 },
          { transform: "translateX(0) skewX(-12deg) scale(1)", offset: 0.24 },
          { transform: "translateX(2vw) skewX(-12deg) scale(1.04)", offset: 0.82 },
          { transform: "translateX(-110vw) skewX(-12deg) scale(1)" },
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
      className="pointer-events-none fixed inset-x-0 top-1/3 z-40 -translate-y-1/2"
    >
      <div
        ref={band}
        className={`relative h-28 overflow-hidden border-y-8 border-(--gdg-black) shadow-lg ${look.band}`}
        style={{ transform: "scaleY(0)" }}
      >
        <div
          ref={lines}
          className="absolute inset-0 [background-image:repeating-linear-gradient(100deg,transparent_0_26px,color-mix(in_srgb,var(--gdg-white)_30%,transparent)_26px_32px)]"
        />
      </div>
      <div
        ref={word}
        className={`absolute inset-0 flex items-center justify-center text-5xl font-black whitespace-nowrap [paint-order:stroke_fill] md:text-7xl ${look.ink}`}
        style={{ transform: "translateX(110vw)" }}
      >
        {look.text}
      </div>
    </div>
  );
}
