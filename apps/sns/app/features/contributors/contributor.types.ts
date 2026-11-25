export type Contributor = {
  email: string;
  createdAt: string;
};

export type ContributorAdminActor = {
  role: "organizer" | "member" | "contributor";
  isSuperAdmin: boolean;
};

export type ContributorDependencies = {
  db: D1Database;
};

export type ContributorCandidate = { email: string; name: string; image: string | null };

export type ContributorCandidateSearch = {
  candidates: ContributorCandidate[];
  error: "accounts_sign_in_required" | "accounts_search_failed" | null;
};
