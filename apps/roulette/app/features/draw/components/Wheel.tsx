import { type Ref, useEffect, useState } from "react";
import type { Segment, SegmentTone } from "~/features/prizes/odds";
import { reducedMotion } from "../feedback";

const RIM = 200;
const FACE = 176;
const BULB = 188;
const HUB = 40;
const BULBS = 24;

const faceClass: Record<SegmentTone, string> = {
  jackpot: "fill-gdg-yellow",
  blue: "fill-gdg-blue",
  red: "fill-gdg-red",
  green: "fill-gdg-green",
  neutral: "fill-white",
};

const labelClass: Record<SegmentTone, string> = {
  jackpot: "fill-black",
  blue: "fill-white",
  red: "fill-white",
  green: "fill-white",
  neutral: "fill-black",
};

function point(radius: number, degrees: number) {
  const angle = (degrees * Math.PI) / 180;
  return [radius * Math.sin(angle), -radius * Math.cos(angle)] as const;
}

function wedge(index: number, count: number, radius: number) {
  if (count === 1)
    return `M0 ${-radius} A${radius} ${radius} 0 1 1 0 ${radius} A${radius} ${radius} 0 1 1 0 ${-radius} Z`;
  const seg = 360 / count;
  const [x0, y0] = point(radius, index * seg);
  const [x1, y1] = point(radius, (index + 1) * seg);
  return `M0 0 L${x0} ${y0} A${radius} ${radius} 0 ${seg > 180 ? 1 : 0} 1 ${x1} ${y1} Z`;
}

function star(radius: number) {
  return Array.from({ length: 10 }, (_, i) => point(i % 2 ? radius * 0.45 : radius, i * 36))
    .map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`)
    .join(" ");
}

export type LightMode = "idle" | "spin" | "celebrate" | "off";

/** Marquee bulbs on the rim: a slow chase at rest, fast while spinning, blinking on a win. */
function Lights({ mode }: { mode: LightMode }) {
  const [phase, setPhase] = useState(0);
  useEffect(() => {
    if (mode === "off" || reducedMotion()) return;
    const interval = mode === "spin" ? 70 : mode === "celebrate" ? 160 : 420;
    const timer = setInterval(() => setPhase((value) => value + 1), interval);
    return () => clearInterval(timer);
  }, [mode]);
  return (
    <g>
      {Array.from({ length: BULBS }, (_, i) => {
        const [x, y] = point(BULB, (i + 0.5) * (360 / BULBS));
        const on =
          mode === "off"
            ? false
            : mode === "celebrate"
              ? (i + phase) % 2 === 0
              : (i + phase) % 3 === 0;
        return (
          <circle
            // biome-ignore lint/suspicious/noArrayIndexKey: a bulb is its position
            key={i}
            cx={x}
            cy={y}
            r={4.5}
            className={on ? "fill-gdg-yellow" : "fill-white opacity-25"}
          />
        );
      })}
    </g>
  );
}

/**
 * The roulette wheel. `rotation` is the resting angle; while spinning, the
 * caller drives the `wheelRef` group's transform directly so React does not
 * re-render every frame.
 */
export function Wheel({
  segments,
  rotation,
  highlight,
  lights,
  dimmed,
  compact,
  wheelRef,
  pointerRef,
}: {
  segments: Segment[];
  rotation: number;
  highlight?: number;
  lights: LightMode;
  dimmed?: boolean;
  /** Smaller when the result matters more than the wheel (already spun). */
  compact?: boolean;
  wheelRef?: Ref<SVGGElement>;
  pointerRef?: Ref<SVGGElement>;
}) {
  const count = segments.length;
  const seg = 360 / Math.max(count, 1);
  const faded = (i: number) => highlight !== undefined && highlight !== i;
  return (
    <svg
      viewBox="-210 -222 420 432"
      role="img"
      aria-label="景品が並んだルーレット"
      className={`relative mx-auto block w-full select-none ${compact ? "max-w-[240px]" : "max-w-[420px]"} ${dimmed ? "opacity-40" : ""}`}
    >
      <circle r={RIM} className="fill-black" />
      <g ref={wheelRef} transform={`rotate(${rotation})`}>
        {segments.map((segment, i) => (
          <path
            // biome-ignore lint/suspicious/noArrayIndexKey: the same prize repeats around the rim
            key={i}
            d={wedge(i, count, FACE)}
            className={`${faceClass[segment.tone]} stroke-black stroke-[1.5] transition-opacity duration-300 ${faded(i) ? "opacity-30" : ""}`}
          />
        ))}
        {segments.map((segment, i) => (
          <g
            // biome-ignore lint/suspicious/noArrayIndexKey: the same prize repeats around the rim
            key={i}
            transform={`rotate(${(i + 0.5) * seg})`}
            className={`transition-opacity duration-300 ${faded(i) ? "opacity-30" : ""}`}
          >
            {segment.tone === "jackpot" && (
              <polygon
                points={star(9)}
                transform={`translate(0 ${-FACE + 18})`}
                className="fill-black"
              />
            )}
            <text
              x={0}
              y={segment.tone === "jackpot" ? -FACE + 34 : -FACE + 14}
              dominantBaseline="central"
              className={`${labelClass[segment.tone]} font-semibold`}
              style={{ writingMode: "vertical-rl", fontSize: segment.size }}
            >
              {segment.label}
            </text>
          </g>
        ))}
        {highlight !== undefined && count > 0 && (
          <path
            d={wedge(highlight, count, FACE - 3)}
            className="fill-none stroke-white stroke-[6]"
          />
        )}
        <circle r={HUB} className="fill-black" />
        <polygon points={star(24)} className="fill-gdg-yellow" />
      </g>
      <Lights mode={lights} />
      <g ref={pointerRef} className="origin-[0px_-214px]">
        <path d="M-17 -216 L17 -216 L0 -166 Z" className="fill-gdg-red stroke-black stroke-[3]" />
        <circle cx={0} cy={-212} r={6} className="fill-black" />
      </g>
    </svg>
  );
}

/** Flick the pointer back as a slice boundary passes it. */
export function flickPointer(element: SVGGElement | null) {
  element?.animate([{ transform: "rotate(-26deg)" }, { transform: "rotate(0deg)" }], {
    duration: 160,
    easing: "cubic-bezier(0.23, 1, 0.32, 1)",
  });
}
