import { useState } from "react";
import { BlurhashPlaceholder } from "~/components/blurhash-placeholder";

export function GooglePhotoButton({
  id,
  blurhash,
  selectionIndex,
  onToggle,
}: {
  id: string;
  blurhash: string | null;
  selectionIndex: number;
  onToggle: () => void;
}) {
  const [imageLoaded, setImageLoaded] = useState(false);
  const isSelected = selectionIndex !== -1;
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={isSelected}
      aria-label={isSelected ? `写真 ${selectionIndex + 1} を選択解除` : "写真を選択"}
      className="relative aspect-square overflow-hidden bg-muted focus-visible:z-10 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ring"
    >
      <BlurhashPlaceholder hash={blurhash} isSelected={isSelected} />
      <img
        src={`/api/google-photos-media/${id}`}
        alt=""
        loading="lazy"
        onLoad={() => setImageLoaded(true)}
        onError={() => setImageLoaded(true)}
        className={`size-full object-cover transition-[opacity,transform] duration-200 ${imageLoaded ? "opacity-100" : "opacity-0"} ${isSelected ? "scale-90" : "scale-100"}`}
      />
      {isSelected ? (
        <>
          <span className="absolute inset-0 bg-black/45" aria-hidden="true" />
          <span className="absolute top-2 left-2 flex size-7 items-center justify-center rounded-full bg-primary text-sm font-bold text-white shadow">
            {selectionIndex + 1}
          </span>
        </>
      ) : null}
    </button>
  );
}
