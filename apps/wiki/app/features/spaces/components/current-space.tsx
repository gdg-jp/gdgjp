import { createContext, useContext } from "react";
import type { SpaceKind, SpaceRole } from "../shared";

export type CurrentSpace = {
  id: string;
  slug: string;
  name: string;
  kind: SpaceKind;
  role: SpaceRole | null;
};

export type SpaceSummary = CurrentSpace;

export const DEFAULT_CURRENT_SPACE: CurrentSpace = {
  id: "gdg-jp",
  slug: "gdg-jp",
  name: "GDG Japan",
  kind: "shared",
  role: null,
};

const CurrentSpaceContext = createContext<CurrentSpace>(DEFAULT_CURRENT_SPACE);

export const CurrentSpaceProvider = CurrentSpaceContext.Provider;

/** The space the app shell is showing (URL `/s/:space/…`, else the last visited one). */
export function useCurrentSpace(): CurrentSpace {
  return useContext(CurrentSpaceContext);
}
