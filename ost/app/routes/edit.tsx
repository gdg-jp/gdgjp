import { motion } from "motion/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useFetcher } from "react-router";
import { Header } from "~/components/header";
import { requireEventAccess } from "~/lib/auth-redirect.server";
import { boundingBox, fitTransform } from "~/lib/layout";
import type { Desk } from "~/lib/topics";
import { useLiveBoard } from "~/lib/useLiveBoard";
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
  const env = context.cloudflare.env;
  const { event } = await requireEventAccess(env, request, params.slug);
  const board = env.OST_BOARD.getByName(event.slug);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  const num = (k: string) => Number.parseFloat(String(form.get(k) ?? ""));

  switch (intent) {
    case "addDesk":
      await board.addDesk({ x: num("x") || 0, y: num("y") || 0 });
      break;
    case "updateDesk": {
      const patch: Record<string, number | string> = {};
      for (const k of ["x", "y", "width", "height", "rotation"]) {
        const v = num(k);
        if (!Number.isNaN(v)) patch[k] = v;
      }
      const label = form.get("label");
      if (typeof label === "string") patch.label = label;
      await board.updateDesk(String(form.get("id") ?? ""), patch);
      break;
    }
    case "removeDesk":
      await board.removeDesk(String(form.get("id") ?? ""));
      break;
    case "autoAssign":
      await board.autoAssignDesks();
      break;
    case "clearAssign":
      await board.clearAssignments();
      break;
    case "deleteTopic":
      await board.deleteTopic(String(form.get("topicId") ?? ""));
      break;
    case "clearTopics":
      await board.clearTopics();
      break;
  }
  return { ok: true };
}

const DEFAULT_WORLD = { x: 0, y: 0, width: 1200, height: 800 };

export default function Edit({ loaderData }: Route.ComponentProps) {
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

  const world = desks.length > 0 ? boundingBox(desks) : DEFAULT_WORLD;
  const t = useMemo(() => fitTransform(world, viewport), [world, viewport]);

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

  const patchLocal = (id: string, patch: Partial<Desk>) =>
    setDesks((prev) => prev.map((d) => (d.id === id ? { ...d, ...patch } : d)));

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
    draggingRef.current = true;
    const startX = e.clientX;
    const startY = e.clientY;
    const start = { ...desk };
    const centerScreenX = (desk.x + desk.width / 2) * t.scale + t.offsetX;
    const centerScreenY = (desk.y + desk.height / 2) * t.scale + t.offsetY;

    function move(ev: PointerEvent) {
      if (mode === "resize") {
        const w = Math.max(60, start.width + (ev.clientX - startX) / t.scale);
        const h = Math.max(40, start.height + (ev.clientY - startY) / t.scale);
        patchLocal(desk.id, { width: w, height: h });
      } else {
        const ang =
          (Math.atan2(ev.clientY - centerScreenY, ev.clientX - centerScreenX) * 180) / Math.PI + 90;
        patchLocal(desk.id, { rotation: Math.round(ang) });
      }
    }
    function up() {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      draggingRef.current = false;
      setDesks((prev) => {
        const d = prev.find((x) => x.id === desk.id);
        if (d) commit(d);
        return prev;
      });
    }
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  return (
    <div className="mx-auto flex min-h-dvh max-w-6xl flex-col gap-6 p-6 lg:p-8">
      <Header title={`${loaderData.event.title} — 設定`} accountsUrl={accountsUrl} user={user} />

      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          onClick={addDesk}
          className="rounded-full border-2 border-black bg-gdg-blue px-5 py-2 font-bold text-white transition hover:brightness-95"
        >
          机を追加
        </button>
        <button
          type="button"
          onClick={() => fetcher.submit({ intent: "autoAssign" }, { method: "post" })}
          className="rounded-full border-2 border-black bg-white px-5 py-2 font-bold transition hover:bg-neutral-100"
        >
          自動割り当て
        </button>
        <button
          type="button"
          onClick={() => fetcher.submit({ intent: "clearAssign" }, { method: "post" })}
          className="rounded-full border-2 border-black bg-white px-5 py-2 font-bold transition hover:bg-neutral-100"
        >
          割り当てクリア
        </button>
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
        {desks.map((desk) => (
          <motion.div
            key={desk.id}
            drag
            dragSnapToOrigin
            dragMomentum={false}
            onDragStart={() => {
              draggingRef.current = true;
            }}
            onDragEnd={(_e, info) => {
              const moved = {
                ...desk,
                x: desk.x + info.offset.x / t.scale,
                y: desk.y + info.offset.y / t.scale,
              };
              patchLocal(desk.id, { x: moved.x, y: moved.y });
              commit(moved);
              draggingRef.current = false;
            }}
            className="absolute cursor-grab rounded-2xl border-2 border-black bg-surface active:cursor-grabbing"
            style={{
              width: desk.width * t.scale,
              height: desk.height * t.scale,
              left: desk.x * t.scale + t.offsetX,
              top: desk.y * t.scale + t.offsetY,
              rotate: desk.rotation,
            }}
          >
            <div className="grid h-full place-items-center p-1 text-center text-xs font-bold text-neutral-600">
              {desk.label || "机"}
            </div>
            <button
              type="button"
              aria-label="机を削除"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() =>
                fetcher.submit({ intent: "removeDesk", id: desk.id }, { method: "post" })
              }
              className="absolute -right-2 -top-2 grid size-6 place-items-center rounded-full border-2 border-black bg-white text-xs leading-none hover:bg-gdg-red hover:text-white"
            >
              ×
            </button>
            <button
              type="button"
              aria-label="回転"
              onPointerDown={(e) => startHandle(e, desk, "rotate")}
              className="absolute -top-6 left-1/2 size-4 -translate-x-1/2 cursor-alias rounded-full border-2 border-black bg-gdg-yellow"
            />
            <button
              type="button"
              aria-label="サイズ変更"
              onPointerDown={(e) => startHandle(e, desk, "resize")}
              className="absolute -bottom-2 -right-2 size-4 cursor-nwse-resize rounded-full border-2 border-black bg-gdg-green"
            />
          </motion.div>
        ))}
        {desks.length === 0 ? (
          <div className="grid h-full place-items-center text-neutral-400">
            「机を追加」でレイアウトを作成
          </div>
        ) : null}
      </div>

      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold">テーマ（{state.topics.length}）</h2>
          <button
            type="button"
            onClick={() => {
              if (window.confirm("すべてのテーマを削除します。よろしいですか？")) {
                fetcher.submit({ intent: "clearTopics" }, { method: "post" });
              }
            }}
            className="rounded-full border-2 border-black bg-white px-4 py-1.5 text-sm font-bold hover:bg-neutral-100"
          >
            すべて削除
          </button>
        </div>
        <ul className="space-y-1">
          {state.topics.map((topic) => (
            <li
              key={topic.id}
              className="flex items-center gap-3 rounded-xl border-2 border-black bg-white p-2.5"
            >
              <span className="flex-1 break-words">{topic.text}</span>
              <span className="text-sm text-neutral-500">{state.voteCounts[topic.id] ?? 0} 票</span>
              <button
                type="button"
                aria-label="削除"
                onClick={() =>
                  fetcher.submit({ intent: "deleteTopic", topicId: topic.id }, { method: "post" })
                }
                className="grid size-8 place-items-center rounded-full border-2 border-black text-lg leading-none hover:bg-gdg-red hover:text-white"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
