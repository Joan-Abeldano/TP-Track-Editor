interface Point {
  x: number;
  y: number;
}

export function findSelfIntersection(points: number[][]): [number, number] | null {
  const segmentCount = points.length - 1;
  if (segmentCount < 3) return null;

  for (let i = 0; i < segmentCount; i++) {
    const a = { x: points[i][0], y: points[i][1] };
    const b = { x: points[i + 1][0], y: points[i + 1][1] };

    for (let j = i + 1; j < segmentCount; j++) {
      if (j === i + 1) continue;
      if (i === 0 && j === segmentCount - 1) continue;

      const c = { x: points[j][0], y: points[j][1] };
      const d = { x: points[j + 1][0], y: points[j + 1][1] };

      if (segmentsTouch(a, b, c, d)) continue;
      if (segmentsIntersect(a, b, c, d)) return [i, j];
    }
  }
  return null;
}

export function selfIntersects(points: number[][]): boolean {
  return findSelfIntersection(points) !== null;
}

function segmentsTouch(a: Point, b: Point, c: Point, d: Point): boolean {
  return distance(a, c) < 1e-9 || distance(a, d) < 1e-9 ||
    distance(b, c) < 1e-9 || distance(b, d) < 1e-9;
}

function segmentsIntersect(a: Point, b: Point, c: Point, d: Point): boolean {
  if (Math.max(a.x, b.x) < Math.min(c.x, d.x) || Math.max(c.x, d.x) < Math.min(a.x, b.x)) return false;
  if (Math.max(a.y, b.y) < Math.min(c.y, d.y) || Math.max(c.y, d.y) < Math.min(a.y, b.y)) return false;

  const o1 = orientation(a, b, c);
  const o2 = orientation(a, b, d);
  const o3 = orientation(c, d, a);
  const o4 = orientation(c, d, b);
  const eps = 1e-9;

  return ((o1 > eps && o2 < -eps) || (o1 < -eps && o2 > eps)) &&
    ((o3 > eps && o4 < -eps) || (o3 < -eps && o4 > eps));
}

function orientation(a: Point, b: Point, c: Point): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
