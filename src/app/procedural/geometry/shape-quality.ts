import { TrackShape } from '../recipe/recipe.types';

interface ShapeLimits {
  minAspect: number;
  maxAspect: number;
  minCompactness: number;
  maxCompactness: number;
}

export interface ShapeMetrics {
  width: number;
  height: number;
  aspect: number;
  area: number;
  perimeter: number;
  compactness: number;
}

const SHAPE_LIMITS: Record<TrackShape, ShapeLimits> = {
  compact: { minAspect: 1.0, maxAspect: 2.35, minCompactness: 1.0, maxCompactness: 13 },
  balanced: { minAspect: 1.0, maxAspect: 4.3, minCompactness: 1.0, maxCompactness: 18 },
  elongated: { minAspect: 2.15, maxAspect: 4.3, minCompactness: 1.0, maxCompactness: 18 },
  round: { minAspect: 1.0, maxAspect: 1.6, minCompactness: 1.0, maxCompactness: 4.5 },
  oval: { minAspect: 1.5, maxAspect: 2.4, minCompactness: 1.0, maxCompactness: 4.0 },
  lobed: { minAspect: 1.0, maxAspect: 3.4, minCompactness: 5.0, maxCompactness: 18 },
};

export function pointShapeMetrics(points: readonly (readonly number[])[]): ShapeMetrics {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let perimeter = 0;
  let twiceArea = 0;

  for (let i = 0; i < points.length; i++) {
    const [x, y] = points[i];
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);

    const next = points[(i + 1) % points.length];
    perimeter += Math.hypot(next[0] - x, next[1] - y);
    twiceArea += x * next[1] - next[0] * y;
  }

  const width = maxX - minX;
  const height = maxY - minY;
  const area = Math.abs(twiceArea) / 2;
  const aspect = width > 0 && height > 0
    ? Math.max(width, height) / Math.min(width, height)
    : 1;
  const compactness = area > 0
    ? (perimeter * perimeter) / (4 * Math.PI * area)
    : Infinity;

  return { width, height, aspect, area, perimeter, compactness };
}

export function plausibleShape(
  points: readonly (readonly number[])[],
  shape: TrackShape = 'balanced',
): boolean {
  if (points.length < 8) return false;

  const metrics = pointShapeMetrics(points);
  if (metrics.width < 1 || metrics.height < 1 || metrics.area < 1) return false;

  const limits = SHAPE_LIMITS[shape];
  if (metrics.aspect < limits.minAspect || metrics.aspect > limits.maxAspect) return false;
  if (
    metrics.compactness < limits.minCompactness ||
    metrics.compactness > limits.maxCompactness
  ) {
    return false;
  }

  return true;
}

export function pointAspect(points: readonly (readonly number[])[]): number {
  return pointShapeMetrics(points).aspect;
}

export function shapeMatchScore(
  points: readonly (readonly number[])[],
  shape: TrackShape,
): number {
  const metrics = pointShapeMetrics(points);
  switch (shape) {
    case 'compact':
      return -metrics.aspect;
    case 'elongated':
      return metrics.aspect;
    case 'round':
      return -metrics.aspect - metrics.compactness * 0.5;
    case 'oval':
      return -Math.abs(metrics.aspect - 1.95) - metrics.compactness * 0.35;
    case 'lobed':
      return metrics.compactness - Math.abs(metrics.aspect - 2.0) * 0.25;
    case 'balanced':
    default:
      return 0;
  }
}
