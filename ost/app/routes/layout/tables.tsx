import { AnimatePresence } from "motion/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { ConnectionPill } from "~/components/motion";
import type { Topic } from "~/features/board/protocol";
import { useLiveBoard } from "~/features/board/use-live-board";
import { requireEventAccess } from "~/features/events/access.server";
import { DeskTile } from "~/features/layout/components/DeskTile";
import { boundingBox, fitTransform } from "~/features/layout/geometry";
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

export default function AssignedTables({ loaderData }: Route.ComponentProps) {
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
