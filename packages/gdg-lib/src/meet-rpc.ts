import type { AuthUser, ChapterRole, UserChapter } from "./auth";

export type MeetActor = { user: AuthUser; chapters: UserChapter[] };

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

export type ListUserAvatarsByEmailsInput = {
  actorUserId: string;
  emails: string[];
};

export type ListRegisteredEmailsInput = {
  actorUserId: string;
  emails: string[];
};

export type MeetUserAvatar = {
  emailNormalized: string;
  image: string;
};

export interface MeetDirectoryService {
  listChapterMembers(
    input: ListChapterMembersInput,
  ): Promise<MeetRpcResult<{ members: MeetDirectoryMember[] }>>;
  listUserAvatarsByEmails(
    input: ListUserAvatarsByEmailsInput,
  ): Promise<MeetRpcResult<{ avatars: MeetUserAvatar[] }>>;
  listRegisteredEmails(
    input: ListRegisteredEmailsInput,
  ): Promise<MeetRpcResult<{ emails: string[] }>>;
}
