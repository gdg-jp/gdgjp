import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
  AlertDialogTrigger,
  Badge,
  Button,
  Card,
  Heading,
  Inline,
  Stack,
} from "@gdgjp/design-system";
import { Form, Link as RouterLink } from "react-router";
import type { RosterSheet, SheetVisibility } from "../types";

type Props = {
  sheet: Pick<RosterSheet, "id" | "name" | "date" | "startTime" | "endTime">;
  eventId: string;
  visibility: SheetVisibility;
  isDefault: boolean;
  error?: string;
  visibilityPending: boolean;
  archivePending: boolean;
  reorderSheetIds: string[];
  reorderPending: boolean;
};

export function RosterSheetCard({
  sheet,
  eventId,
  visibility,
  isDefault,
  error,
  visibilityPending,
  archivePending,
  reorderSheetIds,
  reorderPending,
}: Props) {
  const nextVisibility = visibility === "published" ? "private" : "published";
  const visibilityLabel = visibility === "published" ? "公開" : "非公開";
  const sheetIndex = reorderSheetIds.indexOf(sheet.id);
  const hasReorderControls = reorderSheetIds.length > 1 && sheetIndex > 0;

  function moveOrder(direction: -1 | 1) {
    const nextIndex = sheetIndex + direction;
    if (sheetIndex < 1 || nextIndex < 1 || nextIndex >= reorderSheetIds.length) {
      return reorderSheetIds;
    }
    const ids = [...reorderSheetIds];
    [ids[sheetIndex], ids[nextIndex]] = [ids[nextIndex], ids[sheetIndex]];
    return ids;
  }

  function renderMoveButton(direction: -1 | 1) {
    const directionLabel = direction === -1 ? "上" : "下";
    const canMove =
      sheetIndex > 0 &&
      sheetIndex + direction > 0 &&
      sheetIndex + direction < reorderSheetIds.length;
    const orderedIds = moveOrder(direction);

    return (
      <Form key={direction} method="post">
        <input type="hidden" name="intent" value="reorderSheets" />
        {orderedIds.map((id) => (
          <input key={id} type="hidden" name="sheetIds" value={id} />
        ))}
        <Button
          type="submit"
          variant="outline"
          aria-label={`「${sheet.name}」を${directionLabel}へ移動`}
          disabled={!canMove || reorderPending}
          loading={reorderPending}
        >
          {directionLabel}へ
        </Button>
      </Form>
    );
  }

  return (
    <Card className="roster-sheet-card">
      <Stack className="gap-4">
        <span className="sheet-card-index" aria-hidden="true">
          {String(sheetIndex + 1).padStart(2, "0")} / SHIFT BOARD
        </span>
        <Inline className="flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <Heading level={3} className="break-words">
              {sheet.name}
            </Heading>
            <p className="gdg-muted mt-1 text-sm">
              <time dateTime={sheet.date}>{sheet.date}</time>
              <span aria-hidden="true"> · </span>
              <time dateTime={`${sheet.date}T${sheet.startTime}`}>{sheet.startTime}</time>
              <span aria-hidden="true">–</span>
              <time dateTime={`${sheet.date}T${sheet.endTime}`}>{sheet.endTime}</time>
            </p>
          </div>
          <Inline className="flex-wrap gap-2">
            {isDefault && <Badge tone="info">本編</Badge>}
            <Badge tone={visibility === "published" ? "success" : "neutral"}>
              {visibilityLabel}
            </Badge>
          </Inline>
        </Inline>
        {error && (
          <p className="text-sm text-danger" role="alert">
            {error}
          </p>
        )}
        <Inline className="flex-wrap gap-2">
          <Button asChild>
            <RouterLink to={`/e/${eventId}/s/${sheet.id}/roster`}>割当を開く</RouterLink>
          </Button>
          <Button asChild variant="outline">
            <RouterLink to={`/e/${eventId}/s/${sheet.id}/design`}>設計を編集</RouterLink>
          </Button>
          <Form method="post">
            <input type="hidden" name="intent" value="setVisibility" />
            <input type="hidden" name="sheetId" value={sheet.id} />
            <input type="hidden" name="visibility" value={nextVisibility} />
            <Button type="submit" variant="outline" loading={visibilityPending}>
              {visibilityPending
                ? "更新中…"
                : nextVisibility === "published"
                  ? "公開にする"
                  : "非公開にする"}
            </Button>
          </Form>
        </Inline>
        {(hasReorderControls || !isDefault) && (
          <details className="border-t pt-3 text-sm">
            <summary className="cursor-pointer font-medium text-muted">その他の操作</summary>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {hasReorderControls && (
                <>
                  <span className="gdg-muted">並び順</span>
                  {renderMoveButton(-1)}
                  {renderMoveButton(1)}
                </>
              )}
              {!isDefault && (
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button
                      variant="danger"
                      loading={archivePending}
                      aria-label={archivePending ? "アーカイブ中" : "アーカイブ"}
                    >
                      {archivePending ? "アーカイブ中…" : "アーカイブ"}
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogTitle>「{sheet.name}」をアーカイブしますか？</AlertDialogTitle>
                    <AlertDialogDescription>
                      シフト表は一覧から非表示になります。スタッフや履歴のデータは保持されます。
                    </AlertDialogDescription>
                    <Form method="post" className="flex flex-wrap justify-end gap-2">
                      <input type="hidden" name="intent" value="archiveSheet" />
                      <input type="hidden" name="sheetId" value={sheet.id} />
                      <AlertDialogCancel asChild>
                        <Button variant="outline">キャンセル</Button>
                      </AlertDialogCancel>
                      <AlertDialogAction asChild>
                        <Button type="submit" variant="danger" loading={archivePending}>
                          {archivePending ? "アーカイブ中…" : "アーカイブする"}
                        </Button>
                      </AlertDialogAction>
                    </Form>
                  </AlertDialogContent>
                </AlertDialog>
              )}
            </div>
          </details>
        )}
      </Stack>
    </Card>
  );
}
