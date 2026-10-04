import { requireMember } from "~/features/auth/session.server";
import { sendClaimReviewEmail } from "~/features/claims/email.server";
import {
  CATEGORY_SUGGESTIONS,
  formatYen,
  parseYenInput,
  todayJstDate,
} from "~/features/claims/money";
import {
  decryptClaimBank,
  deleteClaimItem,
  getClaim,
  getClaimItem,
  insertClaimItem,
  listClaimItems,
  markClaimEmailSent,
  markClaimSynced,
  recalculateClaimTotal,
  updateClaimItem,
  updateItemDriveFileId,
} from "~/features/claims/repository.server";
import { canProxyForEvent, canViewAllClaims } from "~/features/events/permissions";
import { getEvent } from "~/features/events/repository.server";
import {
  GoogleFolderNotConfiguredError,
  GoogleNotConnectedError,
} from "~/features/google/oauth.server";
import { syncClaimToGoogle } from "~/features/google/sheets.server";
import { extractReceiptFields } from "~/features/receipts/extraction.server";
import {
  MAX_RECEIPT_BYTES,
  isAllowedReceiptType,
  receiptObjectKey,
  sanitizeFilename,
} from "~/features/receipts/receipts";
import { isClaimId, isEventId } from "~/lib/id";

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

export async function loadClaimDetail(
  env: Env,
  request: Request,
  eventId: string,
  claimId: string,
) {
  const { user, event, claim, canEdit } = await assertClaimAccess(env, request, eventId, claimId);
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

export async function actOnClaimDetail(
  env: Env,
  request: Request,
  eventId: string,
  claimId: string,
) {
  const { event, claim, canEdit } = await assertClaimAccess(env, request, eventId, claimId);
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
    let extractionFailed = false;
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
      extractionFailed = true;
      console.error("Receipt extraction failed", error);
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
    if (extractionFailed) {
      return {
        ok: true,
        message:
          "領収書を追加しましたが、自動読み取りに失敗しました。月日・種別・品目・金額を手入力してください。",
      };
    }
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
      if (
        error instanceof GoogleNotConnectedError ||
        error instanceof GoogleFolderNotConfiguredError
      ) {
        return {
          error: `${error.message}。イベントページの「Google連携」から設定してください。`,
        };
      }
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
