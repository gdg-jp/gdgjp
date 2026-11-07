import { Card, EmptyState, PageHeader, Stack } from "@gdgjp/design-system";
import { useEffect } from "react";
import { Link, useRevalidator } from "react-router";
import { requireUserWithChapter } from "~/features/auth/access.server";
import { NoticeList } from "~/features/notifications/components/NoticeList";
import { chapterNotices } from "~/features/notifications/notifications.server";
import { AppLayout } from "~/layouts/AppLayout";
import type { Route } from "./+types/list";

export function meta() {
  return [{ title: "通知 — GDG PR" }];
}

/** Home: what waits on people across the chapter's events, with one button per line. */
export async function loader({ request, context }: Route.LoaderArgs) {
  const env = context.cloudflare.env;
  const { user, chapter, chapters } = await requireUserWithChapter(env, request);
  const notices = await chapterNotices(env, {
    userId: user.id,
    chapterId: chapter.chapterId,
    chapterIds: chapters.map((c) => c.chapterId),
    organizer: chapter.role === "organizer" || user.isAdmin,
  });
  return { notices };
}

export default function Notifications({ loaderData }: Route.ComponentProps) {
  const { notices } = loaderData;
  const revalidator = useRevalidator();
  const running = notices.some((n) => n.group === "running");
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => revalidator.revalidate(), 15_000);
    return () => clearInterval(timer);
  }, [running, revalidator]);
  return (
    <AppLayout>
      <Stack className="[word-break:auto-phrase]">
        <PageHeader title="通知" description="返事待ちのものと、秘書からの連絡です。" />
        {notices.length === 0 ? (
          <Card>
            <EmptyState
              title="いまやることはありません"
              description="イベントを作って、秘書にイベントページや資料を渡すと、ここに次の一手が出ます。"
              action={
                <Link to="/events" className="text-link">
                  イベントを開く
                </Link>
              }
            />
          </Card>
        ) : (
          <NoticeList notices={notices} />
        )}
      </Stack>
    </AppLayout>
  );
}
