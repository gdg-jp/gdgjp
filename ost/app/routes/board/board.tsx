import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import { Form, data, useNavigation } from "react-router";
import { GdgAccentBar } from "~/components/gdg-accent-bar";
import { ConfettiBurst } from "~/components/motion";
import { tap, transitions } from "~/components/motion-presets";
import { VoteDialog } from "~/features/board/components/VoteDialog";
import { participate } from "~/features/board/participation.server";
import { useLiveBoard } from "~/features/board/use-live-board";
import { ensureVoterId } from "~/features/board/voter-cookie.server";
import { getEventBySlug } from "~/features/events/events.server";
import { normalizeSlug } from "~/features/events/slug";
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
  return participate(context.cloudflare.env, request, params.slug);
}

export default function ParticipantBoard({ loaderData, actionData }: Route.ComponentProps) {
  const { slug, state: initialState, myVotes: initialMyVotes } = loaderData;
  const formResult = actionData;
  const navigation = useNavigation();
  const submitting =
    navigation.state === "submitting" && navigation.formData?.get("intent") == null;
  const submitted =
    formResult?.ok === true && "submitted" in formResult && formResult.submitted === true;
  const errorText =
    formResult && formResult.ok === false && "error" in formResult ? formResult.error : null;

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
