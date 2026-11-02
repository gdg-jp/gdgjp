import { useEffect, useRef } from "react";
import type { Tier } from "~/features/prizes/prize";
import { reducedMotion } from "../feedback";
import { PachiText } from "./PachiText";

/**
 * Result effects. Their size scales with the tier: the jackpot gets a flash,
 * cannons of confetti and rays; other prizes a confetti burst; a loss only the
 * stamp.
 */

/** The label over the wheel: pachinko lettering for a prize, a quiet pill for a loss. */
export function Stamp({ tier, nearMiss }: { tier: Tier; nearMiss?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (reducedMotion()) return;
    ref.current?.animate(
      tier === "lose"
        ? [
            { opacity: 0, translate: "0 -24px" },
            { opacity: 1, translate: "0 0" },
          ]
        : [
            { opacity: 0, scale: 3 },
            { opacity: 1, scale: 0.9, offset: 0.55 },
            { opacity: 1, scale: 1.08, offset: 0.75 },
            { opacity: 1, scale: 1 },
          ],
      { duration: tier === "lose" ? 700 : 600, easing: "cubic-bezier(0.23, 1, 0.32, 1)" },
    );
  }, [tier]);
  return (
    <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
      <div ref={ref} aria-hidden="true" className="-rotate-6">
        {tier === "lose" ? (
          <div className="rotate-9 rounded-lg bg-surface px-6 py-3 text-xl font-semibold whitespace-nowrap text-foreground shadow-lg">
            {nearMiss ? "おしい…！" : "ざんねん…"}
          </div>
        ) : (
          <PachiText
            text={tier === "jackpot" ? "大当たり" : "当たり"}
            tone={tier === "jackpot" ? "gold" : "red"}
            className={tier === "jackpot" ? "text-7xl" : "text-6xl"}
          />
        )}
      </div>
    </div>
  );
}

function point(radius: number, degrees: number) {
  const angle = (degrees * Math.PI) / 180;
  return [radius * Math.sin(angle), -radius * Math.cos(angle)] as const;
}

export type RayTone = "blue" | "red" | "gold" | "rainbow";

const rayClass: Record<Exclude<RayTone, "rainbow">, string> = {
  blue: "fill-gdg-blue opacity-25",
  red: "fill-gdg-red opacity-30",
  gold: "fill-gdg-yellow opacity-35",
};
const rainbowRays = ["fill-gdg-red", "fill-gdg-yellow", "fill-gdg-green", "fill-gdg-blue"];

/** Rays turning behind the wheel: slowly after a win, fast through a chance. */
export function Sunburst({ tone, fast }: { tone: RayTone; fast?: boolean }) {
  const ref = useRef<SVGSVGElement>(null);
  useEffect(() => {
    if (reducedMotion()) return;
    const animation = ref.current?.animate(
      [{ transform: "rotate(0deg)" }, { transform: "rotate(360deg)" }],
      { duration: fast ? 6000 : 24000, iterations: Number.POSITIVE_INFINITY },
    );
    return () => animation?.cancel();
  }, [fast]);
  const rays = 18;
  return (
    <svg
      ref={ref}
      viewBox="-100 -100 200 200"
      aria-hidden="true"
      className="pointer-events-none absolute top-1/2 left-1/2 size-[160%] -translate-x-1/2 -translate-y-1/2"
    >
      {Array.from({ length: rays }, (_, i) => {
        const [x0, y0] = point(100, (i * 360) / rays);
        const [x1, y1] = point(100, (i * 360) / rays + 180 / rays);
        return (
          <polygon
            // biome-ignore lint/suspicious/noArrayIndexKey: a ray is its position
            key={i}
            points={`0,0 ${x0},${y0} ${x1},${y1}`}
            className={
              tone === "rainbow"
                ? `${rainbowRays[i % rainbowRays.length]} opacity-40`
                : rayClass[tone]
            }
          />
        );
      })}
    </svg>
  );
}

const flashClass = {
  jackpot: "bg-gdg-yellow",
  win: "bg-primary",
  push: "bg-(--gdg-white)",
} as const;

/** A flash over the whole page: yellow for the jackpot, blue for a prize, white for PUSH. */
export function Flash({ tone, runKey }: { tone: keyof typeof flashClass; runKey: number }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!runKey || reducedMotion()) return;
    ref.current?.animate(
      tone === "win"
        ? [{ opacity: 0 }, { opacity: 0.45 }, { opacity: 0 }]
        : [{ opacity: 0 }, { opacity: 0.9 }, { opacity: 0 }, { opacity: 0.6 }, { opacity: 0 }],
      { duration: tone === "win" ? 450 : 900, easing: "ease-out" },
    );
  }, [tone, runKey]);
  return (
    <div
      ref={ref}
      aria-hidden="true"
      className={`pointer-events-none fixed inset-0 z-40 opacity-0 ${flashClass[tone]}`}
    />
  );
}

// ---- confetti ----

type Piece = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  rotation: number;
  spin: number;
  tilt: number;
  tiltSpeed: number;
  wobble: number;
  width: number;
  height: number;
  color: string;
  round: boolean;
  delay: number;
};

function brandColors() {
  const style = getComputedStyle(document.documentElement);
  const colors = ["--gdg-blue", "--gdg-red", "--gdg-yellow", "--gdg-green", "--gdg-white"]
    .map((name) => style.getPropertyValue(name).trim())
    .filter(Boolean);
  return colors.length ? colors : ["gold"];
}

function spawn(tier: "jackpot" | "win", width: number, height: number) {
  const colors = brandColors();
  const random = Math.random;
  const make = (x: number, y: number, vx: number, vy: number, delay: number): Piece => ({
    x,
    y,
    vx,
    vy,
    rotation: random() * Math.PI * 2,
    spin: (random() - 0.5) * 12,
    tilt: random() * Math.PI * 2,
    tiltSpeed: 4 + random() * 8,
    wobble: random() * Math.PI * 2,
    width: 6 + random() * 6,
    height: 10 + random() * 8,
    color: colors[Math.floor(random() * colors.length)] ?? "gold",
    round: random() < 0.2,
    delay,
  });
  const pieces: Piece[] = [];
  if (tier === "jackpot") {
    // Cannons from both bottom corners, then a shower from the top.
    for (const side of [0, 1]) {
      for (let i = 0; i < 95; i += 1) {
        const angle = ((45 + random() * 35) * Math.PI) / 180;
        const speed = 1700 + random() * 1100;
        const direction = side ? -1 : 1;
        pieces.push(
          make(
            side ? width : 0,
            height * 0.98,
            Math.cos(angle) * speed * direction,
            -Math.sin(angle) * speed,
            random() * 0.15,
          ),
        );
      }
    }
    for (let i = 0; i < 80; i += 1)
      pieces.push(
        make(
          random() * width,
          -20,
          (random() - 0.5) * 80,
          80 + random() * 160,
          0.35 + random() * 0.9,
        ),
      );
  } else {
    for (let i = 0; i < 120; i += 1) {
      const angle = random() * Math.PI * 2;
      const speed = 350 + random() * 750;
      pieces.push(
        make(width / 2, height * 0.3, Math.cos(angle) * speed, Math.sin(angle) * speed - 350, 0),
      );
    }
  }
  return pieces;
}

const GRAVITY = 1000;
const DRAG = 3;

function step(pieces: Piece[], dt: number, time: number) {
  const drag = Math.exp(-DRAG * dt);
  for (const piece of pieces) {
    if (time < piece.delay) continue;
    piece.vy += GRAVITY * dt;
    piece.vx *= drag;
    piece.vy *= drag;
    piece.x += (piece.vx + Math.sin(time * 3 + piece.wobble) * 40) * dt;
    piece.y += piece.vy * dt;
    piece.rotation += piece.spin * dt;
    piece.tilt += piece.tiltSpeed * dt;
  }
}

function draw(
  ctx: CanvasRenderingContext2D,
  pieces: Piece[],
  time: number,
  width: number,
  height: number,
) {
  ctx.clearRect(0, 0, width, height);
  for (const piece of pieces) {
    if (time < piece.delay) continue;
    ctx.save();
    ctx.translate(piece.x, piece.y);
    ctx.rotate(piece.rotation);
    ctx.scale(1, Math.cos(piece.tilt));
    ctx.fillStyle = piece.color;
    if (piece.round) {
      ctx.beginPath();
      ctx.arc(0, 0, piece.width / 2, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.fillRect(-piece.width / 2, -piece.height / 2, piece.width, piece.height);
    }
    ctx.restore();
  }
}

export function Confetti({ tier, runKey }: { tier: "jackpot" | "win"; runKey: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!runKey || !canvas || !ctx || reducedMotion()) return;
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const width = window.innerWidth;
    const height = window.innerHeight;
    canvas.width = width * ratio;
    canvas.height = height * ratio;
    ctx.scale(ratio, ratio);
    const pieces = spawn(tier, width, height);
    let frame = 0;
    const start = performance.now();
    let last = start;
    const loop = (now: number) => {
      const time = (now - start) / 1000;
      step(pieces, Math.min((now - last) / 1000, 1 / 30), time);
      last = now;
      draw(ctx, pieces, time, width, height);
      if (time < 5.5) frame = requestAnimationFrame(loop);
      else ctx.clearRect(0, 0, width, height);
    };
    frame = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frame);
  }, [tier, runKey]);
  return <canvas ref={ref} className="pointer-events-none fixed inset-0 z-50 h-full w-full" />;
}
