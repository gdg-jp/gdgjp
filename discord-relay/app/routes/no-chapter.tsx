import { motion } from "motion/react";
import { redirect } from "react-router";
import { requireChapterAccess } from "~/lib/access.server";
import { getAuth } from "~/lib/auth.server";
import type { Route } from "./+types/no-chapter";

export function meta() {
  return [{ title: "チャプター未所属 — Discord Relay" }];
}

export async function loader(args: Route.LoaderArgs) {
  const env = args.context.cloudflare.env;
  const user = await getAuth(env).getSessionUser(args.request);
  if (!user) throw redirect("/signin?return_to=%2Fno-chapter");
  try {
    const access = await requireChapterAccess(env, args.request);
    if (access.chapter) throw redirect("/");
  } catch (err) {
    if (err instanceof Response && err.status === 302) {
      const location = err.headers.get("Location");
      if (location && !location.includes("/no-chapter")) {
        throw err;
      }
    }
  }
  return { accountsUrl: env.ACCOUNTS_URL };
}

export default function NoChapter({ loaderData }: Route.ComponentProps) {
  return (
    <main className="grid min-h-dvh place-items-center p-6">
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ type: "spring", stiffness: 300, damping: 25 }}
        className="w-full max-w-md space-y-6 rounded-[2rem] border-2 border-black bg-white p-8 text-center sm:p-10"
      >
        <h1 className="text-2xl font-bold sm:text-3xl">GDG チャプターへの参加が必要です</h1>
        <p className="text-base text-neutral-600">
          Discord Relay の管理画面は GDG / GDG on Campus チャプターのメンバーが利用できます。
          チャプターに参加してからもう一度お試しください。
        </p>
        <motion.a
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          href={`${loaderData.accountsUrl}/onboarding`}
          className="inline-block rounded-full border-2 border-black bg-gdg-blue px-8 py-3 text-lg font-bold text-white transition hover:brightness-95"
        >
          チャプターに参加する
        </motion.a>
      </motion.div>
    </main>
  );
}
