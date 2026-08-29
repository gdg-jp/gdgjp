import { AnimatePresence, motion } from "motion/react";
import { Dialog } from "radix-ui";
import { useEffect, useMemo, useState } from "react";
import { Form, data, useActionData, useFetcher, useNavigation } from "react-router";
import { AnimatedCount, ConfettiBurst } from "~/components/motion";
import { getEventBySlug } from "~/lib/db";
import { listItem, tap, transitions } from "~/lib/motion";
import { normalizeSlug } from "~/lib/slug";
import { normalizeTopicText } from "~/lib/topics";
import { useLiveBoard } from "~/lib/useLiveBoard";
import { ensureVoterId } from "~/lib/voter-cookie";
import type { Route } from "./+types/board";

export function meta({ data: loaderData }: Route.MetaArgs) {
  const title = loaderData?.event?.title;
  return [{ title: title ? `${title} — テーマ投稿` : "OST テーマ投稿" }];
}

export function headers({ loaderHeaders }: Route.HeadersArgs) {
  return loaderHeaders;
}

export async function loader({ request, context, params }: Route.LoaderArgs) {
  const env = context.cloudflare.env;
  const slug = normalizeSlug(params.slug);
  if (!slug) throw new Response(null, { status: 404 });

  const event = await getEventBySlug(env.DB, slug);
  if (!event) throw new Response(null, { status: 404 });

  const secure = !/^http:\/\/(localhost|127\.0\.0\.1)/.test(env.APP_URL);
  const voter = ensureVoterId(request, { secure });
  const board = env.OST_BOARD.getByName(slug);
  const [state, myVotes] = await Promise.all([board.listState(), board.listVotesFor(voter.id)]);

  const payload = {
    slug,
    event: { title: event.title },
    state,
    voterId: voter.id,
    myVotes,
  };
  return voter.setCookie
    ? data(payload, { headers: { "Set-Cookie": voter.setCookie } })
    : data(payload);
}

export async function action({ request, context, params }: Route.ActionArgs) {
  const env = context.cloudflare.env;
  const slug = normalizeSlug(params.slug);
  if (!slug) throw new Response(null, { status: 404 });
  const event = await getEventBySlug(env.DB, slug);
  if (!event) throw new Response(null, { status: 404 });

  const board = env.OST_BOARD.getByName(slug);
  const form = await request.formData();
  const intent = form.get("intent");

  if (intent === "vote") {
    const secure = !/^http:\/\/(localhost|127\.0\.0\.1)/.test(env.APP_URL);
    const voter = ensureVoterId(request, { secure });
    const topicId = String(form.get("topicId") ?? "");
    if (topicId) await board.toggleVote(topicId, voter.id);
    return voter.setCookie
      ? data({ ok: true }, { headers: { "Set-Cookie": voter.setCookie } })
      : data({ ok: true });
  }

  const text = normalizeTopicText(form.get("text"));
  if (!text) {
    return data({ ok: false as const, error: "テーマを入力してください（200文字以内）。" });
  }
  await board.submitTopic(text);
  return data({ ok: true as const, submitted: true });
}

function GdgAccentBar() {
  return (
    <div aria-hidden className="flex h-3 overflow-hidden rounded-full border-2 border-black">
      <div className="flex-1 bg-gdg-blue" />
      <div className="flex-1 bg-gdg-red" />
      <div className="flex-1 bg-gdg-yellow" />
      <div className="flex-1 bg-gdg-green" />
    </div>
  );
}

export default function Board({ loaderData }: Route.ComponentProps) {
  const { slug, state: initialState, myVotes: initialMyVotes } = loaderData;
  const raw = useActionData<typeof action>();
  const formResult = raw as
    | { ok: true; submitted?: boolean }
    | { ok: false; error: string }
    | undefined;
  const navigation = useNavigation();
  const submitting =
    navigation.state === "submitting" && navigation.formData?.get("intent") == null;
  const submitted = formResult?.ok === true && formResult.submitted === true;
  const errorText = formResult && formResult.ok === false ? formResult.error : null;

  const [dialogOpen, setDialogOpen] = useState(false);
  const { state } = useLiveBoard(slug, { ...initialState }, { enabled: dialogOpen });
  const liveState = dialogOpen ? state : initialState;

  return (
    <main className="grid min-h-dvh place-items-center p-6">
      <div className="w-full max-w-xl space-y-6">
        <div className="relative space-y-6 rounded-[2rem] border-2 border-black bg-white p-8 sm:p-10">
          <GdgAccentBar />
          <AnimatePresence mode="wait" initial={false}>
            {submitted ? (
              <motion.div
                key="done"
                initial={{ opacity: 0, scale: 0.96, y: 8 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={transitions.spring}
                className="relative space-y-6 text-center"
              >
                <ConfettiBurst />
                <motion.h1
                  initial={{ scale: 0.7, rotate: -6 }}
                  animate={{ scale: 1, rotate: 0 }}
                  transition={{ type: "spring", stiffness: 420, damping: 13 }}
                  className="text-2xl font-bold sm:text-3xl"
                >
                  送信しました 🎉
                </motion.h1>
                <p className="text-lg text-neutral-700">
                  スクリーンにテーマが表示されます。ありがとうございます！
                </p>
                <motion.a
                  {...tap}
                  href={`/${slug}`}
                  className="inline-block rounded-full border-2 border-black bg-white px-8 py-3 text-lg font-bold transition hover:bg-neutral-100"
                >
                  もう一つ投稿する
                </motion.a>
              </motion.div>
            ) : (
              <motion.div key="form" exit={{ opacity: 0, y: -8 }} transition={transitions.fade}>
                <Form method="post" className="space-y-6">
                  <div className="space-y-2">
                    <h1 className="text-2xl font-bold sm:text-3xl">話したいテーマは？</h1>
                    <p className="text-base text-neutral-600">
                      Open Space Technology のセッションで扱いたいテーマを教えてください。
                    </p>
                  </div>
                  <textarea
                    name="text"
                    required
                    rows={3}
                    maxLength={200}
                    // biome-ignore lint/a11y/noAutofocus: single-field kiosk form; focus is the expected action
                    autoFocus
                    placeholder="例: Cloudflare Workers でリアルタイム機能をどう作る？"
                    className="w-full resize-none rounded-2xl border-2 border-black bg-white p-4 text-lg outline-none focus:ring-4 focus:ring-gdg-blue/40"
                  />
                  <AnimatePresence>
                    {errorText ? (
                      <motion.p
                        role="alert"
                        initial={{ opacity: 0, y: -4 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0 }}
                        transition={transitions.fade}
                        className="text-base font-medium text-gdg-red"
                      >
                        {errorText}
                      </motion.p>
                    ) : null}
                  </AnimatePresence>
                  <motion.button
                    {...tap}
                    type="submit"
                    disabled={submitting}
                    className="w-full rounded-full border-2 border-black bg-gdg-blue px-8 py-3 text-lg font-bold text-white transition hover:brightness-95 disabled:opacity-60"
                  >
                    {submitting ? "送信中…" : "送信する"}
                  </motion.button>
                </Form>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <div className="text-center">
          <motion.button
            {...tap}
            type="button"
            onClick={() => setDialogOpen(true)}
            className="rounded-full border-2 border-black bg-white px-8 py-3 text-lg font-bold transition hover:bg-neutral-100"
          >
            投票する
          </motion.button>
        </div>
      </div>

      <VoteDialog
        slug={slug}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        topics={liveState.topics}
        voteCounts={liveState.voteCounts}
        initialMyVotes={initialMyVotes}
      />
    </main>
  );
}

function VoteDialog({
  slug,
  open,
  onOpenChange,
  topics,
  voteCounts,
  initialMyVotes,
}: {
  slug: string;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  topics: { id: string; text: string }[];
  voteCounts: Record<string, number>;
  initialMyVotes: string[];
}) {
  const fetcher = useFetcher();
  const [myVotes, setMyVotes] = useState<Set<string>>(() => new Set(initialMyVotes));

  useEffect(() => {
    if (open) setMyVotes(new Set(initialMyVotes));
  }, [open, initialMyVotes]);

  const sorted = useMemo(
    () => [...topics].sort((a, b) => (voteCounts[b.id] ?? 0) - (voteCounts[a.id] ?? 0)),
    [topics, voteCounts],
  );

  function toggle(topicId: string) {
    setMyVotes((prev) => {
      const next = new Set(prev);
      if (next.has(topicId)) next.delete(topicId);
      else next.add(topicId);
      return next;
    });
    fetcher.submit({ intent: "vote", topicId }, { method: "post", action: `/${slug}` });
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <AnimatePresence>
        {open ? (
          <Dialog.Portal forceMount>
            <Dialog.Overlay asChild forceMount>
              <motion.div
                className="fixed inset-0 bg-black/60"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={transitions.fade}
              />
            </Dialog.Overlay>
            <Dialog.Content asChild forceMount>
              <motion.div
                className="fixed left-1/2 top-1/2 flex max-h-[85dvh] w-[92vw] max-w-lg flex-col rounded-[1.5rem] border-2 border-black bg-white p-6 shadow-xl"
                initial={{ opacity: 0, scale: 0.96, x: "-50%", y: "-50%" }}
                animate={{ opacity: 1, scale: 1, x: "-50%", y: "-50%" }}
                exit={{ opacity: 0, scale: 0.96, x: "-50%", y: "-50%" }}
                transition={transitions.spring}
              >
                <div className="flex items-center justify-between">
                  <Dialog.Title className="text-xl font-bold">テーマに投票</Dialog.Title>
                  <Dialog.Close
                    aria-label="閉じる"
                    className="grid size-9 place-items-center rounded-full border-2 border-black text-xl leading-none hover:bg-neutral-100"
                  >
                    ×
                  </Dialog.Close>
                </div>
                <Dialog.Description className="mt-1 text-sm text-neutral-600">
                  気になるテーマに 👍 を付けましょう（テーマごとに1回、取り消しも可）。
                </Dialog.Description>

                <ul className="mt-4 space-y-2 overflow-y-auto">
                  {sorted.length === 0 ? (
                    <li className="py-6 text-center text-neutral-500">まだテーマがありません。</li>
                  ) : (
                    <AnimatePresence initial={false}>
                      {sorted.map((t) => {
                        const voted = myVotes.has(t.id);
                        return (
                          <motion.li
                            key={t.id}
                            layout="position"
                            variants={listItem}
                            initial="initial"
                            animate="animate"
                            exit="exit"
                            transition={transitions.springSoft}
                            className="flex items-center gap-3 rounded-xl border-2 border-black p-3"
                          >
                            <span className="flex-1 break-words">{t.text}</span>
                            <span className="tabular-nums text-sm text-neutral-500">
                              <AnimatedCount value={voteCounts[t.id] ?? 0} />
                            </span>
                            <motion.button
                              type="button"
                              onClick={() => toggle(t.id)}
                              aria-pressed={voted}
                              whileTap={{ scale: 0.85 }}
                              transition={transitions.spring}
                              className={`rounded-full border-2 border-black px-4 py-1.5 font-bold transition ${
                                voted ? "bg-gdg-green text-white" : "bg-white hover:bg-neutral-100"
                              }`}
                            >
                              👍
                            </motion.button>
                          </motion.li>
                        );
                      })}
                    </AnimatePresence>
                  )}
                </ul>
              </motion.div>
            </Dialog.Content>
          </Dialog.Portal>
        ) : null}
      </AnimatePresence>
    </Dialog.Root>
  );
}
