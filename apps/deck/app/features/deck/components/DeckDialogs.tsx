import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
  FormField,
  Input,
  toast,
} from "@gdgjp/design-system";
import { type ReactNode, useEffect, useState } from "react";
import { useFetcher } from "react-router";
import { Choice } from "~/components/Choice";

export type ChapterOption = { chapterId: number; chapterSlug: string };

function ChapterSelect({
  chapters,
  defaultValue,
}: { chapters: ChapterOption[]; defaultValue?: number }) {
  if (chapters.length === 1) {
    return <input type="hidden" name="chapterId" value={chapters[0]?.chapterId} />;
  }
  return (
    <FormField label="チャプター">
      <Choice
        name="chapterId"
        defaultValue={String(defaultValue ?? chapters[0]?.chapterId)}
        options={chapters.map((c) => ({ value: String(c.chapterId), label: c.chapterSlug }))}
      />
    </FormField>
  );
}

export function CreateDeckDialog({
  chapters,
  trigger,
}: { chapters: ChapterOption[]; trigger: ReactNode }) {
  const fetcher = useFetcher();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>{trigger}</DialogTrigger>
        <DialogContent className="dk-dialog">
          <DialogTitle>デッキを作成</DialogTitle>
          <DialogDescription>OBS 1 台につき 1 つ作ります。</DialogDescription>
          <fetcher.Form method="post" action="/api/decks" className="dk-form">
            <input type="hidden" name="intent" value="create" />
            <FormField label="名前" required>
              <Input name="name" required maxLength={60} placeholder="トラック A" autoFocus />
            </FormField>
            <ChapterSelect chapters={chapters} />
            <div className="dk-form-row">
              <FormField label="列">
                <Input name="cols" type="number" min={1} max={12} defaultValue={5} />
              </FormField>
              <FormField label="行">
                <Input name="rows" type="number" min={1} max={12} defaultValue={3} />
              </FormField>
            </div>
            <div className="dk-dialog-actions">
              <Button type="submit" loading={fetcher.state !== "idle"}>
                作成
              </Button>
            </div>
          </fetcher.Form>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function DuplicateDeckDialog({
  deckId,
  deckName,
  chapterId,
  chapters,
  open,
  onOpenChange,
}: {
  deckId: string;
  deckName: string;
  chapterId: number;
  chapters: ChapterOption[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const fetcher = useFetcher();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="dk-dialog">
        <DialogTitle>デッキを複製</DialogTitle>
        <DialogDescription>
          キーと画像をすべてコピーします。複製したデッキは元のデッキと連動しません。ドックの URL
          は新しく発行されます。
        </DialogDescription>
        <fetcher.Form method="post" action="/api/decks" className="dk-form">
          <input type="hidden" name="intent" value="duplicate" />
          <input type="hidden" name="deckId" value={deckId} />
          <FormField label="名前" required>
            <Input name="name" required maxLength={60} defaultValue={`${deckName} のコピー`} />
          </FormField>
          <ChapterSelect chapters={chapters} defaultValue={chapterId} />
          <div className="dk-dialog-actions">
            <Button type="submit" loading={fetcher.state !== "idle"}>
              複製
            </Button>
          </div>
        </fetcher.Form>
      </DialogContent>
    </Dialog>
  );
}

export function RenameDeckDialog({
  deckId,
  deckName,
  open,
  onOpenChange,
}: {
  deckId: string;
  deckName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const fetcher = useFetcher<{ ok: boolean }>();
  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.ok) onOpenChange(false);
  }, [fetcher.state, fetcher.data, onOpenChange]);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="dk-dialog">
        <DialogTitle>名前を変更</DialogTitle>
        <fetcher.Form method="post" action="/api/decks" className="dk-form">
          <input type="hidden" name="intent" value="rename" />
          <input type="hidden" name="deckId" value={deckId} />
          <FormField label="名前" required>
            <Input name="name" required maxLength={60} defaultValue={deckName} autoFocus />
          </FormField>
          <div className="dk-dialog-actions">
            <Button type="submit" loading={fetcher.state !== "idle"}>
              保存
            </Button>
          </div>
        </fetcher.Form>
      </DialogContent>
    </Dialog>
  );
}

export function dockUrl(deckId: string, token: string): string {
  return `${window.location.origin}/dock/${deckId}?t=${encodeURIComponent(token)}`;
}

export function DockUrlDialog({
  deckId,
  token,
  open,
  onOpenChange,
}: {
  deckId: string;
  token: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const fetcher = useFetcher();
  const [confirm, setConfirm] = useState(false);
  const url = open ? dockUrl(deckId, token) : "";
  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="dk-dialog dk-dialog-wide">
          <DialogTitle>OBS のドック</DialogTitle>
          <DialogDescription>
            OBS のメニュー「ドック」→「カスタムブラウザドック」に、この URL
            を貼り付けます。ドックを開いて obs-websocket のパスワードを入れると、このデッキから OBS
            を操作できます。
          </DialogDescription>
          <div className="dk-copy-row">
            <Input
              readOnly
              value={url}
              aria-label="ドックの URL"
              onFocus={(e) => e.currentTarget.select()}
            />
            <Button
              variant="secondary"
              onClick={() => {
                void navigator.clipboard.writeText(url).then(() => toast.success("コピーしました"));
              }}
            >
              コピー
            </Button>
          </div>
          <p className="dk-help">
            obs-websocket は OBS の「ツール」→「WebSocket サーバー設定」で有効にします。
          </p>
          <div className="dk-dialog-actions dk-dialog-actions-split">
            <Button variant="ghost" onClick={() => setConfirm(true)}>
              URL を再発行
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      <AlertDialog open={confirm} onOpenChange={setConfirm}>
        <AlertDialogContent>
          <AlertDialogTitle>ドックの URL を再発行しますか？</AlertDialogTitle>
          <AlertDialogDescription>
            今の URL
            はすぐに使えなくなり、繋がっているドックは切断されます。本番中は再発行しないでください。
          </AlertDialogDescription>
          <div className="dk-dialog-actions">
            <AlertDialogCancel asChild>
              <Button variant="ghost">やめる</Button>
            </AlertDialogCancel>
            <AlertDialogAction asChild>
              <Button
                variant="danger"
                onClick={() =>
                  fetcher.submit(
                    { intent: "rotate-dock", deckId },
                    { method: "post", action: "/api/decks" },
                  )
                }
              >
                再発行
              </Button>
            </AlertDialogAction>
          </div>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

export function DeleteDeckDialog({
  deckId,
  deckName,
  open,
  onOpenChange,
}: {
  deckId: string;
  deckName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const fetcher = useFetcher();
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogTitle>「{deckName}」を削除しますか？</AlertDialogTitle>
        <AlertDialogDescription>
          キー、画像、操作ログがすべて消えます。元に戻せません。
        </AlertDialogDescription>
        <div className="dk-dialog-actions">
          <AlertDialogCancel asChild>
            <Button variant="ghost">やめる</Button>
          </AlertDialogCancel>
          <AlertDialogAction asChild>
            <Button
              variant="danger"
              onClick={() =>
                fetcher.submit(
                  { intent: "delete", deckId },
                  { method: "post", action: "/api/decks" },
                )
              }
            >
              削除
            </Button>
          </AlertDialogAction>
        </div>
      </AlertDialogContent>
    </AlertDialog>
  );
}
