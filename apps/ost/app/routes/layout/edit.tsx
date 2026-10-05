import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useFetcher } from "react-router";
import { AnimatedCount } from "~/components/motion";
import { listItem, tapSubtle, transitions } from "~/components/motion-presets";
import type { Desk } from "~/features/board/protocol";
import { useLiveBoard } from "~/features/board/use-live-board";
import { requireEventAccess } from "~/features/events/access.server";
import { DeskNode } from "~/features/layout/components/DeskNode";
import {
  type Transform,
  angleFromCenter,
  boundingBox,
  fitTransform,
  normalizeAngle,
  resizeDesk,
} from "~/features/layout/geometry";
import { updateLayout } from "~/features/layout/management.server";
import { Header } from "~/layouts/header";
import type { Route } from "./+types/edit";

export function meta({ data }: Route.MetaArgs) {
  return [{ title: data?.event?.title ? `${data.event.title} — 設定` : "OST 設定" }];
}

export async function loader({ request, context, params }: Route.LoaderArgs) {
  const env = context.cloudflare.env;
  const { user, event } = await requireEventAccess(env, request, params.slug);
  const state = await env.OST_BOARD.getByName(event.slug).listState();
  return {
    slug: event.slug,
    event: { title: event.title, chapterSlug: event.chapterSlug },
    state,
    user: { name: user.name, email: user.email, image: user.image },
    accountsUrl: env.ACCOUNTS_URL,
  };
}

export async function action({ request, context, params }: Route.ActionArgs) {
  return updateLayout(context.cloudflare.env, request, params.slug);
}

const DEFAULT_WORLD = { x: 0, y: 0, width: 1200, height: 800 };

export default function LayoutEditor({ loaderData }: Route.ComponentProps) {
  const { slug, state: initial, user, accountsUrl } = loaderData;
  const { state } = useLiveBoard(slug, initial);
  const fetcher = useFetcher();

  const [desks, setDesks] = useState<Desk[]>(state.desks);
  const draggingRef = useRef(false);
  useEffect(() => {
    if (!draggingRef.current) setDesks(state.desks);
  }, [state.desks]);

  const wrapRef = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState({ width: 960, height: 600 });
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const update = () => setViewport({ width: el.clientWidth, height: el.clientHeight });
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const world = useMemo(() => (desks.length > 0 ? boundingBox(desks) : DEFAULT_WORLD), [desks]);
  const liveT = useMemo(() => fitTransform(world, viewport), [world, viewport]);
  // While a desk is being dragged/resized/rotated, the transform is frozen at
  // its pre-gesture value — otherwise every in-flight size/rotation change
  // reshapes the bounding box, which rescales and re-centers every desk
  // (including the one under the pointer) mid-gesture.
  const [frozenT, setFrozenT] = useState<Transform | null>(null);
  const t = frozenT ?? liveT;

  const beginGesture = useCallback((frozen: Transform) => {
    draggingRef.current = true;
    setFrozenT(frozen);
  }, []);
  const endGesture = useCallback(() => {
    draggingRef.current = false;
    setFrozenT(null);
  }, []);

  const commit = useCallback(
    (desk: Desk) => {
      fetcher.submit(
        {
          intent: "updateDesk",
          id: desk.id,
          x: String(Math.round(desk.x)),
          y: String(Math.round(desk.y)),
          width: String(Math.round(desk.width)),
          height: String(Math.round(desk.height)),
          rotation: String(Math.round(desk.rotation)),
        },
        { method: "post" },
      );
    },
    [fetcher],
  );

  const patchLocal = useCallback(
    (id: string, patch: Partial<Desk>) =>
      setDesks((prev) => prev.map((d) => (d.id === id ? { ...d, ...patch } : d))),
    [],
  );

  const handleDragCommit = useCallback(
    (moved: Desk) => {
      patchLocal(moved.id, { x: moved.x, y: moved.y });
      commit(moved);
    },
    [patchLocal, commit],
  );

  const handleRemove = useCallback(
    (id: string) => fetcher.submit({ intent: "removeDesk", id }, { method: "post" }),
    [fetcher],
  );

  function addDesk() {
    const cx = world.x + world.width / 2 - 80;
    const cy = world.y + world.height / 2 - 50;
    fetcher.submit(
      { intent: "addDesk", x: String(Math.round(cx)), y: String(Math.round(cy)) },
      { method: "post" },
    );
  }

  // Resize / rotate via raw pointer math (Motion drag only handles position).
  function startHandle(e: React.PointerEvent, desk: Desk, mode: "resize" | "rotate") {
    e.preventDefault();
    e.stopPropagation();
    const rect = wrapRef.current?.getBoundingClientRect();
    if (!rect) return;
    const tr = t;
    beginGesture(tr);

    const start = { ...desk };
    const startX = e.clientX;
    const startY = e.clientY;
    // Pointer coords arrive in viewport space; the canvas transform is
    // relative to the wrapper's own box, so subtract its offset first.
    const toLocal = (ev: { clientX: number; clientY: number }) => ({
      x: ev.clientX - rect.left,
      y: ev.clientY - rect.top,
    });
    const center = {
      x: (start.x + start.width / 2) * tr.scale + tr.offsetX,
      y: (start.y + start.height / 2) * tr.scale + tr.offsetY,
    };
    // Rotate relative to the angle at grab time, so the handle doesn't jump
    // to an absolute angle and stays under the cursor.
    const startAngle = angleFromCenter(center, toLocal(e));
    const latest = { ...start };

    function move(ev: PointerEvent) {
      const patch =
        mode === "resize"
          ? resizeDesk(start, ev.clientX - startX, ev.clientY - startY, tr)
          : {
              rotation: normalizeAngle(
                start.rotation + (angleFromCenter(center, toLocal(ev)) - startAngle),
              ),
            };
      Object.assign(latest, patch);
      patchLocal(desk.id, patch);
    }
    function up() {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      endGesture();
      commit(latest);
    }
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  }

  return (
    <div className="mx-auto flex min-h-dvh max-w-6xl flex-col gap-6 p-6 lg:p-8">
      <Header title={`${loaderData.event.title} — 設定`} accountsUrl={accountsUrl} user={user} />

      <div className="flex flex-wrap gap-3">
        <motion.button
          {...tapSubtle}
          type="button"
          onClick={addDesk}
          className="rounded-full border-2 border-black bg-gdg-blue px-5 py-2 font-bold text-white transition hover:brightness-95"
        >
          机を追加
        </motion.button>
        <motion.button
          {...tapSubtle}
          type="button"
          onClick={() => fetcher.submit({ intent: "autoAssign" }, { method: "post" })}
          className="rounded-full border-2 border-black bg-white px-5 py-2 font-bold transition hover:bg-neutral-100"
        >
          自動割り当て
        </motion.button>
        <motion.button
          {...tapSubtle}
          type="button"
          onClick={() => fetcher.submit({ intent: "clearAssign" }, { method: "post" })}
          className="rounded-full border-2 border-black bg-white px-5 py-2 font-bold transition hover:bg-neutral-100"
        >
          割り当てクリア
        </motion.button>
        <Link
          to={`/${slug}/tables`}
          className="rounded-full border-2 border-black bg-white px-5 py-2 font-bold transition hover:bg-neutral-100"
        >
          割り当てを表示
        </Link>
      </div>

      <div
        ref={wrapRef}
        className="relative h-[60vh] overflow-hidden rounded-[1.5rem] border-2 border-black bg-white"
      >
        <AnimatePresence initial={false}>
          {desks.map((desk) => (
            <DeskNode
              key={desk.id}
              desk={desk}
              t={t}
              onBeginGesture={beginGesture}
              onEndGesture={endGesture}
              onDragCommit={handleDragCommit}
              onHandleStart={startHandle}
              onRemove={handleRemove}
            />
          ))}
        </AnimatePresence>
        {desks.length === 0 ? (
          <div className="grid h-full place-items-center text-neutral-400">
            「机を追加」でレイアウトを作成
          </div>
        ) : null}
      </div>

      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold">テーマ（{state.topics.length}）</h2>
          <motion.button
            {...tapSubtle}
            type="button"
            onClick={() => {
              if (window.confirm("すべてのテーマを削除します。よろしいですか？")) {
                fetcher.submit({ intent: "clearTopics" }, { method: "post" });
              }
            }}
            className="rounded-full border-2 border-black bg-white px-4 py-1.5 text-sm font-bold hover:bg-neutral-100"
          >
            すべて削除
          </motion.button>
        </div>
        <ul className="space-y-1">
          <AnimatePresence initial={false}>
            {state.topics.map((topic) => (
              <motion.li
                key={topic.id}
                layout
                variants={listItem}
                initial="initial"
                animate="animate"
                exit="exit"
                transition={transitions.springSoft}
                className="flex items-center gap-3 rounded-xl border-2 border-black bg-white p-2.5"
              >
                <span className="flex-1 break-words">{topic.text}</span>
                <span className="text-sm text-neutral-500">
                  <AnimatedCount value={state.voteCounts[topic.id] ?? 0} /> 票
                </span>
                <motion.button
                  {...tapSubtle}
                  type="button"
                  aria-label="削除"
                  onClick={() =>
                    fetcher.submit({ intent: "deleteTopic", topicId: topic.id }, { method: "post" })
                  }
                  className="grid size-8 place-items-center rounded-full border-2 border-black text-lg leading-none hover:bg-gdg-red hover:text-white"
                >
                  ×
                </motion.button>
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
      </section>
    </div>
  );
}
