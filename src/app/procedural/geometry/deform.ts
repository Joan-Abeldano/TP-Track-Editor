import { Rng } from '../rng';
import { selfIntersects } from './self-intersection';

export function deformPoints(points: number[][], rng: Rng, variation: number): number[][] {
  if (points.length < 4) return points.map((point) => [...point]);

  const open = points.slice(0, -1);
  const count = open.length;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of open) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  const size = Math.max(maxX - minX, maxY - minY, 1);
  const v = Math.max(0, Math.min(0.4, variation));
  const amplitude = size * (0.008 + v * 0.1);

  const harmonics = [
    {
      order: 1,
      ax: rng.range(0.5, 1.0),
      ay: rng.range(0.5, 1.0),
      phaseX: rng.range(0, Math.PI * 2),
      phaseY: rng.range(0, Math.PI * 2),
    },
    {
      order: 2,
      ax: rng.range(0.15, 0.45),
      ay: rng.range(0.15, 0.45),
      phaseX: rng.range(0, Math.PI * 2),
      phaseY: rng.range(0, Math.PI * 2),
    },
    {
      order: 3,
      ax: rng.range(0.05, 0.2),
      ay: rng.range(0.05, 0.2),
      phaseX: rng.range(0, Math.PI * 2),
      phaseY: rng.range(0, Math.PI * 2),
    },
  ];

  const build = (scale: number): number[][] => {
    const deformed = open.map(([x, y], index) => {
      const progress = index / count;
      let dx = 0;
      let dy = 0;
      for (const harmonic of harmonics) {
        const angle = Math.PI * 2 * harmonic.order * progress;
        dx += harmonic.ax * Math.sin(angle + harmonic.phaseX);
        dy += harmonic.ay * Math.cos(angle + harmonic.phaseY);
      }
      return [x + amplitude * dx * 0.45 * scale, y + amplitude * dy * 0.45 * scale];
    });
    deformed.push([...deformed[0]]);
    return deformed;
  };

  for (const scale of [1, 0.8, 0.62, 0.48, 0.36, 0.26, 0.18]) {
    const candidate = build(scale);
    if (!selfIntersects(candidate)) return candidate;
  }
  return points.map(([x, y]) => [x, y]);
}
