export function RosterBrand({ size = 42 }: { size?: number }) {
  return (
    <>
      <img src="/favicon.svg" alt="" width={size} height={size} className="brand-icon" />
      <span className="brand-name">Roster</span>
    </>
  );
}
