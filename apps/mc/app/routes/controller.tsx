import { Button, Icons, Tabs, TabsContent, TabsList, TabsTrigger } from "@gdgjp/design-system";
import { useLayoutEffect, useRef, useState } from "react";
import { requireUserWithChapter } from "~/features/auth/auth-redirect.server";
import { tracks } from "~/features/clips/catalog";
import { CatalogProvider, useCatalog } from "~/features/clips/catalog-context";
import { listUploaded } from "~/features/clips/uploads.server";
import { ClipCard } from "~/features/playback/components/ClipCard";
import { ClipEditorProvider, useOpenEditor } from "~/features/playback/components/ClipEditor";
import { CommonShelf } from "~/features/playback/components/CommonShelf";
import { DiagnosticsSheet } from "~/features/playback/components/DiagnosticsSheet";
import { NowPlayingBar } from "~/features/playback/components/NowPlayingBar";
import { IssueStrip, StatusCluster } from "~/features/playback/components/StatusCluster";
import { ConfirmProvider, useConfirm } from "~/features/playback/components/confirm";
import { ControllerProvider } from "~/features/playback/components/controller-context";
import type { Route } from "./+types/controller";

export function meta() {
  return [{ title: "mc" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const env = context.cloudflare.env;
  await requireUserWithChapter(env, request);
  return { uploaded: await listUploaded(env.DB) };
}

const TAB_KEY = "mc-tab";

export default function Controller({ loaderData }: Route.ComponentProps) {
  return (
    <CatalogProvider initial={loaderData.uploaded}>
      <ConfirmProvider>
        <TrackChannels />
      </ConfirmProvider>
    </CatalogProvider>
  );
}

function TrackChannels() {
  const confirm = useConfirm();
  const [tab, setTab] = useState(tracks[0] ?? "");
  const scroll = useRef<Record<string, number>>({});

  useLayoutEffect(() => {
    try {
      const saved = sessionStorage.getItem(TAB_KEY);
      if (saved && tracks.includes(saved)) setTab(saved);
    } catch {}
  }, []);

  useLayoutEffect(() => {
    window.scrollTo({ top: scroll.current[tab] ?? 0, behavior: "instant" });
  }, [tab]);

  const changeTab = async (next: string) => {
    if (next === tab) return;
    const ok = await confirm({
      title: `トラック ${next} に切り替えますか？`,
      action: "切り替える",
    });
    if (!ok) return;
    scroll.current[tab] = window.scrollY;
    setTab(next);
    try {
      sessionStorage.setItem(TAB_KEY, next);
    } catch {}
  };

  return (
    <Tabs value={tab} onValueChange={changeTab} activationMode="manual" className="mc-app">
      <ControllerProvider key={tab} track={tab}>
        <ClipEditorProvider>
          <ControllerScreen />
        </ClipEditorProvider>
      </ControllerProvider>
    </Tabs>
  );
}
function ControllerScreen() {
  const [diagOpen, setDiagOpen] = useState(false);
  const { catalog } = useCatalog();
  const openEditor = useOpenEditor();
  return (
    <>
      <header className="mc-header">
        <div className="mc-header-row">
          <TabsList className="mc-tabs" aria-label="トラック">
            {tracks.map((t) => (
              <TabsTrigger key={t} value={t} className="mc-tab">
                {t}
              </TabsTrigger>
            ))}
          </TabsList>
          <StatusCluster onOpenDiagnostics={() => setDiagOpen(true)} />
        </div>
        <IssueStrip />
        <CommonShelf />
      </header>
      <main className="mc-main">
        {tracks.map((t) => (
          <TabsContent key={t} value={t} className="mc-list">
            {catalog.byTrack[t]?.map((clip) => (
              <ClipCard key={clip.id} clip={clip} />
            ))}
            <Button
              variant="outline"
              className="mc-add"
              aria-label="音声を追加"
              onClick={() => openEditor({ kind: "new", track: t })}
            >
              <Icons name="Plus" size={18} aria-hidden="true" />
            </Button>
          </TabsContent>
        ))}
      </main>
      <NowPlayingBar />
      <DiagnosticsSheet open={diagOpen} onOpenChange={setDiagOpen} />
    </>
  );
}
