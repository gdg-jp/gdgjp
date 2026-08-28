import { useEffect, useRef, useState } from "react";
import { useFetcher } from "react-router";
import type { BoardMessage, Topic } from "~/lib/topics";
import type { Route } from "./+types/admin";

export function meta(_: Route.MetaArgs) {
  return [{ title: "OST スクリーン" }];
}

export async function loader({ context }: Route.LoaderArgs) {
  const { env } = context.cloudflare;
  const topics = await env.OST_BOARD.getByName("default").listTopics();
  return { topics, appUrl: env.APP_URL };
}

export async function action({ request, context }: Route.ActionArgs) {
  const formData = await request.formData();
  const intent = formData.get("intent");
  const board = context.cloudflare.env.OST_BOARD.getByName("default");

  if (intent === "delete") {
    const id = formData.get("id");
    if (typeof id === "string" && id.length > 0) {
      await board.deleteTopic(id);
    }
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

function useLiveTopics(initial: Topic[]) {
  const [topics, setTopics] = useState<Topic[]>(initial);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    let unmounted = false;
    let socket: WebSocket | null = null;
    let retry = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const apply = (message: BoardMessage) => {
      setTopics((current) => {
        switch (message.type) {
          case "snapshot":
            return message.topics;
          case "added":
            return current.some((t) => t.id === message.topic.id)
              ? current
              : [...current, message.topic];
          case "deleted":
            return current.filter((t) => t.id !== message.id);
          case "cleared":
            return [];
          default:
            return current;
        }
      });
    };

    const connect = () => {
      if (unmounted) return;
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      socket = new WebSocket(`${protocol}//${window.location.host}/ws`);

      socket.addEventListener("open", () => {
        retry = 0;
        setConnected(true);
      });
      socket.addEventListener("message", (event) => {
        try {
          apply(JSON.parse(event.data as string) as BoardMessage);
        } catch {
          // ignore malformed frames
        }
      });
      socket.addEventListener("close", () => {
        setConnected(false);
        if (unmounted) return;
        const delay = Math.min(1000 * 2 ** retry, 30_000);
        retry += 1;
        timer = setTimeout(connect, delay);
      });
      socket.addEventListener("error", () => socket?.close());
    };

    connect();

    return () => {
      unmounted = true;
      if (timer) clearTimeout(timer);
      socket?.close();
    };
  }, []);

  return { topics, connected };
}

export default function Admin({ loaderData }: Route.ComponentProps) {
  const { topics, connected } = useLiveTopics(loaderData.topics);
  const fetcher = useFetcher<typeof action>();

  const submitUrl = loaderData.appUrl?.replace(/^https?:\/\//, "") ?? "ost.gdgs.jp";

  const clearBoard = () => {
    if (window.confirm("すべてのテーマを削除します。よろしいですか？")) {
      fetcher.submit({ intent: "clear" }, { method: "post" });
    }
  };

  return (
    <div className="flex min-h-dvh flex-col gap-8 p-8 lg:p-12">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-baseline gap-4">
          <h1 className="text-3xl font-bold lg:text-4xl">Open Space Technology</h1>
          <span className="text-xl text-neutral-500 lg:text-2xl">{topics.length} テーマ</span>
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
            onClick={clearBoard}
            className="rounded-full border-2 border-black bg-white px-6 py-2 text-lg font-bold transition hover:bg-neutral-100"
          >
            すべてクリア
          </button>
        </div>
      </header>

      {topics.length === 0 ? (
        <div className="grid flex-1 place-items-center text-center">
          <div className="space-y-6">
            <p className="text-4xl font-bold lg:text-6xl">テーマを募集中…</p>
            <p className="text-2xl text-neutral-600 lg:text-3xl">
              <span className="font-bold">{submitUrl}</span> を開いて投稿してください
            </p>
          </div>
        </div>
      ) : (
        <ul className="grid flex-1 auto-rows-min gap-6 [grid-template-columns:repeat(auto-fit,minmax(min(100%,26rem),1fr))] lg:gap-8">
          {topics.map((topic, index) => (
            <li
              key={topic.id}
              className="relative rounded-[2rem] border-2 border-black bg-white p-8 lg:p-10"
              style={{ borderTop: `14px solid ${ACCENTS[index % ACCENTS.length]}` }}
            >
              <fetcher.Form method="post" className="absolute right-4 top-4">
                <input type="hidden" name="intent" value="delete" />
                <input type="hidden" name="id" value={topic.id} />
                <button
                  type="submit"
                  aria-label="このテーマを削除"
                  className="grid size-10 place-items-center rounded-full border-2 border-black bg-white text-2xl leading-none transition hover:bg-gdg-red hover:text-white"
                >
                  ×
                </button>
              </fetcher.Form>
              <p className="pr-12 text-4xl font-bold leading-snug break-words lg:text-5xl xl:text-6xl">
                {topic.text}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
