import { useNavigation } from "react-router";

/**
 * Thin progress bar pinned to the top of the viewport while a navigation is in
 * flight. Purely cosmetic — it improves perceived latency now that admin
 * screens share the app shell. Mirrors tinyurl's dashboard-shell bar.
 */
export default function NavigationProgress() {
  const navigation = useNavigation();
  if (navigation.state === "idle") return null;

  return (
    <div aria-hidden="true" className="fixed inset-x-0 top-0 z-[60] h-0.5 overflow-hidden">
      <div className="h-full w-1/3 animate-pulse bg-action-primary motion-reduce:w-full" />
    </div>
  );
}
