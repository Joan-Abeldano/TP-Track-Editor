import { Vec2 } from './arc-builder';

export interface CanvasFitOptions {
  width: number;
  height: number;
  margin: number;
  decimals?: number;
}

export function simplify(points: Vec2[], tolerance: number): Vec2[] {
  if (points.length <= 3) return points;

  const closed = isClosed(points);
  const open = closed ? points.slice(0, -1) : points;
  if (open.length <= 3) return points;

  const keep = new Uint8Array(open.length);
  keep[0] = 1;
  keep[open.length - 1] = 1;

  const stack: Array<[number, number]> = [[0, open.length - 1]];
  while (stack.length > 0) {
    const [first, last] = stack.pop()!;
    let farthest = -1;
    let farthestDistance = -1;

    for (let i = first + 1; i < last; i++) {
      const distance = distanceToSegment(open[i], open[first], open[last]);
      if (distance > farthestDistance) {
        farthestDistance = distance;
        farthest = i;
      }
    }

    if (farthest >= 0 && farthestDistance > tolerance) {
      keep[farthest] = 1;
      stack.push([first, farthest], [farthest, last]);
    }
  }

  const simplified = open.filter((_, index) => keep[index] === 1);
  if (closed) simplified.push({ ...simplified[0] });
  return simplified;
}

export function fitToCanvas(points: Vec2[], options: CanvasFitOptions): number[][] {
  if (points.length === 0) return [];

  const closed = isClosed(points);
  const source = closed ? points.slice(0, -1) : points;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const point of source) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }

  const width = Math.max(1, maxX - minX);
  const height = Math.max(1, maxY - minY);
  const availableWidth = Math.max(1, options.width - options.margin * 2);
  const availableHeight = Math.max(1, options.height - options.margin * 2);
  const scale = Math.min(availableWidth / width, availableHeight / height);
  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;
  const decimals = options.decimals ?? 3;
  const factor = Math.pow(10, decimals);

  const out: number[][] = source.map((point) => [
    Math.round((options.width / 2 + (point.x - centerX) * scale) * factor) / factor,
    Math.round((options.height / 2 + (point.y - centerY) * scale) * factor) / factor,
  ]);

  if (out.length > 0) out.push([out[0][0], out[0][1]]);
  return out;
}

export function isClosed(points: Vec2[]): boolean {
  if (points.length < 2) return false;
  return (
    Math.abs(points[0].x - points[points.length - 1].x) < 1e-6 &&
    Math.abs(points[0].y - points[points.length - 1].y) < 1e-6
  );
}

function distanceToSegment(point: Vec2, start: Vec2, end: Vec2): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared < 1e-12) return Math.hypot(point.x - start.x, point.y - start.y);

  let t = ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(point.x - (start.x + t * dx), point.y - (start.y + t * dy));
}
