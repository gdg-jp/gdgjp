type LegendTrack = { name: string };

export function GridLegend({
  tracks,
  showAvailabilityStates = false,
}: {
  tracks: readonly LegendTrack[];
  showAvailabilityStates?: boolean;
}) {
  return (
    <div className="data-grid-legend" aria-label="凡例">
      {tracks.map((track) => (
        <span key={track.name}>{track.name}</span>
      ))}
      {showAvailabilityStates ? (
        <>
          <span>
            <span
              aria-hidden="true"
              className="sw"
              style={{ boxShadow: "inset 0 0 0 2px var(--color-gdg-blue)" }}
            />
            △（可能なら）の枠を使用
          </span>
          <span>
            <span
              aria-hidden="true"
              className="sw"
              style={{ boxShadow: "inset 0 0 0 2px var(--color-gdg-blue-deep)" }}
            />
            条件違反
          </span>
          <span>空欄 = 休憩</span>
        </>
      ) : null}
    </div>
  );
}
