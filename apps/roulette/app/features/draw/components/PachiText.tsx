export type PachiTone = "blue" | "red" | "gold" | "white" | "rainbow";

/** Pachinko lettering: metallic fill, black edge and a glow in the tone's color (app.css). */
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
