import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
  AlertDialogTrigger,
  Button,
  Icons,
  Inline,
  Stack,
} from "@gdgjp/design-system";
import { Form, Link as RouterLink, useSubmit } from "react-router";

export type MeetingDetailActionsProps = {
  meetingId: string;
  meetingTitle: string;
  canMutateGoogle: boolean;
  isResyncing: boolean;
  isCanceling: boolean;
};

export function MeetingDetailActions({
  meetingId,
  meetingTitle,
  canMutateGoogle,
  isResyncing,
  isCanceling,
}: MeetingDetailActionsProps) {
  const submit = useSubmit();

  return (
    <Inline>
      <Button variant="outline" asChild>
        <RouterLink to={`/meetings/${meetingId}/edit`}>
          <Icons name="Pencil" size={16} aria-hidden="true" />
          編集
        </RouterLink>
      </Button>

      <Form method="post">
        <input type="hidden" name="intent" value="resync" />
        <Button
          type="submit"
          variant="outline"
          disabled={!canMutateGoogle || isCanceling}
          loading={isResyncing}
        >
          <Icons name="RefreshCw" size={16} aria-hidden="true" />
          チャプターから再同期
        </Button>
      </Form>

      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button variant="danger" disabled={!canMutateGoogle || isResyncing} loading={isCanceling}>
            <Icons name="Trash2" size={16} aria-hidden="true" />
            会議を取り消す
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <Stack>
            <AlertDialogTitle>会議を取り消しますか？</AlertDialogTitle>
            <AlertDialogDescription>
              「{meetingTitle}」の Google
              カレンダー予定を削除し、招待者全員へキャンセル通知メールを送信します。Meet
              スペースの登録メンバーは削除され、アクセス設定も「制限付き」へ戻ります。進行中の会議がある場合は終了されます（既に共有済みの
              Drive ファイル閲覧権限は維持されます）。この操作は元に戻せません。
            </AlertDialogDescription>
            <Inline className="justify-end">
              <AlertDialogCancel asChild>
                <Button variant="outline" disabled={isCanceling}>
                  戻る
                </Button>
              </AlertDialogCancel>
              <AlertDialogAction asChild>
                <Button
                  variant="danger"
                  disabled={isCanceling}
                  onClick={() => submit({ intent: "cancel" }, { method: "post" })}
                >
                  会議を取り消す
                </Button>
              </AlertDialogAction>
            </Inline>
          </Stack>
        </AlertDialogContent>
      </AlertDialog>
    </Inline>
  );
}
