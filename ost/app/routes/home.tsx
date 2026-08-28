import { Form, useActionData, useNavigation } from "react-router";
import { normalizeTopicText } from "~/lib/topics";
import type { Route } from "./+types/home";

export function meta(_: Route.MetaArgs) {
  return [
    { title: "OST テーマ投稿" },
    {
      name: "description",
      content: "Open Space Technology で話したいテーマを投稿します。",
    },
  ];
}

export async function action({ request, context }: Route.ActionArgs) {
  const formData = await request.formData();
  const text = normalizeTopicText(formData.get("text"));
  if (!text) {
    return {
      ok: false as const,
      error: "テーマを入力してください（200文字以内）。",
    };
  }
  await context.cloudflare.env.OST_BOARD.getByName("default").submitTopic(text);
  return { ok: true as const };
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

export default function Home() {
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const submitting = navigation.state === "submitting";

  return (
    <main className="grid min-h-dvh place-items-center p-6">
      <div className="w-full max-w-xl space-y-6 rounded-[2rem] border-2 border-black bg-white p-8 sm:p-10">
        <GdgAccentBar />

        {actionData?.ok ? (
          <div className="space-y-6 text-center">
            <h1 className="text-2xl font-bold sm:text-3xl">送信しました 🎉</h1>
            <p className="text-lg text-neutral-700">
              スクリーンにテーマが表示されます。ありがとうございます！
            </p>
            <a
              href="/"
              className="inline-block rounded-full border-2 border-black bg-white px-8 py-3 text-lg font-bold transition hover:bg-neutral-100"
            >
              もう一つ投稿する
            </a>
          </div>
        ) : (
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

            {actionData?.error ? (
              <p role="alert" className="text-base font-medium text-gdg-red">
                {actionData.error}
              </p>
            ) : null}

            <button
              type="submit"
              disabled={submitting}
              className="w-full rounded-full border-2 border-black bg-gdg-blue px-8 py-3 text-lg font-bold text-white transition hover:brightness-95 disabled:opacity-60"
            >
              {submitting ? "送信中…" : "送信する"}
            </button>
          </Form>
        )}
      </div>
    </main>
  );
}
