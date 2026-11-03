import { Injectable } from '@angular/core';

export interface Pt {
  x: number;
  y: number;
}

export interface CumulativePoint {
  pos: Pt;
  cumLength: number;
  segLength: number;
}

@Injectable({ providedIn: 'root' })
export class GeometryService {
  computeCumulative(points: number[][]): CumulativePoint[] {
    const out: CumulativePoint[] = [];
    if (points.length === 0) return out;
    let cum = 0;
    for (let i = 0; i < points.length; i++) {
      const [x, y] = points[i];
      const next = points[(i + 1) % points.length];
      if (!next && points.length === 1) {
        out.push({ pos: { x, y }, cumLength: 0, segLength: 0 });
        return out;
      }
      const dx = next[0] - x;
      const dy = next[1] - y;
      const len = Math.hypot(dx, dy);
      out.push({ pos: { x, y }, cumLength: cum, segLength: len });
      cum += len;
    }
    return out;
  }

  totalLength(cum: CumulativePoint[]): number {
    if (cum.length === 0) return 0;
    return cum[cum.length - 1].cumLength + cum[cum.length - 1].segLength;
  }

  progressToPoint(cum: CumulativePoint[], total: number, progress: number): Pt {
    if (cum.length === 0 || total === 0) return { x: 0, y: 0 };
    let p = progress;
    while (p < 0) p += 1;
    p = p % 1;
    let target = p * total;
    for (let i = 0; i < cum.length; i++) {
      const c = cum[i];
      if (target <= c.cumLength + c.segLength || i === cum.length - 1) {
        const segStart = c.cumLength;
        const segLen = c.segLength || 1;
        const t = Math.max(0, Math.min(1, (target - segStart) / segLen));
        const next = cum[(i + 1) % cum.length];
        return {
          x: c.pos.x + (next.pos.x - c.pos.x) * t,
          y: c.pos.y + (next.pos.y - c.pos.y) * t,
        };
      }
    }
    return { x: cum[0].pos.x, y: cum[0].pos.y };
  }

  progressToAngle(cum: CumulativePoint[], total: number, progress: number): number {
    if (cum.length === 0 || total === 0) return 0;
    let p = progress;
    while (p < 0) p += 1;
    p = p % 1;
    let target = p * total;
    for (let i = 0; i < cum.length; i++) {
      const c = cum[i];
      if (target <= c.cumLength + c.segLength || i === cum.length - 1) {
        const next = cum[(i + 1) % cum.length];
        return Math.atan2(next.pos.y - c.pos.y, next.pos.x - c.pos.x);
      }
    }
    return 0;
  }

  dist(a: Pt, b: Pt): number {
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  nearestPointIndex(points: number[][], p: Pt, threshold: number): number | null {
    let best = -1;
    let bestD = Infinity;
    for (let i = 0; i < points.length; i++) {
      const d = Math.hypot(points[i][0] - p.x, points[i][1] - p.y);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    if (best >= 0 && bestD <= threshold) return best;
    return null;
  }

  nearestProgress(cum: CumulativePoint[], total: number, p: Pt): number {
    if (cum.length === 0 || total === 0) return 0;
    let bestProgress = 0;
    let bestDist = Infinity;
    const coarse = 200;
    for (let i = 0; i <= coarse; i++) {
      const prog = i / coarse;
      const pt = this.progressToPoint(cum, total, prog);
      const d = (pt.x - p.x) ** 2 + (pt.y - p.y) ** 2;
      if (d < bestDist) {
        bestDist = d;
        bestProgress = prog;
      }
    }
    const refine = 40;
    const span = 1 / coarse * 2;
    let base = bestProgress - span;
    if (base < 0) base += 1;
    for (let i = 0; i <= refine; i++) {
      const prog = (base + (span * 2 * i) / refine) % 1;
      const pt = this.progressToPoint(cum, total, prog);
      const d = (pt.x - p.x) ** 2 + (pt.y - p.y) ** 2;
      if (d < bestDist) {
        bestDist = d;
        bestProgress = prog;
      }
    }
    return bestProgress;
  }
}
