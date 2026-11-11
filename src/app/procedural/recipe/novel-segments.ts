import { Rng } from '../rng';
import { RecipeSegment } from './recipe.types';
import { CorpusStats, cornerTypeForSpeed, speedForRadius } from './corpus-stats';

export const MIN_RADIUS_M = 18;
export const MAX_RADIUS_M = 1500;

export function makeArc(
  turnDeg: number,
  radius: number,
  stats: CorpusStats,
  rng: Rng,
): RecipeSegment {
  const clampedRadius = Math.max(MIN_RADIUS_M, Math.min(MAX_RADIUS_M, radius));
  const length = (Math.abs(turnDeg) * Math.PI) / 180 * clampedRadius;
  const speed = speedForRadius(stats, clampedRadius, rng);
  return {
    type: cornerTypeForSpeed(speed, stats),
    speed,
    length,
    turn_deg: turnDeg,
    r_min: clampedRadius,
  };
}

export function makeStraight(length: number, rng: Rng): RecipeSegment {
  return {
    type: 'straight',
    speed: rng.range(275, 405),
    length,
    turn_deg: 0,
    r_min: 1400,
  };
}

export function makeBay(stats: CorpusStats, rng: Rng): RecipeSegment[] {
  const depth = rng.range(150, 320);
  const returnDepth = depth * rng.range(0.85, 1.1);
  const radius = rng.range(24, 42);
  return [
    makeStraight(depth, rng),
    makeArc(180, radius, stats, rng),
    makeStraight(returnDepth, rng),
    makeArc(-180, radius * rng.range(0.9, 1.15), stats, rng),
    makeStraight(rng.range(50, 140), rng),
  ];
}
