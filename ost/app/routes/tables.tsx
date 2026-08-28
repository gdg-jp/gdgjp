import { useEffect, useMemo, useRef, useState } from "react";
import { requireEventAccess } from "~/lib/auth-redirect.server";
import { boundingBox, fitTransform } from "~/lib/layout";
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
        <span className="flex items-center gap-2 text-lg text-neutral-500">
          <span
            className={`inline-block size-3 rounded-full border border-black ${
              connected ? "bg-gdg-green" : "bg-gdg-yellow"
            }`}
          />
          {connected ? "ライブ" : "再接続中…"}
        </span>
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
          state.desks.map((desk) => {
            const assigned = topicsByDesk.get(desk.id) ?? [];
            return (
              <div
                key={desk.id}
                className="absolute grid place-items-center rounded-2xl border-2 border-black bg-surface p-2 text-center"
                style={{
                  width: desk.width * transform.scale,
                  height: desk.height * transform.scale,
                  left: desk.x * transform.scale + transform.offsetX,
                  top: desk.y * transform.scale + transform.offsetY,
                  transform: `rotate(${desk.rotation}deg)`,
                }}
              >
                <div>
                  <div className="text-xs font-bold text-neutral-500">{desk.label || "机"}</div>
                  {assigned.length === 0 ? (
                    <div className="text-sm text-neutral-400">未割り当て</div>
                  ) : (
                    assigned.map((t) => (
                      <div key={t.id} className="text-sm font-bold leading-tight break-words">
                        {t.text}
                      </div>
                    ))
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
