import type { Desk } from "~/lib/topics";

export type Point = { x: number; y: number };
export type Rect = { x: number; y: number; width: number; height: number };
export type Transform = { scale: number; offsetX: number; offsetY: number };

/** Minimum desk footprint (world units) the resize handle will not shrink past. */
export const MIN_DESK_WIDTH = 60;
export const MIN_DESK_HEIGHT = 40;

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
): Transform {
  const availW = Math.max(1, viewport.width - pad * 2);
  const availH = Math.max(1, viewport.height - pad * 2);
  const scale =
    box.width > 0 && box.height > 0 ? Math.min(availW / box.width, availH / box.height, 1) : 1;
  const offsetX = pad + (availW - box.width * scale) / 2 - box.x * scale;
  const offsetY = pad + (availH - box.height * scale) / 2 - box.y * scale;
  return { scale, offsetX, offsetY };
}

/**
 * Angle (degrees) of `point` around `center`, in the same convention as CSS
 * `rotate()`: 0° is straight up, increasing clockwise.
 */
export function angleFromCenter(center: Point, point: Point): number {
  return (Math.atan2(point.y - center.y, point.x - center.x) * 180) / Math.PI + 90;
}

/** Normalize an angle in degrees to the range `(-180, 180]`. */
export function normalizeAngle(deg: number): number {
  const wrapped = ((((deg + 180) % 360) + 360) % 360) - 180;
  return wrapped === -180 ? 180 : wrapped;
}

/**
 * Resize a desk by a raw screen-pixel pointer delta (not yet divided by
 * `t.scale` — this does that), keeping the desk's local top-left corner
 * fixed. The delta is projected onto the desk's own (possibly rotated) axes
 * first, so a rotated desk's handle keeps tracking the cursor instead of
 * resizing along the screen's axes.
 */
export function resizeDesk(
  start: Desk,
  screenDx: number,
  screenDy: number,
  t: Pick<Transform, "scale">,
): Pick<Desk, "x" | "y" | "width" | "height"> {
  const dx = screenDx / t.scale;
  const dy = screenDy / t.scale;
  const cos = Math.cos(rad(start.rotation));
  const sin = Math.sin(rad(start.rotation));
  // Project the world-space pointer delta onto the desk's local axes.
  const localDx = dx * cos + dy * sin;
  const localDy = -dx * sin + dy * cos;
  const width = Math.max(MIN_DESK_WIDTH, start.width + localDx);
  const height = Math.max(MIN_DESK_HEIGHT, start.height + localDy);
  const dw = width - start.width;
  const dh = height - start.height;
  // Recover the local top-left corner by shifting the centre by half the
  // size delta, rotated back into world space (CSS rotates about the centre).
  const cx = start.x + start.width / 2 + (dw / 2) * cos - (dh / 2) * sin;
  const cy = start.y + start.height / 2 + (dw / 2) * sin + (dh / 2) * cos;
  return { x: cx - width / 2, y: cy - height / 2, width, height };
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
