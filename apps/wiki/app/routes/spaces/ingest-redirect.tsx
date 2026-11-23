import { redirect } from "react-router";
import { DEFAULT_SPACE_SLUG, spacePath } from "~/features/spaces/shared";

export function loader() {
  return redirect(spacePath(DEFAULT_SPACE_SLUG, "/sources"), 301);
}

export default function IngestRedirect() {
  return null;
}
