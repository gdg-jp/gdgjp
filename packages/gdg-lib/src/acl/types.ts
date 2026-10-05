export type AclSpan = {
  start: number;
  end: number;
  srcIds: string[];
  level: string | null;
  block: boolean;
  body: string;
};

export type SourceSubject = {
  addedBy: string;
  chapterId: string | null;
  visibility: string;
};

export type Membership = {
  chapterId: string | number;
  role: string;
};

export type PermissionClass = {
  chapterId: string;
  role: "organizer" | "member";
};

export type PageAudienceSubject = {
  visibility: string;
  access: readonly { subjectType: string; subjectKey: string }[];
};

export type PageSubject = PageAudienceSubject & {
  chapterId: string | null;
};

export type SourceAudienceKey =
  | { kind: "private" }
  | { kind: "member" }
  | { kind: "organizer" }
  | { kind: "chapter-member"; chapterId: string }
  | { kind: "chapter-organizer"; chapterId: string };

export type UserSubject = {
  id: string;
  isAdmin: boolean;
};
