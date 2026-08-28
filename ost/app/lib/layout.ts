import type { Desk } from "~/lib/topics";

export type Point = { x: number; y: number };
export type Rect = { x: number; y: number; width: number; height: number };

const rad = (deg: number) => (deg * Math.PI) / 180;

/** The four corners of a desk in world coordinates, honouring its rotation. */
export function deskCorners(desk: Desk): Point[] {
  const cx = desk.x + desk.width / 2;
  const cy = desk.y + desk.height / 2;
  const hw = desk.width / 2;
  const hh = desk.height / 2;
  const cos = Math.cos(rad(desk.rotation));
  const sin = Math.sin(rad(desk.rotation));
  return [
    [-hw, -hh],
    [hw, -hh],
    [hw, hh],
    [-hw, hh],
  ].map(([dx, dy]) => ({ x: cx + dx * cos - dy * sin, y: cy + dx * sin + dy * cos }));
}

/** Axis-aligned bounding box that contains every desk (rotation included). */
export function boundingBox(desks: Desk[]): Rect {
  if (desks.length === 0) return { x: 0, y: 0, width: 0, height: 0 };
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const desk of desks) {
    for (const p of deskCorners(desk)) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/**
 * Contain-fit transform mapping a world `box` into `viewport`, with uniform
 * `pad` (viewport px) around it. Apply as: screen = world * scale + offset.
 */
export function fitTransform(
  box: Rect,
  viewport: { width: number; height: number },
  pad = 24,
): { scale: number; offsetX: number; offsetY: number } {
  const availW = Math.max(1, viewport.width - pad * 2);
  const availH = Math.max(1, viewport.height - pad * 2);
  const scale =
    box.width > 0 && box.height > 0 ? Math.min(availW / box.width, availH / box.height, 1) : 1;
  const offsetX = pad + (availW - box.width * scale) / 2 - box.x * scale;
  const offsetY = pad + (availH - box.height * scale) / 2 - box.y * scale;
  return { scale, offsetX, offsetY };
}

/** Is world-point `p` inside `desk`'s rotated rectangle? */
export function pointInRotatedRect(p: Point, desk: Desk): boolean {
  const cx = desk.x + desk.width / 2;
  const cy = desk.y + desk.height / 2;
  const cos = Math.cos(rad(-desk.rotation));
  const sin = Math.sin(rad(-desk.rotation));
  const dx = p.x - cx;
  const dy = p.y - cy;
  const localX = dx * cos - dy * sin;
  const localY = dx * sin + dy * cos;
  return Math.abs(localX) <= desk.width / 2 && Math.abs(localY) <= desk.height / 2;
}

/** Do two axis-aligned card rects overlap at their centres (merge hit-test)? */
export function centersOverlap(a: Rect, b: Rect): boolean {
  const ac = { x: a.x + a.width / 2, y: a.y + a.height / 2 };
  return ac.x >= b.x && ac.x <= b.x + b.width && ac.y >= b.y && ac.y <= b.y + b.height;
}
