import { redirect } from "react-router";
import type { Route } from "./+types/onboarding";

export async function loader(_args: Route.LoaderArgs) {
  throw redirect("/chapters");
}

export default function OnboardingRedirect() {
  return null;
}
