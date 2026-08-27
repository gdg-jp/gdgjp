/** A chapter contributor row, projected for display and CLI listing. */
export type Contributor = {
  email: string;
  createdAt: string;
};

/** The already-authorized actor a route hands the contributor policy. */
export type ContributorAdminActor = {
  role: "organizer" | "member" | "contributor";
  isSuperAdmin: boolean;
};

/**
 * Everything the contributor service needs from the Worker. Routes stay
 * responsible for access checks; the service only touches `sns_contributors`.
 */
export type ContributorDependencies = {
  db: D1Database;
};
