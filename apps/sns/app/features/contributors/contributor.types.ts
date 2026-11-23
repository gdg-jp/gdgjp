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
