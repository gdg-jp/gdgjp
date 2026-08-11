import type { BankAccount, ClaimItemRow, ClaimRow, PayEvent } from "~/lib/db.server";
import { getGoogleAccessToken, googleFetch } from "~/lib/google-auth.server";

const COMM_SUPPORT = "comm-support@voice-research.com";

export type SheetSyncResult = {
  sheetId: string;
  sheetUrl: string;
  driveFolderId: string;
  itemDriveFileIds: Array<{ itemId: string; driveFileId: string }>;
};

export type SheetPayload = {
  applicantName: string;
  eventTitle: string;
  applicationDate: string;
  totalAmount: number;
  bank: BankAccount;
  items: Array<{
    spentOn: string;
    category: string;
    description: string;
    amountYen: number;
    receiptFilename: string;
  }>;
};

export function buildSheetValues(payload: SheetPayload): unknown[][] {
  const rows: unknown[][] = [
    ["申請者氏名", payload.applicantName, "合計", payload.totalAmount],
    ["イベント名", payload.eventTitle],
    ["申請者記入", "", "", payload.applicationDate.replaceAll("-", "/")],
    ["ボイスリサーチ記入", "受理確認", "□", "受理確認日を記入"],
    ["ボイスリサーチ記入", "振込完了", "□", "振込日を記入"],
    [],
    [
      "振込先口座",
      payload.bank.bankName,
      payload.bank.branchName,
      payload.bank.accountType,
      payload.bank.accountNumber,
    ],
    [],
    ["月日", "種別", "品目等の内訳", "金額（円）", "領収書の情報"],
  ];
  for (const item of payload.items) {
    rows.push([
      item.spentOn.replaceAll("-", "/"),
      item.category,
      item.description,
      item.amountYen,
      item.receiptFilename,
    ]);
  }
  return rows;
}

async function shareWithoutNotification(
  accessToken: string,
  fileId: string,
  email: string,
): Promise<void> {
  const res = await googleFetch(
    accessToken,
    `https://www.googleapis.com/drive/v3/files/${fileId}/permissions?sendNotificationEmail=false&supportsAllDrives=true`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "user",
        role: "writer",
        emailAddress: email,
      }),
    },
  );
  if (!res.ok) {
    const body = await res.text();
    // Ignore already-shared conflicts.
    if (!body.includes("alreadyExists")) {
      throw new Error(`Drive share failed ${res.status}: ${body}`);
    }
  }
}

async function ensureFolder(
  accessToken: string,
  name: string,
  existingId: string | null,
): Promise<string> {
  if (existingId) return existingId;
  const res = await googleFetch(accessToken, "https://www.googleapis.com/drive/v3/files", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name,
      mimeType: "application/vnd.google-apps.folder",
    }),
  });
  if (!res.ok) throw new Error(`Drive folder create failed ${res.status}: ${await res.text()}`);
  const json = (await res.json()) as { id: string };
  await shareWithoutNotification(accessToken, json.id, COMM_SUPPORT);
  return json.id;
}

async function copyTemplate(
  accessToken: string,
  templateId: string,
  name: string,
  folderId: string,
  existingSheetId: string | null,
): Promise<{ id: string; url: string }> {
  if (existingSheetId) {
    return {
      id: existingSheetId,
      url: `https://docs.google.com/spreadsheets/d/${existingSheetId}/edit`,
    };
  }
  const res = await googleFetch(
    accessToken,
    `https://www.googleapis.com/drive/v3/files/${templateId}/copy`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        parents: [folderId],
      }),
    },
  );
  if (!res.ok) throw new Error(`Sheets copy failed ${res.status}: ${await res.text()}`);
  const json = (await res.json()) as { id: string };
  await shareWithoutNotification(accessToken, json.id, COMM_SUPPORT);
  return {
    id: json.id,
    url: `https://docs.google.com/spreadsheets/d/${json.id}/edit`,
  };
}

async function clearAndWriteSheet(
  accessToken: string,
  sheetId: string,
  values: unknown[][],
): Promise<void> {
  const clearRes = await googleFetch(
    accessToken,
    `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/A1:E60:clear`,
    { method: "POST" },
  );
  if (!clearRes.ok) {
    throw new Error(`Sheets clear failed ${clearRes.status}: ${await clearRes.text()}`);
  }
  const updateRes = await googleFetch(
    accessToken,
    `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/A1?valueInputOption=USER_ENTERED`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ values }),
    },
  );
  if (!updateRes.ok) {
    throw new Error(`Sheets update failed ${updateRes.status}: ${await updateRes.text()}`);
  }
}

async function uploadReceipt(
  accessToken: string,
  folderId: string,
  filename: string,
  contentType: string,
  bytes: ArrayBuffer,
  existingFileId: string | null,
): Promise<string> {
  if (existingFileId) {
    const updateRes = await googleFetch(
      accessToken,
      `https://www.googleapis.com/upload/drive/v3/files/${existingFileId}?uploadType=media`,
      {
        method: "PATCH",
        headers: { "Content-Type": contentType },
        body: bytes,
      },
    );
    if (!updateRes.ok) {
      throw new Error(`Drive update failed ${updateRes.status}: ${await updateRes.text()}`);
    }
    return existingFileId;
  }
  const metadata = {
    name: filename,
    parents: [folderId],
  };
  const boundary = `pay_${crypto.randomUUID().replaceAll("-", "")}`;
  const metaPart = JSON.stringify(metadata);
  const binary = new Uint8Array(bytes);
  const preamble = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metaPart}\r\n--${boundary}\r\nContent-Type: ${contentType}\r\n\r\n`;
  const epilogue = `\r\n--${boundary}--`;
  const preambleBytes = new TextEncoder().encode(preamble);
  const epilogueBytes = new TextEncoder().encode(epilogue);
  const body = new Uint8Array(preambleBytes.length + binary.length + epilogueBytes.length);
  body.set(preambleBytes, 0);
  body.set(binary, preambleBytes.length);
  body.set(epilogueBytes, preambleBytes.length + binary.length);

  const res = await googleFetch(
    accessToken,
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart",
    {
      method: "POST",
      headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
      body,
    },
  );
  if (!res.ok) throw new Error(`Drive upload failed ${res.status}: ${await res.text()}`);
  const json = (await res.json()) as { id: string };
  await shareWithoutNotification(accessToken, json.id, COMM_SUPPORT);
  return json.id;
}

export async function syncClaimToGoogle(options: {
  env: Env;
  event: PayEvent;
  claim: ClaimRow;
  bank: BankAccount;
  items: ClaimItemRow[];
  loadReceipt: (key: string) => Promise<{ bytes: ArrayBuffer; contentType: string } | null>;
}): Promise<SheetSyncResult> {
  const { env, event, claim, bank, items, loadReceipt } = options;
  const accessToken = await getGoogleAccessToken(env.GOOGLE_SERVICE_ACCOUNT_JSON);
  const folderName = `[GDG Pay] ${event.title} / ${claim.applicant_name}`;
  const folderId = await ensureFolder(accessToken, folderName, claim.drive_folder_id);
  const sheetName = `経費精算_${claim.application_date.replaceAll("-", "")}_${claim.applicant_name}`;
  const sheet = await copyTemplate(
    accessToken,
    env.SHEETS_TEMPLATE_ID,
    sheetName,
    folderId,
    claim.sheet_id,
  );

  const itemDriveFileIds: Array<{ itemId: string; driveFileId: string }> = [];
  const sheetItems: SheetPayload["items"] = [];
  for (const item of items) {
    let filename = item.receipt_filename ?? "";
    if (item.receipt_r2_key && item.receipt_filename) {
      const receipt = await loadReceipt(item.receipt_r2_key);
      if (receipt) {
        const driveFileId = await uploadReceipt(
          accessToken,
          folderId,
          item.receipt_filename,
          item.receipt_content_type ?? receipt.contentType,
          receipt.bytes,
          item.receipt_drive_file_id,
        );
        itemDriveFileIds.push({ itemId: item.id, driveFileId });
        filename = item.receipt_filename;
      }
    }
    sheetItems.push({
      spentOn: item.spent_on,
      category: item.category,
      description: item.description,
      amountYen: item.amount_yen,
      receiptFilename: filename,
    });
  }

  const values = buildSheetValues({
    applicantName: claim.applicant_name,
    eventTitle: event.title,
    applicationDate: claim.application_date,
    totalAmount: claim.total_amount,
    bank,
    items: sheetItems,
  });
  await clearAndWriteSheet(accessToken, sheet.id, values);

  return {
    sheetId: sheet.id,
    sheetUrl: sheet.url,
    driveFolderId: folderId,
    itemDriveFileIds,
  };
}
