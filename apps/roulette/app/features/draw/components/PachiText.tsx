export type PachiTone = "blue" | "red" | "gold" | "white" | "rainbow";

export function PachiText({
  text,
  tone,
  className = "",
}: {
  text: string;
  tone: PachiTone;
  className?: string;
}) {
  return (
    <span data-text={text} className={`pachi-text pachi-${tone} ${className}`}>
      {text}
    </span>
  );
}
