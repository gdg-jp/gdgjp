import { useEffect, useRef } from "react";
import { reducedMotion } from "../feedback";
import type { CutInLevel } from "../staging";
import { PachiText } from "./PachiText";

export type Prompt = {
  kind: "renda" | "push";
  level: CutInLevel;
  key: number;
  /** Push only: the press happens by itself after this long. */
  timeout?: number;
};

const RING = 2 * Math.PI * 76;

/**
 * The chance button, fixed at the bottom within thumb reach. 連打 asks for
 * rapid taps that fill a gauge and change nothing; 押せ asks for one press
 * that sends the wheel on into the prize. The result was decided before
 * either shows up.
 */
export function ChancePrompt({
  prompt,
  gauge,
  taps,
  onPress,
}: {
  prompt: Prompt;
  /** 0–1, renda only. */
  gauge: number;
  taps: number;
  onPress: () => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const ripple = useRef<HTMLSpanElement>(null);
  const countdown = useRef<SVGCircleElement>(null);

  useEffect(() => {
    if (!prompt.key) return;
    button.current?.focus({ preventScroll: true });
    if (reducedMotion()) return;
    root.current?.animate(
      [
        { opacity: 0, transform: "translateY(48px) scale(0.7)" },
        { opacity: 1, transform: "none" },
      ],
      { duration: 280, easing: "cubic-bezier(0.2, 0.8, 0.3, 1.3)" },
    );
    if (prompt.timeout)
      countdown.current?.animate([{ strokeDashoffset: 0 }, { strokeDashoffset: RING }], {
        duration: prompt.timeout,
        fill: "forwards",
      });
  }, [prompt.key, prompt.timeout]);

  const press = () => {
    onPress();
    ripple.current?.animate(
      [
        { opacity: 0.9, transform: "scale(1)" },
        { opacity: 0, transform: "scale(1.7)" },
      ],
      { duration: 360, easing: "ease-out" },
    );
  };

  return (
    <div
      ref={root}
      className={`pachi-${prompt.level} pointer-events-none fixed inset-x-0 bottom-0 z-40 flex flex-col items-center gap-3 pb-[max(28px,env(safe-area-inset-bottom))]`}
    >
      <PachiText
        text={prompt.kind === "renda" ? "連打!!" : "押せ!!"}
        tone={prompt.level}
        className="text-5xl md:text-6xl"
      />
      {prompt.kind === "renda" && (
        <div className="flex w-72 items-center gap-3">
          <div className="pachi-gauge h-5 flex-1 overflow-hidden rounded-full">
            <div className="pachi-gauge-fill h-full" style={{ width: `${gauge * 100}%` }} />
          </div>
          <PachiText
            text={gauge >= 1 ? "MAX" : `×${taps}`}
            tone={gauge >= 1 ? "rainbow" : "white"}
            className="w-20 text-2xl"
          />
        </div>
      )}
      <div className="relative grid size-44 place-items-center">
        {prompt.kind === "push" && (
          <svg viewBox="-80 -80 160 160" aria-hidden="true" className="absolute inset-0 -rotate-90">
            <circle
              ref={countdown}
              r={76}
              strokeDasharray={RING}
              className="pachi-countdown fill-none stroke-[6]"
            />
          </svg>
        )}
        <span
          ref={ripple}
          aria-hidden="true"
          className="pachi-ripple pointer-events-none absolute size-36 rounded-full opacity-0"
        />
        <button
          ref={button}
          type="button"
          aria-label={prompt.kind === "renda" ? "連打する" : "押す"}
          className="pachi-button pointer-events-auto relative size-36 touch-manipulation rounded-full transition-transform duration-75 select-none active:scale-90"
          onPointerDown={(event) => {
            event.preventDefault();
            press();
          }}
          onKeyDown={(event) => {
            if ((event.key === " " || event.key === "Enter") && !event.repeat) {
              event.preventDefault();
              press();
            }
          }}
        >
          <PachiText text="PUSH" tone="white" className="text-4xl" />
        </button>
      </div>
    </div>
  );
}
