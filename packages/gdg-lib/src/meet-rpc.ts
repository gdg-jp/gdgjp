// meet.gdgs.jp → accounts.gdgs.jp の service-binding RPC（WorkerEntrypoint `MeetDirectoryService`）
// 向け契約型。型のみを定義し、ランタイムコードは含めない。
import type { AuthUser, ChapterRole, UserChapter } from "./auth";

/**
 * RPC 呼び出し主体（呼び出し側が保持するユーザー情報とチャプター所属クレーム）。
 * `user.id` は accounts のユーザー ID（OIDC `sub`）を渡す。RP ローカルの `user.id` とは異なる。
 */
export type MeetActor = { user: AuthUser; chapters: UserChapter[] };

/** RPC メソッドはバインディング越しに例外を投げず、失敗を値として返す。 */
export type MeetRpcFailure = { ok: false; code: string; message?: string };
export type MeetRpcResult<T> = ({ ok: true } & T) | MeetRpcFailure;

export type MeetDirectoryMember = {
  userId: string;
  name: string;
  email: string;
  chapterId: number;
  chapterSlug: string;
  chapterName: string;
  role: ChapterRole;
};

export type ListChapterMembersInput = {
  actor: MeetActor;
  chapterIds: number[];
  roles?: ChapterRole[];
};

export interface MeetDirectoryService {
  listChapterMembers(
    input: ListChapterMembersInput,
  ): Promise<MeetRpcResult<{ members: MeetDirectoryMember[] }>>;
}
