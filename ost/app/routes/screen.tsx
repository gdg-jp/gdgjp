import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useMemo, useRef, useState } from "react";
import { useFetcher } from "react-router";
import { requireEventAccess } from "~/lib/auth-redirect.server";
import type { Group, Topic } from "~/lib/topics";
import { useLiveBoard } from "~/lib/useLiveBoard";
import type { Route } from "./+types/screen";

export function meta({ data }: Route.MetaArgs) {
  return [{ title: data?.event?.title ? `${data.event.title} — スクリーン` : "OST スクリーン" }];
}

export async function loader({ request, context, params }: Route.LoaderArgs) {
  const env = context.cloudflare.env;
  const { event } = await requireEventAccess(env, request, params.slug);
  const state = await env.OST_BOARD.getByName(event.slug).listState();
  return { slug: event.slug, event: { title: event.title }, state };
}

export async function action({ request, context, params }: Route.ActionArgs) {
  const env = context.cloudflare.env;
  const { event } = await requireEventAccess(env, request, params.slug);
  const board = env.OST_BOARD.getByName(event.slug);
  const form = await request.formData();
  const intent = form.get("intent");

  if (intent === "merge") {
    const sourceId = String(form.get("sourceId") ?? "");
    const targetId = String(form.get("targetId") ?? "");
    if (sourceId && targetId) await board.mergeTopics(sourceId, targetId);
  } else if (intent === "ungroup") {
    const topicId = String(form.get("topicId") ?? "");
    if (topicId) await board.ungroupTopic(topicId);
  } else if (intent === "delete") {
    const topicId = String(form.get("topicId") ?? "");
    if (topicId) await board.deleteTopic(topicId);
  } else if (intent === "clear") {
    await board.clearTopics();
  }
  return { ok: true };
}

const ACCENTS = [
  "var(--color-gdg-blue)",
  "var(--color-gdg-red)",
  "var(--color-gdg-yellow)",
  "var(--color-gdg-green)",
];

type Cell = { kind: "topic"; topic: Topic } | { kind: "group"; group: Group; members: Topic[] };

export default function Screen({ loaderData }: Route.ComponentProps) {
  const { slug, state: initial } = loaderData;
  const { state, connected } = useLiveBoard(slug, initial);
  const fetcher = useFetcher();
  const reduceMotion = useReducedMotion();

  const rectRefs = useRef(new Map<string, DOMRect>());
  const [expandedGroupId, setExpandedGroupId] = useState<string | null>(null);

  const cells = useMemo<Cell[]>(() => {
    const membersByGroup = new Map<string, Topic[]>();
    const standalone: Topic[] = [];
    for (const t of state.topics) {
      if (t.groupId) {
        const list = membersByGroup.get(t.groupId) ?? [];
        list.push(t);
        membersByGroup.set(t.groupId, list);
      } else {
        standalone.push(t);
      }
    }
    const out: Cell[] = [];
    for (const g of state.groups) {
      const members = membersByGroup.get(g.id);
      if (members && members.length > 0) out.push({ kind: "group", group: g, members });
    }
    for (const t of standalone) out.push({ kind: "topic", topic: t });
    return out;
  }, [state.topics, state.groups]);

  const cellId = (c: Cell) => (c.kind === "topic" ? c.topic.id : `group:${c.group.id}`);
  // A drag target's representative topic id (what we send to mergeTopics).
  const cellTopicId = (c: Cell) => (c.kind === "topic" ? c.topic.id : c.members[0].id);

  function onDragEnd(source: Cell, clientX: number, clientY: number) {
    for (const other of cells) {
      if (cellId(other) === cellId(source)) continue;
      const rect = rectRefs.current.get(cellId(other));
      if (!rect) continue;
      if (
        clientX >= rect.left &&
        clientX <= rect.right &&
        clientY >= rect.top &&
        clientY <= rect.bottom
      ) {
        fetcher.submit(
          { intent: "merge", sourceId: cellTopicId(source), targetId: cellTopicId(other) },
          { method: "post" },
        );
        return;
      }
    }
  }

  const expanded =
    expandedGroupId != null
      ? (cells.find((c) => c.kind === "group" && c.group.id === expandedGroupId) as
          | Extract<Cell, { kind: "group" }>
          | undefined)
      : undefined;

  return (
    <div className="flex min-h-dvh flex-col gap-6 p-8 lg:p-12">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-baseline gap-4">
          <h1 className="text-3xl font-bold lg:text-4xl">{loaderData.event.title}</h1>
          <span className="text-xl text-neutral-500">{state.topics.length} テーマ</span>
        </div>
        <div className="flex items-center gap-4">
          <span className="flex items-center gap-2 text-lg text-neutral-500">
            <span
              className={`inline-block size-3 rounded-full border border-black ${
                connected ? "bg-gdg-green" : "bg-gdg-yellow"
              }`}
            />
            {connected ? "ライブ" : "再接続中…"}
          </span>
          <button
            type="button"
            onClick={() => {
              if (window.confirm("すべてのテーマを削除します。よろしいですか？")) {
                fetcher.submit({ intent: "clear" }, { method: "post" });
              }
            }}
            className="rounded-full border-2 border-black bg-white px-6 py-2 text-lg font-bold transition hover:bg-neutral-100"
          >
            すべてクリア
          </button>
        </div>
      </header>

      {cells.length === 0 ? (
        <div className="grid flex-1 place-items-center text-center">
          <p className="text-4xl font-bold lg:text-6xl">テーマを募集中…</p>
        </div>
      ) : (
        <ul className="grid flex-1 auto-rows-min gap-6 [grid-template-columns:repeat(auto-fit,minmax(min(100%,24rem),1fr))]">
          {cells.map((c, index) => (
            <motion.li
              key={cellId(c)}
              layout={!reduceMotion}
              drag
              dragSnapToOrigin
              onDragStart={() => {
                for (const other of cells) {
                  const el = document.getElementById(`cell-${cellId(other)}`);
                  if (el) rectRefs.current.set(cellId(other), el.getBoundingClientRect());
                }
              }}
              onDragEnd={(_e, info) => onDragEnd(c, info.point.x, info.point.y)}
              id={`cell-${cellId(c)}`}
              className="relative cursor-grab active:cursor-grabbing"
            >
              {c.kind === "topic" ? (
                <TopicCard
                  topic={c.topic}
                  votes={state.voteCounts[c.topic.id] ?? 0}
                  accent={ACCENTS[index % ACCENTS.length]}
                  onDelete={() =>
                    fetcher.submit({ intent: "delete", topicId: c.topic.id }, { method: "post" })
                  }
                />
              ) : (
                <StackCard
                  count={c.members.length}
                  top={c.members[0]}
                  votes={c.members.reduce((s, m) => s + (state.voteCounts[m.id] ?? 0), 0)}
                  accent={ACCENTS[index % ACCENTS.length]}
                  onOpen={() => setExpandedGroupId(c.group.id)}
                />
              )}
            </motion.li>
          ))}
        </ul>
      )}

      <AnimatePresence>
        {expanded ? (
          <motion.div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-8"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setExpandedGroupId(null)}
          >
            <motion.div
              className="flex max-w-full flex-wrap items-stretch justify-center gap-6 overflow-auto"
              onClick={(e) => e.stopPropagation()}
            >
              {expanded.members.map((m, i) => (
                <motion.div
                  key={m.id}
                  layout={!reduceMotion}
                  initial={{ scale: 0.9, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{ delay: reduceMotion ? 0 : i * 0.04 }}
                  className="relative w-80 rounded-[2rem] border-2 border-black bg-white p-8"
                  style={{ borderTop: `14px solid ${ACCENTS[i % ACCENTS.length]}` }}
                >
                  <button
                    type="button"
                    aria-label="このテーマをグループから外す"
                    onClick={() =>
                      fetcher.submit({ intent: "ungroup", topicId: m.id }, { method: "post" })
                    }
                    className="absolute right-3 top-3 grid size-9 place-items-center rounded-full border-2 border-black bg-white text-lg leading-none hover:bg-gdg-red hover:text-white"
                  >
                    ⤴
                  </button>
                  <p className="pr-10 text-3xl font-bold leading-snug break-words">{m.text}</p>
                  <p className="mt-3 text-sm text-neutral-500">{state.voteCounts[m.id] ?? 0} 票</p>
                </motion.div>
              ))}
            </motion.div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

function TopicCard({
  topic,
  votes,
  accent,
  onDelete,
}: {
  topic: Topic;
  votes: number;
  accent: string;
  onDelete: () => void;
}) {
  return (
    <div
      className="relative rounded-[2rem] border-2 border-black bg-white p-8 lg:p-10"
      style={{ borderTop: `14px solid ${accent}` }}
    >
      <button
        type="button"
        aria-label="このテーマを削除"
        onClick={onDelete}
        className="absolute right-4 top-4 grid size-10 place-items-center rounded-full border-2 border-black bg-white text-2xl leading-none transition hover:bg-gdg-red hover:text-white"
      >
        ×
      </button>
      <p className="pr-12 text-4xl font-bold leading-snug break-words lg:text-5xl">{topic.text}</p>
      <p className="mt-4 text-lg text-neutral-500">{votes} 票</p>
    </div>
  );
}

function StackCard({
  count,
  top,
  votes,
  accent,
  onOpen,
}: {
  count: number;
  top: Topic;
  votes: number;
  accent: string;
  onOpen: () => void;
}) {
  return (
    <button type="button" onClick={onOpen} className="block w-full text-left">
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 translate-x-2 translate-y-2 rounded-[2rem] border-2 border-black bg-white"
      />
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 translate-x-1 translate-y-1 rounded-[2rem] border-2 border-black bg-white"
      />
      <div
        className="relative rounded-[2rem] border-2 border-black bg-white p-8 lg:p-10"
        style={{ borderTop: `14px solid ${accent}` }}
      >
        <span className="absolute right-4 top-4 grid size-10 place-items-center rounded-full border-2 border-black bg-gdg-yellow text-lg font-bold">
          {count}
        </span>
        <p className="pr-12 text-4xl font-bold leading-snug break-words lg:text-5xl">{top.text}</p>
        <p className="mt-4 text-lg text-neutral-500">まとめて {votes} 票 ・ タップで展開</p>
      </div>
    </button>
  );
}
