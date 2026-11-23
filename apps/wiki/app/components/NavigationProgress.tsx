import { useNavigation } from "react-router";

export default function NavigationProgress() {
  const navigation = useNavigation();
  if (navigation.state === "idle") return null;

  return (
    <div aria-hidden="true" className="fixed inset-x-0 top-0 z-[60] h-0.5 overflow-hidden">
      <div className="h-full w-full animate-indeterminate-travel bg-primary motion-reduce:animate-pulse" />
    </div>
  );
}
