import { decode } from "blurhash";
import { useEffect, useRef } from "react";

export function BlurhashPlaceholder({
  hash,
  isSelected,
}: { hash: string | null; isSelected: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!hash || !canvasRef.current) return;
    try {
      const width = 32;
      const pixels = decode(hash, width, width);
      const context = canvasRef.current.getContext("2d");
      if (!context) return;
      const image = new ImageData(width, width);
      image.data.set(pixels);
      context.putImageData(image, 0, 0);
    } catch {
      // An invalid placeholder must not prevent loading the original image.
    }
  }, [hash]);

  return hash ? (
    <canvas
      ref={canvasRef}
      className={`absolute inset-0 size-full object-cover blur-sm transition-transform duration-200 ${isSelected ? "scale-90" : "scale-100"}`}
      height="32"
      width="32"
    />
  ) : null;
}
