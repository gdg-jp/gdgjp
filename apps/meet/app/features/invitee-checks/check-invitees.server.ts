import { fetchRegisteredEmails } from "~/features/directory/directory.server";
import { GoogleApiError, type GoogleFetch } from "~/features/google/client.server";
import {
  createFile,
  createPermission,
  deletePermission,
  isInvalidSharingRequestError,
} from "~/features/google/drive.server";
import { normalizeEmail } from "~/features/google/email";
import { toSafeErrorSummary } from "~/features/google/error-summary.server";
import { getGoogleAccessToken } from "~/features/google/token.server";
import { maskEmailsInText } from "~/lib/redact-email";
import {
  getDriveProbeFileId,
  listDriveShareChecksByEmails,
  upsertDriveProbeFileId,
  upsertDriveShareCheck,
} from "./repository.server";

export const DRIVE_PROBE_FILE_NAME = "GDG Japan Meet 招待者確認用（削除しないでください）";
export const DRIVE_PROBE_FILE_MIME_TYPE = "application/vnd.google-apps.document";
export const SHARE_CHECK_OK_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const MAX_DRIVE_PROBE_PER_SAVE = 20;

export type InviteeCandidate = {
  emailNormalized: string;
  email: string;
  userId: string | null;
};

export type FindUnshareableInviteesInput = {
  actorLocalUserId: string;
  invitees: readonly InviteeCandidate[];
  existingInvitees?: readonly { emailNormalized: string }[];
};

export type FindUnshareableInviteesDeps = {
  fetchFn?: GoogleFetch;
  now?: () => Date;
};

export type UnshareableInvitee = {
  emailNormalized: string;
  email: string;
};

export function formatUnshareableInviteesError(unshareable: readonly UnshareableInvitee[]): string {
  const emails = unshareable.map((u) => u.email).join(", ");
  return `Google アカウントとして共有できないメールアドレスが含まれています: ${emails}。アドレスを確認するか、招待先から外してください。`;
}

function isOkCacheFresh(checkedAtIso: string, nowMs: number): boolean {
  const checkedMs = Date.parse(checkedAtIso);
  if (Number.isNaN(checkedMs)) return false;
  return nowMs - checkedMs <= SHARE_CHECK_OK_TTL_MS;
}

async function createAndSaveProbeFile(
  db: D1Database,
  accessToken: string,
  nowIso: string,
  fetchFn: GoogleFetch,
): Promise<string> {
  const file = await createFile(
    accessToken,
    {
      name: DRIVE_PROBE_FILE_NAME,
      mimeType: DRIVE_PROBE_FILE_MIME_TYPE,
    },
    fetchFn,
  );
  await upsertDriveProbeFileId(db, file.id, nowIso);
  return file.id;
}

async function resolveProbeFileId(
  db: D1Database,
  accessToken: string,
  nowIso: string,
  fetchFn: GoogleFetch,
): Promise<string> {
  const existing = await getDriveProbeFileId(db);
  if (existing) return existing;
  return createAndSaveProbeFile(db, accessToken, nowIso, fetchFn);
}

async function createProbePermissionWith404Recovery(
  db: D1Database,
  accessToken: string,
  probeFileId: string,
  email: string,
  nowIso: string,
  fetchFn: GoogleFetch,
): Promise<{ permissionId: string; probeFileId: string }> {
  try {
    const created = await createPermission(
      accessToken,
      probeFileId,
      {
        type: "user",
        role: "reader",
        emailAddress: email,
        sendNotificationEmail: false,
      },
      fetchFn,
    );
    return { permissionId: created.id, probeFileId };
  } catch (error) {
    if (error instanceof GoogleApiError && error.httpStatus === 404) {
      const recreatedId = await createAndSaveProbeFile(db, accessToken, nowIso, fetchFn);
      const created = await createPermission(
        accessToken,
        recreatedId,
        {
          type: "user",
          role: "reader",
          emailAddress: email,
          sendNotificationEmail: false,
        },
        fetchFn,
      );
      return { permissionId: created.id, probeFileId: recreatedId };
    }
    throw error;
  }
}

/**
 * 会議保存前に「今回新しく追加される招待者」の中に Drive 共有できないアドレスが含まれるか判定する。
 * 1. ホストアカウントと既存招待者を除外
 * 2. D1 キャッシュ（30 日以内の `ok` はスキップ、`unshareable` は Drive で確かめ直し、
 *    確かめられなければ拒否）
 * 3. `userId` あり・GDG Accounts 登録済みアドレスをスキップ
 * 4. 2 の確かめ直しと 3 の残りを、合わせて最大 20 件まで Drive の確認用ファイルへの
 *    `permissions.create` で試行確認
 */
export async function findUnshareableInvitees(
  env: Env,
  input: FindUnshareableInviteesInput,
  deps: FindUnshareableInviteesDeps = {},
): Promise<UnshareableInvitee[]> {
  const fetchFn = deps.fetchFn ?? globalThis.fetch;
  const now = deps.now ?? (() => new Date());

  const hostNormalized = normalizeEmail(env.GOOGLE_HOST_EMAIL);
  const existingSet = new Set(input.existingInvitees?.map((inv) => inv.emailNormalized) ?? []);
  const candidates = input.invitees.filter(
    (inv) => inv.emailNormalized !== hostNormalized && !existingSet.has(inv.emailNormalized),
  );
  if (candidates.length === 0) return [];

  const cachedMap = await listDriveShareChecksByEmails(
    env.DB,
    candidates.map((c) => c.emailNormalized),
  );

  const nowMs = now().getTime();
  const unshareableEmails = new Set<string>();
  // 共有不可と記録済みのアドレスは、Accounts 登録済みでも Drive で確かめ直す（後から Google
  // アカウントが作られた場合に保存できるようにするため）。確かめられなければ共有不可のまま扱う。
  const recheck: InviteeCandidate[] = [];
  const afterCache: InviteeCandidate[] = [];

  for (const candidate of candidates) {
    const cached = cachedMap.get(candidate.emailNormalized);
    if (cached?.status === "unshareable") {
      unshareableEmails.add(candidate.emailNormalized);
      recheck.push(candidate);
      continue;
    }
    if (cached?.status === "ok" && isOkCacheFresh(cached.checkedAt, nowMs)) {
      continue;
    }
    afterCache.push(candidate);
  }

  const withoutUserId = afterCache.filter((c) => !c.userId);
  let unregistered: InviteeCandidate[] = [];
  if (withoutUserId.length > 0) {
    const registeredSet = await fetchRegisteredEmails(
      env,
      input.actorLocalUserId,
      withoutUserId.map((c) => c.emailNormalized),
    );
    unregistered =
      registeredSet === null
        ? withoutUserId
        : withoutUserId.filter((c) => !registeredSet.has(c.emailNormalized));
  }
  const toProbe = [...recheck, ...unregistered];

  if (toProbe.length > 0) {
    const probeTargets = toProbe.slice(0, MAX_DRIVE_PROBE_PER_SAVE);
    const nowIso = now().toISOString();

    try {
      const accessToken = await getGoogleAccessToken(env, fetchFn);
      let probeFileId = await resolveProbeFileId(env.DB, accessToken, nowIso, fetchFn);

      for (const target of probeTargets) {
        try {
          const result = await createProbePermissionWith404Recovery(
            env.DB,
            accessToken,
            probeFileId,
            target.email,
            nowIso,
            fetchFn,
          );
          probeFileId = result.probeFileId;

          try {
            await deletePermission(accessToken, probeFileId, result.permissionId, fetchFn);
          } catch (deleteError) {
            console.warn(
              "[invitee-checks] 確認用ファイルからの権限削除に失敗しました:",
              maskEmailsInText(toSafeErrorSummary(deleteError)),
            );
          }

          unshareableEmails.delete(target.emailNormalized);
          await upsertDriveShareCheck(env.DB, {
            emailNormalized: target.emailNormalized,
            status: "ok",
            httpStatus: null,
            apiStatus: null,
            source: "probe",
            checkedAt: now().toISOString(),
          });
        } catch (error) {
          if (isInvalidSharingRequestError(error)) {
            await upsertDriveShareCheck(env.DB, {
              emailNormalized: target.emailNormalized,
              status: "unshareable",
              httpStatus: error.httpStatus,
              apiStatus: error.apiStatus ?? null,
              source: "probe",
              checkedAt: now().toISOString(),
            });
            unshareableEmails.add(target.emailNormalized);
            continue;
          }

          console.warn(
            "[invitee-checks] Drive 共有可否確認を一時エラーのためスキップしました:",
            maskEmailsInText(toSafeErrorSummary(error)),
          );
        }
      }
    } catch (error) {
      console.warn(
        "[invitee-checks] Drive 共有可否確認の実行をスキップしました:",
        maskEmailsInText(toSafeErrorSummary(error)),
      );
    }
  }

  return candidates
    .filter((c) => unshareableEmails.has(c.emailNormalized))
    .map((c) => ({ emailNormalized: c.emailNormalized, email: c.email }));
}
