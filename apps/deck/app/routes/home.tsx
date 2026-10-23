import { Button, IconButton, Icons } from "@gdgjp/design-system";
import { useEffect } from "react";
import { Link, useRevalidator } from "react-router";
import { requireUserWithChapter } from "~/features/auth/auth-redirect.server";
import { CreateDeckDialog } from "~/features/deck/components/DeckDialogs";
import { listDecks } from "~/features/deck/decks.server";
import type { DeckSummary } from "~/features/room/protocol";
import { TopBar } from "~/layouts/TopBar";
import type { Route } from "./+types/home";

export function meta() {
  return [{ title: "deck.gdgs.jp" }];
}

const OFFLINE: DeckSummary = {
  dockOnline: false,
  obsConnected: false,
  streaming: false,
  recording: false,
};

export async function loader({ request, context }: Route.LoaderArgs) {
  const env = context.cloudflare.env;
  const { user, chapters } = await requireUserWithChapter(env, request);
  const decks = await listDecks(
    env.DB,
    chapters.map((c) => c.chapterId),
  );
  const summaries = await Promise.all(
    decks.map((d) =>
      env.DECK.getByName(d.id)
        .summary()
        .catch(() => OFFLINE),
    ),
  );
  return {
    user: { name: user.name, email: user.email, image: user.image },
    accountsUrl: env.ACCOUNTS_URL,
    chapters: chapters.map((c) => ({ chapterId: c.chapterId, chapterSlug: c.chapterSlug })),
    decks: decks.map((d, i) => ({
      id: d.id,
      name: d.name,
      chapterId: d.chapterId,
      summary: summaries[i] ?? OFFLINE,
    })),
  };
}

const POLL_MS = 5000;

function StatusChip({ summary }: { summary: DeckSummary }) {
  if (!summary.dockOnline) return <span className="dk-chip">ドック未接続</span>;
  if (!summary.obsConnected)
    return (
      <span className="dk-chip" data-tone="warn">
        OBS 未接続
      </span>
    );
  return (
    <span className="dk-chip-group">
      {summary.streaming && (
        <span className="dk-chip" data-tone="live">
          配信中
        </span>
      )}
      {summary.recording && (
        <span className="dk-chip" data-tone="live">
          録画中
        </span>
      )}
      {!summary.streaming && !summary.recording && (
        <span className="dk-chip" data-tone="ok">
          接続中
        </span>
      )}
    </span>
  );
}

export default function Home({ loaderData }: Route.ComponentProps) {
  const { decks, chapters, user, accountsUrl } = loaderData;
  const revalidator = useRevalidator();
  const multiChapter = chapters.length > 1;

  // Live dock / OBS status while the list is on screen.
  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState === "visible" && revalidator.state === "idle") {
        void revalidator.revalidate();
      }
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [revalidator]);

  return (
    <div className="dk-page">
      <TopBar user={user} accountsUrl={accountsUrl} />
      <main className="dk-home">
        <div className="dk-home-head">
          <h1 className="dk-home-title">デッキ</h1>
          <CreateDeckDialog
            chapters={chapters}
            trigger={
              <IconButton aria-label="デッキを作成" variant="primary">
                <Icons name="Plus" size={20} aria-hidden="true" animateOnHover={false} />
              </IconButton>
            }
          />
        </div>
        {decks.length > 0 ? (
          <ul className="dk-deck-list">
            {decks.map((d) => (
              <li key={d.id} className="dk-deck-row">
                <Link to={`/d/${d.id}`} className="dk-deck-link">
                  <span className="dk-deck-name">
                    <strong>{d.name}</strong>
                    {multiChapter && (
                      <span className="dk-muted">
                        {chapters.find((c) => c.chapterId === d.chapterId)?.chapterSlug}
                      </span>
                    )}
                  </span>
                  <StatusChip summary={d.summary} />
                </Link>
                <Button asChild variant="ghost" size="sm">
                  <Link to={`/decks/${d.id}/edit`}>編集</Link>
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          <div className="dk-empty">
            <p className="dk-muted">まだデッキがありません。</p>
            <CreateDeckDialog chapters={chapters} trigger={<Button>デッキを作成</Button>} />
          </div>
        )}
      </main>
    </div>
  );
}
