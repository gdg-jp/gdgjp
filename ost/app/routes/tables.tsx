import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { ConnectionPill } from "~/components/motion";
import { requireEventAccess } from "~/lib/auth-redirect.server";
import { boundingBox, fitTransform } from "~/lib/layout";
import { staggerDelay, transitions } from "~/lib/motion";
import type { Topic } from "~/lib/topics";
import { useLiveBoard } from "~/lib/useLiveBoard";
import type { Route } from "./+types/tables";

export function meta({ data }: Route.MetaArgs) {
  return [
    { title: data?.event?.title ? `${data.event.title} — 机の割り当て` : "OST 机の割り当て" },
  ];
}

export async function loader({ request, context, params }: Route.LoaderArgs) {
  const env = context.cloudflare.env;
  const { event } = await requireEventAccess(env, request, params.slug);
  const state = await env.OST_BOARD.getByName(event.slug).listState();
  return { slug: event.slug, event: { title: event.title }, state };
}

export default function Tables({ loaderData }: Route.ComponentProps) {
  const { slug, state: initial } = loaderData;
  const { state, connected } = useLiveBoard(slug, initial);

  const wrapRef = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState({ width: 1280, height: 720 });
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const update = () => setViewport({ width: el.clientWidth, height: el.clientHeight });
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const transform = useMemo(
    () => fitTransform(boundingBox(state.desks), viewport),
    [state.desks, viewport],
  );

  const topicsByDesk = useMemo(() => {
    const m = new Map<string, Topic[]>();
    for (const t of state.topics) {
      if (!t.deskId) continue;
      const list = m.get(t.deskId) ?? [];
      list.push(t);
      m.set(t.deskId, list);
    }
    return m;
  }, [state.topics]);

  return (
    <div className="flex min-h-dvh flex-col gap-4 p-6 lg:p-10">
      <header className="flex items-baseline justify-between gap-4">
        <h1 className="text-3xl font-bold lg:text-4xl">{loaderData.event.title} — 机の割り当て</h1>
        <ConnectionPill connected={connected} />
      </header>

      <div
        ref={wrapRef}
        className="relative flex-1 overflow-hidden rounded-[1.5rem] border-2 border-black bg-white"
      >
        {state.desks.length === 0 ? (
          <div className="grid h-full place-items-center text-2xl text-neutral-500">
            机がまだ設定されていません
          </div>
        ) : (
          <AnimatePresence initial={false}>
            {state.desks.map((desk, index) => {
              const assigned = topicsByDesk.get(desk.id) ?? [];
              return (
                <DeskTile
                  key={desk.id}
                  index={index}
                  label={desk.label}
                  x={desk.x}
                  y={desk.y}
                  width={desk.width}
                  height={desk.height}
                  rotation={desk.rotation}
                  scale={transform.scale}
                  offsetX={transform.offsetX}
                  offsetY={transform.offsetY}
                  assignedKey={assigned.map((t) => t.id).join("\n")}
                  assignedText={assigned.map((t) => t.text).join("\n")}
                />
              );
            })}
          </AnimatePresence>
        )}
      </div>
    </div>
  );
}

const DeskTile = memo(function DeskTile({
  index,
  label,
  x,
  y,
  width,
  height,
  rotation,
  scale,
  offsetX,
  offsetY,
  assignedKey,
  assignedText,
}: {
  index: number;
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  scale: number;
  offsetX: number;
  offsetY: number;
  assignedKey: string;
  assignedText: string;
}) {
  const reduceMotion = useReducedMotion();
  const lines = assignedText ? assignedText.split("\n") : [];

  return (
    <motion.div
      layout
      initial={reduceMotion ? false : { opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0 }}
      transition={transitions.springSoft}
      className="absolute"
      style={{
        width: width * scale,
        height: height * scale,
        left: x * scale + offsetX,
        top: y * scale + offsetY,
      }}
    >
      <motion.div
        animate={{ rotate: rotation }}
        transition={transitions.springSoft}
        className="grid h-full w-full place-items-center rounded-2xl border-2 border-black bg-surface p-2 text-center"
      >
        <div>
          <div className="text-xs font-bold text-neutral-500">{label || "机"}</div>
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={assignedKey || "none"}
              initial={reduceMotion ? false : { opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -4 }}
              transition={{ ...transitions.fade, delay: reduceMotion ? 0 : staggerDelay(index) }}
            >
              {lines.length === 0 ? (
                <div className="text-sm text-neutral-400">未割り当て</div>
              ) : (
                lines.map((text, i) => (
                  <div
                    // biome-ignore lint/suspicious/noArrayIndexKey: assigned lines are positional, no stable id here
                    key={i}
                    className="text-sm font-bold leading-tight break-words"
                  >
                    {text}
                  </div>
                ))
              )}
            </motion.div>
          </AnimatePresence>
        </div>
      </motion.div>
    </motion.div>
  );
});
