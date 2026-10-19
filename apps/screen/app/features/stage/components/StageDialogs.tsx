import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogTitle,
  AlertDialogTrigger,
  Button,
  Dialog,
  DialogContent,
  DialogTitle,
  DialogTrigger,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  FormField,
  IconButton,
  Input,
  ToggleGroup,
  ToggleGroupItem,
  toast,
} from "@gdgjp/design-system";
import { type ReactNode, useEffect, useState } from "react";
import { Form, useFetcher } from "react-router";
import { Help } from "~/components/Help";
import {
  Brush,
  Camera,
  Copy,
  Dices,
  Ellipsis,
  Link2,
  Mic,
  Monitor,
  Pencil,
  RefreshCw,
  Trash2,
  Tv,
} from "~/components/icons";
import { OUTPUT_KINDS, type OutputKind, slotsOf } from "../protocol";
import { generateStageId } from "../stage-id";
import { copyText, inviteUrl, outputUrl } from "../urls";

export type StageAccess = {
  id: string;
  name: string;
  slotCount: number;
  inviteToken: string;
  outputToken: string;
};

const KIND_ICON: Record<OutputKind, ReactNode> = {
  camera: <Camera size={16} aria-hidden="true" />,
  screen: <Monitor size={16} aria-hidden="true" />,
  mic: <Mic size={16} aria-hidden="true" />,
};

const KIND_LABEL: Record<OutputKind, string> = { camera: "カメラ", screen: "画面", mic: "マイク" };

async function copyWithToast(text: string, what: string) {
  if (await copyText(text)) toast.success(`${what}をコピーしました`);
  else toast.error("コピーできませんでした");
}

export function CreateStageDialog({ trigger }: { trigger: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [id, setId] = useState("");
  const [slots, setSlots] = useState("2");
  useEffect(() => {
    if (open) setId(generateStageId());
  }, [open]);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="sc-dialog" aria-describedby={undefined}>
        <DialogTitle>ステージを作成</DialogTitle>
        <Form method="post" action="/api/stages" className="sc-form">
          <input type="hidden" name="intent" value="create" />
          <input type="hidden" name="id" value={id} />
          <input type="hidden" name="slotCount" value={slots} />
          <FormField label="名前" required>
            <Input name="name" required maxLength={40} placeholder="メインステージ" autoFocus />
          </FormField>
          <FormField label="出力枠">
            <ToggleGroup
              type="single"
              value={slots}
              onValueChange={(v) => v && setSlots(v)}
              aria-label="出力枠の数"
            >
              {["1", "2", "3", "4"].map((n) => (
                <ToggleGroupItem key={n} value={n} aria-label={`${n} 枠`}>
                  {n}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </FormField>
          <div className="sc-id-row">
            <code>{id}</code>
            <IconButton
              aria-label="ID を再生成"
              variant="ghost"
              size="sm"
              onClick={() => setId(generateStageId())}
            >
              <Dices size={16} aria-hidden="true" />
            </IconButton>
          </div>
          <Button type="submit" fullWidth>
            作成
          </Button>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

export function ObsDialog({
  stage,
  open,
  onOpenChange,
}: {
  stage: StageAccess;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const fetcher = useFetcher();
  const [origin, setOrigin] = useState("");
  useEffect(() => setOrigin(window.location.origin), []);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sc-dialog sc-obs" aria-describedby={undefined}>
        <div className="sc-dialog-head">
          <DialogTitle>
            <Tv size={18} aria-hidden="true" /> OBS
          </DialogTitle>
          <Help>
            <ol className="sc-help-steps">
              <li>OBS のソース ＋ →「ブラウザ」</li>
              <li>URL に貼り付け、幅 1920・高さ 1080</li>
              <li>「OBS で音声を制御する」に ✓</li>
              <li>「表示されていないときにソースをシャットダウン」は ✓ を外す</li>
            </ol>
            <p className="sc-muted">マイクは音声だけのソースです。サイズは何でも構いません。</p>
          </Help>
        </div>
        <table className="sc-obs-table">
          <thead>
            <tr>
              <th />
              {OUTPUT_KINDS.map((k) => (
                <th key={k} scope="col">
                  <span className="sc-obs-kind">
                    {KIND_ICON[k]}
                    {KIND_LABEL[k]}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {slotsOf(stage.slotCount).map((slot) => (
              <tr key={slot}>
                <th scope="row">
                  <span className="sc-slot-badge">{slot}</span>
                </th>
                {OUTPUT_KINDS.map((kind) => (
                  <td key={kind}>
                    <IconButton
                      aria-label={`${slot} ${KIND_LABEL[kind]} の URL をコピー`}
                      variant="secondary"
                      size="sm"
                      onClick={() =>
                        copyWithToast(
                          outputUrl(origin, stage.id, slot, kind, stage.outputToken),
                          `${slot} ${KIND_LABEL[kind]}の URL `,
                        )
                      }
                    >
                      <Copy size={16} aria-hidden="true" />
                    </IconButton>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        <p className="sc-warn">⚠ 「OBS で音声を制御する」に ✓ を入れてください</p>
        <div className="sc-obs-foot">
          <span className="sc-size">
            1920 × 1080
            <IconButton
              aria-label="サイズをコピー"
              variant="ghost"
              size="sm"
              onClick={() => copyWithToast("1920x1080", "サイズ")}
            >
              <Copy size={14} aria-hidden="true" />
            </IconButton>
          </span>
          <ConfirmButton
            title="OBS の URL を再発行しますか？"
            body="今の URL はすぐに使えなくなります。本番中は再発行しないでください。"
            confirm="再発行"
            onConfirm={() =>
              fetcher.submit(
                { intent: "rotate-output", stageId: stage.id },
                { method: "post", action: "/api/stages" },
              )
            }
          >
            <Button variant="ghost" size="sm">
              <RefreshCw size={14} aria-hidden="true" /> URL を再発行
            </Button>
          </ConfirmButton>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Wrap a trigger so it asks before acting. */
export function ConfirmButton({
  title,
  body,
  confirm,
  danger = true,
  onConfirm,
  children,
}: {
  title: string;
  body?: string;
  confirm: string;
  danger?: boolean;
  onConfirm: () => void;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>{children}</AlertDialogTrigger>
      <AlertDialogContent className="sc-dialog" aria-describedby={undefined}>
        <AlertDialogTitle>{title}</AlertDialogTitle>
        {body && <p className="sc-muted">{body}</p>}
        <div className="sc-confirm-actions">
          <AlertDialogCancel asChild>
            <Button variant="ghost">キャンセル</Button>
          </AlertDialogCancel>
          <Button
            variant={danger ? "danger" : "primary"}
            onClick={() => {
              setOpen(false);
              onConfirm();
            }}
          >
            {confirm}
          </Button>
        </div>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function RenameDialog({
  stage,
  open,
  onOpenChange,
}: {
  stage: StageAccess;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const fetcher = useFetcher();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sc-dialog" aria-describedby={undefined}>
        <DialogTitle>名前を変更</DialogTitle>
        <fetcher.Form
          method="post"
          action="/api/stages"
          className="sc-form"
          onSubmit={() => onOpenChange(false)}
        >
          <input type="hidden" name="intent" value="rename" />
          <input type="hidden" name="stageId" value={stage.id} />
          <FormField label="名前" required hideLabel>
            <Input name="name" required maxLength={40} defaultValue={stage.name} autoFocus />
          </FormField>
          <Button type="submit" fullWidth>
            保存
          </Button>
        </fetcher.Form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * The [⋯] menu: copy invite link, OBS URLs, rename, (reset), delete.
 * `onReset` is only offered inside the control room.
 */
export function StageMenu({ stage, onReset }: { stage: StageAccess; onReset?: () => void }) {
  const [obs, setObs] = useState(false);
  const [rename, setRename] = useState(false);
  const [confirm, setConfirm] = useState<"delete" | "reset" | "invite" | null>(null);
  const fetcher = useFetcher();
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <IconButton aria-label="メニュー" variant="ghost" size="sm">
            <Ellipsis size={18} aria-hidden="true" />
          </IconButton>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
          <DropdownMenuItem
            onSelect={() =>
              copyWithToast(inviteUrl(window.location.origin, stage.inviteToken), "招待リンク")
            }
          >
            <Link2 size={16} aria-hidden="true" /> 招待リンクをコピー
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setObs(true)}>
            <Tv size={16} aria-hidden="true" /> OBS URL
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setRename(true)}>
            <Pencil size={16} aria-hidden="true" /> 名前を変更
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setConfirm("invite")}>
            <RefreshCw size={16} aria-hidden="true" /> 招待リンクを再発行
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          {onReset && (
            <DropdownMenuItem onSelect={() => setConfirm("reset")}>
              <Brush size={16} aria-hidden="true" /> リセット
            </DropdownMenuItem>
          )}
          <DropdownMenuItem onSelect={() => setConfirm("delete")} className="sc-danger-item">
            <Trash2 size={16} aria-hidden="true" /> 削除
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <ObsDialog stage={stage} open={obs} onOpenChange={setObs} />
      <RenameDialog stage={stage} open={rename} onOpenChange={setRename} />
      <AlertDialog open={confirm !== null} onOpenChange={(o) => !o && setConfirm(null)}>
        <AlertDialogContent className="sc-dialog" aria-describedby={undefined}>
          <AlertDialogTitle>
            {confirm === "delete"
              ? `「${stage.name}」を削除しますか？`
              : confirm === "reset"
                ? "リセットしますか？"
                : "招待リンクを再発行しますか？"}
          </AlertDialogTitle>
          <p className="sc-muted">
            {confirm === "delete"
              ? "OBS の URL と招待リンクも使えなくなります。"
              : confirm === "reset"
                ? "チャット・カンペの履歴、出力枠の割り当て、ON AIR、タイマー、切断中の参加者を消します。"
                : "今のリンクでは新しく参加できなくなります。参加中の登壇者はそのままです。"}
          </p>
          <div className="sc-confirm-actions">
            <AlertDialogCancel asChild>
              <Button variant="ghost">キャンセル</Button>
            </AlertDialogCancel>
            <Button
              variant="danger"
              onClick={() => {
                const which = confirm;
                setConfirm(null);
                if (which === "reset") onReset?.();
                else
                  fetcher.submit(
                    { intent: which === "delete" ? "delete" : "rotate-invite", stageId: stage.id },
                    { method: "post", action: "/api/stages" },
                  );
              }}
            >
              {confirm === "delete" ? "削除" : confirm === "reset" ? "リセット" : "再発行"}
            </Button>
          </div>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
