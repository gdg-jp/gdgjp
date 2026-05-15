import { useEffect, useRef, useState } from "react";

/**
 * Wraps children with a tooltip label.
 * When `disabled` is true:
 *   - inner content gets pointer-events:none so events bubble to the wrapper span
 *   - hovering the wrapper shows the label (desktop)
 *   - tapping the wrapper shows the label for 2 s then hides it (mobile)
 * When `disabled` is false the component renders children directly with no DOM overhead.
 */
export default function Tooltip({
  label,
  disabled = false,
  children,
}: {
  label: string;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  const [visible, setVisible] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function show() {
    if (timerRef.current) clearTimeout(timerRef.current);
    setVisible(true);
    timerRef.current = setTimeout(() => setVisible(false), 2000);
  }

  function hide() {
    if (timerRef.current) clearTimeout(timerRef.current);
    setVisible(false);
  }

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  if (!disabled) return <>{children}</>;

  return (
    <span
      className="relative inline-block"
      onPointerEnter={show}
      onPointerLeave={hide}
      onClick={show}
      onKeyUp={show}
    >
      <span className="pointer-events-none">{children}</span>
      {visible && (
        <span
          role="tooltip"
          className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-1.5 -translate-x-1/2 whitespace-nowrap rounded bg-gray-800 px-2 py-1 text-xs text-white dark:bg-gray-100"
        >
          {label}
        </span>
      )}
    </span>
  );
}
