export type ExistingApplication = {
  id: string;
  userId: string | null;
  email: string;
};

export type Viewer = {
  userId: string;
  email: string;
};

export type ClaimResolution =
  | { kind: "own"; id: string }
  | { kind: "claimable"; id: string }
  | { kind: "new" };

export function resolveApplication(
  existing: readonly ExistingApplication[],
  viewer: Viewer,
): ClaimResolution {
  const own = existing.find((a) => a.userId === viewer.userId);
  if (own) return { kind: "own", id: own.id };

  const claimable = existing.find((a) => a.userId === null && a.email === viewer.email);
  if (claimable) return { kind: "claimable", id: claimable.id };

  return { kind: "new" };
}
