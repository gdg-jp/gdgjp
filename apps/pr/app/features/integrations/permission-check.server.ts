import { listMemberClaims } from "~/features/campaigns/campaign.repository.server";
import type { CampaignAccount } from "./account";
import { callRpc, parseActor, snsService } from "./bindings.server";

export type PostingCheck = {
  accountId: number;
  /** The account is still connected on sns. */
  connected: boolean | null;
  /** Campaign members (by their last claims) sns would let post on it. */
  posters: string[];
  warning: string | null;
};

/**
 * Before the day: ask sns, as each campaign member in the account's chapter, whether they could
 * post. DevFest 2026 found out on the day that nobody could.
 */
export async function checkPosting(
  env: Env,
  campaignId: number,
  accounts: CampaignAccount[],
): Promise<PostingCheck[]> {
  const members = await listMemberClaims(env.DB, campaignId);
  const out: PostingCheck[] = [];
  for (const account of accounts.filter((a) => a.kind === "x")) {
    const candidates = members
      .map((m) => ({ name: m.name, actor: parseActor(m.claims) }))
      .filter((m) => m.actor?.chapters.some((c) => c.chapterId === account.chapterId));
    let connected: boolean | null = null;
    const posters: string[] = [];
    for (const candidate of candidates) {
      if (!candidate.actor) continue;
      const actor = candidate.actor;
      const result = await callRpc(() =>
        snsService(env).listXAccounts({ actor, chapterId: account.chapterId }),
      );
      if (!result.ok) continue;
      connected = result.accounts.some((a) => a.id === account.externalId);
      if (result.canPost) posters.push(candidate.name);
    }
    const warning =
      connected === false
        ? "sns でこのアカウントの接続が切れています"
        : posters.length === 0
          ? "このアカウントで投稿できるメンバーがいません（sns の contributor か organizer が要ります）"
          : null;
    out.push({ accountId: account.id, connected, posters, warning });
  }
  return out;
}
