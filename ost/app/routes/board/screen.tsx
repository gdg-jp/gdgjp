import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useMemo, useRef, useState } from "react";
import { useFetcher } from "react-router";
import { AnimatedCount, ConnectionPill } from "~/components/motion";
import { staggerDelay, tap, transitions } from "~/components/motion-presets";
import { StackCard, TopicCard } from "~/features/board/components/TopicCards";
import { moderateBoard } from "~/features/board/moderation.server";
import type { Group, Topic } from "~/features/board/protocol";
import { useLiveBoard } from "~/features/board/use-live-board";
import { requireEventAccess } from "~/features/events/access.server";
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
  return moderateBoard(context.cloudflare.env, request, params.slug);
}

const ACCENTS = [
  "var(--color-gdg-blue)",
  "var(--color-gdg-red)",
  "var(--color-gdg-yellow)",
  "var(--color-gdg-green)",
];

type Cell = { kind: "topic"; topic: Topic } | { kind: "group"; group: Group; members: Topic[] };

export default function BoardScreen({ loaderData }: Route.ComponentProps) {
  const { slug, state: initial } = loaderData;
  const { state, connected } = useLiveBoard(slug, initial);
  const fetcher = useFetcher();
  const reduceMotion = useReducedMotion();

  const rectRefs = useRef(new Map<string, DOMRect>());
  const [expandedGroupId, setExpandedGroupId] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

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
          <span className="text-xl text-neutral-500">
            <AnimatedCount value={state.topics.length} /> テーマ
          </span>
        </div>
        <div className="flex items-center gap-4">
          <ConnectionPill connected={connected} />
          <motion.button
            {...tap}
            type="button"
            onClick={() => {
              if (window.confirm("すべてのテーマを削除します。よろしいですか？")) {
                fetcher.submit({ intent: "clear" }, { method: "post" });
              }
            }}
            className="rounded-full border-2 border-black bg-white px-6 py-2 text-lg font-bold transition hover:bg-neutral-100"
          >
            すべてクリア
          </motion.button>
        </div>
      </header>

      {cells.length === 0 ? (
        <div className="grid flex-1 place-items-center text-center">
          <p className="text-4xl font-bold lg:text-6xl">テーマを募集中…</p>
        </div>
      ) : (
        <ul className="grid flex-1 auto-rows-min gap-6 [grid-template-columns:repeat(auto-fit,minmax(min(100%,24rem),1fr))]">
          <AnimatePresence initial={false} mode="popLayout">
            {cells.map((c, index) => (
              <motion.li
                key={cellId(c)}
                layout={!reduceMotion}
                initial={reduceMotion ? false : { opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.9 }}
                transition={transitions.springSoft}
                drag
                dragSnapToOrigin
                onDragStart={() => {
                  setDragging(true);
                  for (const other of cells) {
                    const el = document.getElementById(`cell-${cellId(other)}`);
                    if (el) rectRefs.current.set(cellId(other), el.getBoundingClientRect());
                  }
                }}
                onDragEnd={(_e, info) => {
                  setDragging(false);
                  onDragEnd(c, info.point.x, info.point.y);
                }}
                id={`cell-${cellId(c)}`}
                className="relative cursor-grab active:cursor-grabbing"
              >
                {c.kind === "topic" ? (
                  <TopicCard
                    topic={c.topic}
                    votes={state.voteCounts[c.topic.id] ?? 0}
                    accent={ACCENTS[index % ACCENTS.length]}
                    interactive={!dragging}
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
                    interactive={!dragging}
                    onOpen={() => setExpandedGroupId(c.group.id)}
                  />
                )}
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
      )}

      <AnimatePresence>
        {expanded ? (
          <motion.div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-8"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={transitions.fade}
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
                  transition={{ ...transitions.spring, delay: reduceMotion ? 0 : staggerDelay(i) }}
                  className="relative w-80 rounded-[2rem] border-2 border-black bg-white p-8"
                  style={{ borderTop: `14px solid ${ACCENTS[i % ACCENTS.length]}` }}
                >
                  <motion.button
                    {...tap}
                    type="button"
                    aria-label="このテーマをグループから外す"
                    onClick={() =>
                      fetcher.submit({ intent: "ungroup", topicId: m.id }, { method: "post" })
                    }
                    className="absolute right-3 top-3 grid size-9 place-items-center rounded-full border-2 border-black bg-white text-lg leading-none hover:bg-gdg-red hover:text-white"
                  >
                    ⤴
                  </motion.button>
                  <p className="pr-10 text-3xl font-bold leading-snug break-words">{m.text}</p>
                  <p className="mt-3 text-sm text-neutral-500">
                    <AnimatedCount value={state.voteCounts[m.id] ?? 0} /> 票
                  </p>
                </motion.div>
              ))}
            </motion.div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
