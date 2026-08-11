import { Form, Link } from "react-router";
import { Header } from "~/components/header";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "~/components/ui/table";
import { canProxyForEvent, canViewAllClaims, requireMember } from "~/lib/auth-redirect.server";
import {
  decryptClaimBank,
  deleteClaimItem,
  getClaim,
  getClaimItem,
  getEvent,
  insertClaimItem,
  listClaimItems,
  markClaimEmailSent,
  markClaimSynced,
  recalculateClaimTotal,
  updateClaimItem,
  updateItemDriveFileId,
} from "~/lib/db.server";
import { sendClaimReviewEmail } from "~/lib/email.server";
import { extractReceiptFields } from "~/lib/gemini.server";
import { isClaimId, isEventId } from "~/lib/id";
import { CATEGORY_SUGGESTIONS, formatYen, parseYenInput, todayJstDate } from "~/lib/money";
import {
  MAX_RECEIPT_BYTES,
  isAllowedReceiptType,
  receiptObjectKey,
  sanitizeFilename,
} from "~/lib/receipts";
import { syncClaimToGoogle } from "~/lib/sheets.server";
import type { Route } from "./+types/events.$id.claims.$claimId";

export function meta({ data }: Route.MetaArgs) {
  return [{ title: data?.claim ? `${data.claim.applicantName} — Pay` : "Claim — Pay" }];
}

async function assertClaimAccess(env: Env, request: Request, eventId: string, claimId: string) {
  if (!isEventId(eventId) || !isClaimId(claimId)) throw new Response("Not Found", { status: 404 });
  const { user, chapters } = await requireMember(env, request);
  const event = await getEvent(env.DB, eventId);
  if (!event) throw new Response("Not Found", { status: 404 });
  const claim = await getClaim(env.DB, claimId);
  if (!claim || claim.event_id !== event.id) throw new Response("Not Found", { status: 404 });
  const actor = { userId: user.id, chapters };
  const canManage = canViewAllClaims(actor, event);
  const isOwner = claim.user_id === user.id || claim.created_by === user.id;
  if (!canManage && !isOwner) throw new Response("Forbidden", { status: 403 });
  const canEdit =
    claim.kind === "self"
      ? claim.user_id === user.id
      : canProxyForEvent(actor, event) || claim.created_by === user.id;
  return { user, chapters, event, claim, canManage, canEdit };
}

export async function loader({ request, context, params }: Route.LoaderArgs) {
  const env = context.cloudflare.env;
  const { user, event, claim, canEdit } = await assertClaimAccess(
    env,
    request,
    params.id,
    params.claimId,
  );
  const items = await listClaimItems(env.DB, claim.id);
  return {
    user,
    event: { id: event.id, title: event.title },
    claim: {
      id: claim.id,
      kind: claim.kind,
      applicantName: claim.applicant_name,
      applicationDate: claim.application_date,
      totalAmount: claim.total_amount,
      status: claim.status,
      sheetUrl: claim.sheet_url,
      emailSentAt: claim.email_sent_at,
    },
    canEdit,
    categories: CATEGORY_SUGGESTIONS,
    items: items.map((item) => ({
      id: item.id,
      spentOn: item.spent_on,
      category: item.category,
      description: item.description,
      amountYen: item.amount_yen,
      receiptFilename: item.receipt_filename,
      receiptKey: item.receipt_r2_key,
      extractionJson: item.extraction_json,
    })),
  };
}

export async function action({ request, context, params }: Route.ActionArgs) {
  const env = context.cloudflare.env;
  const { event, claim, canEdit } = await assertClaimAccess(
    env,
    request,
    params.id,
    params.claimId,
  );
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");

  if (intent === "upload") {
    if (!canEdit) throw new Response("Forbidden", { status: 403 });
    const file = form.get("receipt");
    if (!(file instanceof File) || file.size === 0) {
      return { error: "領収書ファイルを選択してください" };
    }
    if (file.size > MAX_RECEIPT_BYTES) {
      return { error: "ファイルサイズは 10MB 以下にしてください" };
    }
    const contentType = file.type || "application/octet-stream";
    if (!isAllowedReceiptType(contentType)) {
      return { error: "PDF または画像ファイルのみアップロードできます" };
    }
    const filename = sanitizeFilename(file.name);
    const bytes = await file.arrayBuffer();
    let extraction = {
      spentOn: todayJstDate(),
      amountYen: 0,
      category: "その他",
      description: filename,
    };
    let extractionJson: string | null = null;
    try {
      const extracted = await extractReceiptFields(env, {
        bytes,
        mimeType: contentType,
        filename,
      });
      extractionJson = JSON.stringify(extracted);
      extraction = {
        spentOn: extracted.spentOn ?? todayJstDate(),
        amountYen: extracted.amountYen ?? 0,
        category: extracted.category ?? "その他",
        description: extracted.description ?? filename,
      };
    } catch (error) {
      extractionJson = JSON.stringify({
        error: error instanceof Error ? error.message : "extraction failed",
      });
    }
    const key = receiptObjectKey(claim.id, filename);
    await env.RECEIPTS.put(key, bytes, {
      httpMetadata: { contentType },
      customMetadata: { claimId: claim.id, filename },
    });
    const items = await listClaimItems(env.DB, claim.id);
    await insertClaimItem(env.DB, {
      claimId: claim.id,
      spentOn: extraction.spentOn,
      category: extraction.category,
      description: extraction.description,
      amountYen: extraction.amountYen,
      receiptR2Key: key,
      receiptFilename: filename,
      receiptContentType: contentType,
      extractionJson,
      sortOrder: items.length,
    });
    await recalculateClaimTotal(env.DB, claim.id);
    return { ok: true, message: "領収書を追加しました。内容を確認して保存してください。" };
  }

  if (intent === "update-item") {
    if (!canEdit) throw new Response("Forbidden", { status: 403 });
    const itemId = String(form.get("itemId") ?? "");
    const item = await getClaimItem(env.DB, itemId);
    if (!item || item.claim_id !== claim.id) return { error: "明細が見つかりません" };
    const spentOn = String(form.get("spentOn") ?? "").trim();
    const category = String(form.get("category") ?? "").trim();
    const description = String(form.get("description") ?? "").trim();
    const amountYen = parseYenInput(String(form.get("amountYen") ?? ""));
    if (!spentOn || !category || !description || amountYen === null) {
      return { error: "明細の入力内容を確認してください" };
    }
    await updateClaimItem(env.DB, itemId, { spentOn, category, description, amountYen });
    await recalculateClaimTotal(env.DB, claim.id);
    return { ok: true, message: "明細を更新しました" };
  }

  if (intent === "delete-item") {
    if (!canEdit) throw new Response("Forbidden", { status: 403 });
    const itemId = String(form.get("itemId") ?? "");
    const item = await getClaimItem(env.DB, itemId);
    if (!item || item.claim_id !== claim.id) return { error: "明細が見つかりません" };
    if (item.receipt_r2_key) {
      await env.RECEIPTS.delete(item.receipt_r2_key);
    }
    await deleteClaimItem(env.DB, itemId);
    await recalculateClaimTotal(env.DB, claim.id);
    return { ok: true, message: "明細を削除しました" };
  }

  if (intent === "sync-sheets") {
    if (!canEdit) throw new Response("Forbidden", { status: 403 });
    const freshClaim = await getClaim(env.DB, claim.id);
    if (!freshClaim) throw new Response("Not Found", { status: 404 });
    const items = await listClaimItems(env.DB, claim.id);
    if (items.length === 0) return { error: "明細がありません" };
    const bank = await decryptClaimBank(env.TOKEN_ENCRYPTION_KEY, freshClaim);
    try {
      const result = await syncClaimToGoogle({
        env,
        event,
        claim: freshClaim,
        bank,
        items,
        loadReceipt: async (key) => {
          const obj = await env.RECEIPTS.get(key);
          if (!obj) return null;
          return {
            bytes: await obj.arrayBuffer(),
            contentType: obj.httpMetadata?.contentType ?? "application/octet-stream",
          };
        },
      });
      await markClaimSynced(env.DB, claim.id, {
        sheetId: result.sheetId,
        sheetUrl: result.sheetUrl,
        driveFolderId: result.driveFolderId,
      });
      for (const mapped of result.itemDriveFileIds) {
        await updateItemDriveFileId(env.DB, mapped.itemId, mapped.driveFileId);
      }
      await recalculateClaimTotal(env.DB, claim.id);
      return { ok: true, message: "スプレッドシートを同期しました（共有通知なし）" };
    } catch (error) {
      return {
        error: error instanceof Error ? error.message : "Sheets 同期に失敗しました",
      };
    }
  }

  if (intent === "send-email") {
    if (!canEdit) throw new Response("Forbidden", { status: 403 });
    const freshClaim = await getClaim(env.DB, claim.id);
    if (!freshClaim?.sheet_url) {
      return { error: "先にスプレッドシートへ同期してください" };
    }
    try {
      await sendClaimReviewEmail(env, {
        eventTitle: event.title,
        applicantName: freshClaim.applicant_name,
        totalAmountLabel: formatYen(freshClaim.total_amount),
        sheetUrl: freshClaim.sheet_url,
      });
      await markClaimEmailSent(env.DB, claim.id);
      return { ok: true, message: "確認依頼メールを送信しました" };
    } catch (error) {
      return {
        error: error instanceof Error ? error.message : "メール送信に失敗しました",
      };
    }
  }

  return { error: "不明な操作です" };
}

export default function ClaimDetailPage({ loaderData, actionData }: Route.ComponentProps) {
  const { user, event, claim, canEdit, items, categories } = loaderData;
  return (
    <div className="min-h-dvh bg-background">
      <Header user={{ name: user.name, email: user.email, image: user.image }} />
      <main className="mx-auto max-w-3xl space-y-6 px-4 py-10">
        <div>
          <p className="text-sm text-muted-foreground">
            <Link to={`/events/${event.id}`} className="hover:underline">
              {event.title}
            </Link>
          </p>
          <h1 className="mt-1 text-2xl font-semibold">{claim.applicantName}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            申請日 {claim.applicationDate} / {claim.kind === "proxy" ? "代行" : "本人"} /{" "}
            {formatYen(claim.totalAmount)}
          </p>
        </div>

        {actionData && "error" in actionData && actionData.error ? (
          <p className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {actionData.error}
          </p>
        ) : null}
        {actionData && "message" in actionData && actionData.message ? (
          <p className="rounded-lg border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm text-emerald-900 dark:border-emerald-700 dark:bg-emerald-950 dark:text-emerald-100">
            {actionData.message}
          </p>
        ) : null}

        {canEdit ? (
          <Form
            method="post"
            encType="multipart/form-data"
            className="space-y-3 rounded-xl border p-5"
          >
            <input type="hidden" name="intent" value="upload" />
            <div className="space-y-2">
              <Label htmlFor="receipt">領収書 PDF / 写真を追加</Label>
              <Input
                id="receipt"
                name="receipt"
                type="file"
                accept="application/pdf,image/*"
                required
              />
              <p className="text-xs text-muted-foreground">
                アップロード後、Gemini
                が日付・金額・種別を推定します。必ず確認して保存してください。
              </p>
            </div>
            <Button type="submit">アップロードして抽出</Button>
          </Form>
        ) : null}

        <section className="overflow-hidden rounded-xl border">
          <div className="border-b px-4 py-3">
            <h2 className="font-semibold">明細</h2>
          </div>
          {items.length === 0 ? (
            <p className="px-4 py-6 text-sm text-muted-foreground">まだ明細がありません。</p>
          ) : (
            <div className="divide-y">
              {items.map((item) => (
                <div key={item.id} className="space-y-3 p-4">
                  {canEdit ? (
                    <Form method="post" className="grid gap-3 sm:grid-cols-2">
                      <input type="hidden" name="intent" value="update-item" />
                      <input type="hidden" name="itemId" value={item.id} />
                      <div className="space-y-1">
                        <Label>月日</Label>
                        <Input name="spentOn" type="date" defaultValue={item.spentOn} required />
                      </div>
                      <div className="space-y-1">
                        <Label>種別</Label>
                        <Input
                          name="category"
                          list="category-options"
                          defaultValue={item.category}
                          required
                        />
                      </div>
                      <div className="space-y-1 sm:col-span-2">
                        <Label>品目</Label>
                        <Input name="description" defaultValue={item.description} required />
                      </div>
                      <div className="space-y-1">
                        <Label>金額（円）</Label>
                        <Input
                          name="amountYen"
                          inputMode="numeric"
                          defaultValue={String(item.amountYen)}
                          required
                        />
                      </div>
                      <div className="flex items-end gap-2">
                        <Button type="submit" size="sm">
                          保存
                        </Button>
                      </div>
                      {item.receiptFilename ? (
                        <p className="sm:col-span-2 text-xs text-muted-foreground">
                          領収書:{" "}
                          {item.receiptKey ? (
                            <a className="underline" href={`/receipts/${item.receiptKey}`}>
                              {item.receiptFilename}
                            </a>
                          ) : (
                            item.receiptFilename
                          )}
                        </p>
                      ) : null}
                    </Form>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>月日</TableHead>
                          <TableHead>種別</TableHead>
                          <TableHead>品目</TableHead>
                          <TableHead>金額</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        <TableRow>
                          <TableCell>{item.spentOn}</TableCell>
                          <TableCell>{item.category}</TableCell>
                          <TableCell>{item.description}</TableCell>
                          <TableCell>{formatYen(item.amountYen)}</TableCell>
                        </TableRow>
                      </TableBody>
                    </Table>
                  )}
                  {canEdit ? (
                    <Form method="post">
                      <input type="hidden" name="intent" value="delete-item" />
                      <input type="hidden" name="itemId" value={item.id} />
                      <Button type="submit" size="sm" variant="destructive">
                        この明細を削除
                      </Button>
                    </Form>
                  ) : null}
                </div>
              ))}
            </div>
          )}
          <datalist id="category-options">
            {categories.map((category) => (
              <option key={category} value={category} />
            ))}
          </datalist>
        </section>

        {canEdit ? (
          <section className="flex flex-wrap gap-3 rounded-xl border p-5">
            <Form method="post">
              <input type="hidden" name="intent" value="sync-sheets" />
              <Button type="submit">スプレッドシートに反映</Button>
            </Form>
            <Form method="post">
              <input type="hidden" name="intent" value="send-email" />
              <Button type="submit" variant="outline" disabled={!claim.sheetUrl}>
                comm-support に確認メールを送る
              </Button>
            </Form>
            {claim.sheetUrl ? (
              <Button variant="ghost" asChild>
                <a href={claim.sheetUrl} target="_blank" rel="noreferrer">
                  Sheets を開く
                </a>
              </Button>
            ) : null}
            <p className="w-full text-xs text-muted-foreground">
              Sheets/Drive
              共有は通知なしで自動実行されます。メールはボタンを押したときだけ送信されます。
              {claim.emailSentAt
                ? ` 最終送信: ${new Date(claim.emailSentAt * 1000).toLocaleString("ja-JP")}`
                : ""}
            </p>
          </section>
        ) : null}
      </main>
    </div>
  );
}
