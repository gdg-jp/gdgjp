/** Scroll to a heading on every click: the router only moves the URL for a repeated hash. */
export function jumpToHeading(event: React.MouseEvent<HTMLAnchorElement>, id: string): void {
  const target = document.getElementById(id);
  if (!target) return;
  event.preventDefault();
  target.scrollIntoView({ block: "start" });
  window.history.replaceState(window.history.state, "", `#${encodeURIComponent(id)}`);
}
