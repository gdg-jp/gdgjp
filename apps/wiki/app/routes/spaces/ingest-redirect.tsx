import { redirect } from "react-router";
import { DEFAULT_SPACE_SLUG, spacePath } from "~/features/spaces/shared";

/** v1 `/ingest` (removed in v2 Stage 07): sources are added per space, the runner integrates them. */
export function loader() {
  return redirect(spacePath(DEFAULT_SPACE_SLUG, "/sources"), 301);
}

export default function IngestRedirect() {
  return null;
}
