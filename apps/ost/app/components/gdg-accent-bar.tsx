export function GdgAccentBar() {
  return (
    <div aria-hidden className="flex h-3 overflow-hidden rounded-full border-2 border-black">
      <div className="flex-1 bg-gdg-blue" />
      <div className="flex-1 bg-gdg-red" />
      <div className="flex-1 bg-gdg-yellow" />
      <div className="flex-1 bg-gdg-green" />
    </div>
  );
}
