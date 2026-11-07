import { Badge, Button, Icons, Spinner, Text } from "@gdgjp/design-system";
import { useEffect, useRef } from "react";
import { Link, useFetcher } from "react-router";
import type { Message, MessageAction } from "../message";
import { MessageBody } from "./MessageBody";

const time = (epoch: number) =>
  new Date(epoch * 1000).toLocaleString("ja-JP", {
    timeZone: "Asia/Tokyo",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

const STATUS_TEXT: Record<MessageAction["status"], string> = {
  proposed: "",
  done: "済み",
  failed: "できませんでした",
  dismissed: "見送り",
};

function ActionButton({
  message,
  action,
  index,
}: {
  message: Message;
  action: MessageAction;
  index: number;
}) {
  const fetcher = useFetcher();
  if (action.type === "open_page" && action.path)
    return (
      <Button asChild size="sm" variant="outline">
        <Link to={action.path}>{action.label}</Link>
      </Button>
    );
  if (action.status !== "proposed")
    return (
      <span className="inline-flex items-center gap-1 text-sm text-muted">
        <Icons
          name={action.status === "done" ? "Check" : action.status === "failed" ? "X" : "Ban"}
          size={14}
          aria-hidden="true"
        />
        {action.label}: {action.result ?? STATUS_TEXT[action.status]}
      </span>
    );
  return (
    <fetcher.Form method="post" className="inline-flex">
      <input type="hidden" name="message" value={message.id} />
      <input type="hidden" name="index" value={index} />
      <Button
        type="submit"
        name="intent"
        value="action"
        size="sm"
        variant={index === 0 ? "primary" : "outline"}
        loading={fetcher.state !== "idle"}
      >
        {action.label}
      </Button>
    </fetcher.Form>
  );
}

function Bubble({ message, base }: { message: Message; base: string }) {
  const mine = message.author === "user";
  return (
    <li className={`flex ${mine ? "justify-end" : "justify-start"}`} data-message={message.id}>
      <div
        className={`max-w-[85%] rounded-lg border px-4 py-3 ${mine ? "border-transparent bg-selected" : "border-border bg-surface"}`}
      >
        <div className="mb-1 flex items-center gap-2 text-xs text-muted">
          <span className="font-semibold text-foreground">
            {mine ? (message.userName ?? "メンバー") : "秘書"}
          </span>
          <time>{time(message.createdAt)}</time>
        </div>
        {message.body ? <MessageBody text={message.body} /> : null}
        {message.attachments.length ? (
          <div className="mt-2 flex flex-wrap gap-2">
            {message.attachments.map((a) =>
              a.type.startsWith("image/") ? (
                <a key={a.id} href={`${base}/files/${a.id}`} target="_blank" rel="noreferrer">
                  <img
                    src={`${base}/files/${a.id}`}
                    alt={a.name}
                    className="h-24 w-auto rounded border border-border object-cover"
                  />
                </a>
              ) : (
                <Badge key={a.id} tone="neutral">
                  {a.name}
                </Badge>
              ),
            )}
          </div>
        ) : null}
        {message.meta.briefChanges?.length ? (
          <div className="mt-3 rounded-md bg-selected/50 px-3 py-2 text-sm">
            <Link to={`${base}/brief`} className="font-semibold hover:underline">
              brief を更新しました（版 {message.meta.briefVersion}）
            </Link>
            <ul className="mt-1 list-disc pl-5">
              {message.meta.briefChanges.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
          </div>
        ) : null}
        {message.questions.length ? (
          <ul className="mt-3 space-y-1 text-sm">
            {message.questions.map((q) => (
              <li key={q} className="flex gap-2">
                <Icons name="CircleHelp" size={16} aria-hidden="true" className="mt-0.5 shrink-0" />
                {q}
              </li>
            ))}
          </ul>
        ) : null}
        {message.actions.length ? (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {message.actions.map((action, index) => (
              <ActionButton
                // biome-ignore lint/suspicious/noArrayIndexKey: actions are addressed by index
                key={index}
                message={message}
                action={action}
                index={index}
              />
            ))}
          </div>
        ) : null}
      </div>
    </li>
  );
}

/** The event's conversation with the assistant, newest at the bottom. */
export function Thread({
  messages,
  base,
  thinking,
}: {
  messages: Message[];
  base: string;
  thinking: boolean;
}) {
  const end = useRef<HTMLLIElement>(null);
  const last = messages.at(-1)?.id;
  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll when a message arrives
  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [last, thinking]);
  return (
    <ol className="flex flex-col gap-3" aria-label="スレッド">
      {messages.length === 0 ? (
        <li className="rounded-lg border border-border bg-surface px-4 py-3">
          <Text className="font-semibold">秘書です。準備を始めましょう。</Text>
          <Text tone="muted" className="mt-1">
            イベントページ（connpass・Bevy など）や企画書の
            URL、タイムテーブルやフライヤーの画像を送ってください。 読んで
            brief（イベントの情報）を作り、計画、投稿やメールの下書きまで進めます。公開前で資料しかなくても大丈夫です。
          </Text>
        </li>
      ) : null}
      {messages.map((m) => (
        <Bubble key={m.id} message={m} base={base} />
      ))}
      {thinking ? (
        <li className="flex items-center gap-2 text-sm text-muted">
          <Spinner label="考え中" /> 秘書が読んでいます（1〜3 分かかります）
        </li>
      ) : null}
      <li ref={end} aria-hidden="true" />
    </ol>
  );
}
