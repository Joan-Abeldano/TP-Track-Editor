import { Rng } from '../rng';
import {
  NovelLayout,
  NovelLayoutOptions,
  RecipeSegment,
  TrackCharacter,
  TrackShape,
} from './recipe.types';
import {
  CorpusStats,
  cornerTypeForSpeed,
  speedForRadius,
} from './corpus-stats';
import { makeArc, makeBay, makeStraight, MAX_RADIUS_M, MIN_RADIUS_M } from './novel-segments';
import { buildPolyline, integrate } from '../geometry/arc-builder';
import { selfIntersects } from '../geometry/self-intersection';
import { plausibleShape } from '../geometry/shape-quality';

interface Motif {
  segments: RecipeSegment[];
}

interface MotifWeights {
  longStraight: number;
  hairpin: number;
  esses: number;
  chicane: number;
  sweeper: number;
  kink: number;
  doubleApex: number;
  squareCorner: number;
}

interface CharacterProfile {
  radiusScale: number;
  straightScale: number;
  counterBudget: number;
  counterChance: number;
  weights: MotifWeights;
}

const CHARACTERS: Record<TrackCharacter, CharacterProfile> = {
  flowing: {
    radiusScale: 1.45,
    straightScale: 1.25,
    counterBudget: 120,
    counterChance: 0.32,
    weights: {
      longStraight: 0.18,
      hairpin: 0.08,
      esses: 0.08,
      chicane: 0.05,
      sweeper: 0.22,
      kink: 0.14,
      doubleApex: 0.13,
      squareCorner: 0.12,
    },
  },
  balanced: {
    radiusScale: 1.0,
    straightScale: 1.0,
    counterBudget: 200,
    counterChance: 0.5,
    weights: {
      longStraight: 0.1,
      hairpin: 0.2,
      esses: 0.16,
      chicane: 0.14,
      sweeper: 0.12,
      kink: 0.06,
      doubleApex: 0.12,
      squareCorner: 0.1,
    },
  },
  technical: {
    radiusScale: 0.68,
    straightScale: 0.82,
    counterBudget: 280,
    counterChance: 0.62,
    weights: {
      longStraight: 0.04,
      hairpin: 0.26,
      esses: 0.2,
      chicane: 0.18,
      sweeper: 0.04,
      kink: 0.02,
      doubleApex: 0.14,
      squareCorner: 0.12,
    },
  },
  street: {
    radiusScale: 0.58,
    straightScale: 0.7,
    counterBudget: 320,
    counterChance: 0.72,
    weights: {
      longStraight: 0.02,
      hairpin: 0.2,
      esses: 0.2,
      chicane: 0.24,
      sweeper: 0.02,
      kink: 0,
      doubleApex: 0.18,
      squareCorner: 0.14,
    },
  },
  power: {
    radiusScale: 1.6,
    straightScale: 1.5,
    counterBudget: 110,
    counterChance: 0.3,
    weights: {
      longStraight: 0.26,
      hairpin: 0.18,
      esses: 0.04,
      chicane: 0.04,
      sweeper: 0.24,
      kink: 0.12,
      doubleApex: 0.06,
      squareCorner: 0.06,
    },
  },
  rhythmic: {
    radiusScale: 0.9,
    straightScale: 0.85,
    counterBudget: 220,
    counterChance: 0.55,
    weights: {
      longStraight: 0.04,
      hairpin: 0.12,
      esses: 0.26,
      chicane: 0.2,
      sweeper: 0.08,
      kink: 0.02,
      doubleApex: 0.2,
      squareCorner: 0.08,
    },
  },
  'stop-go': {
    radiusScale: 0.8,
    straightScale: 1.3,
    counterBudget: 160,
    counterChance: 0.4,
    weights: {
      longStraight: 0.2,
      hairpin: 0.28,
      esses: 0.06,
      chicane: 0.1,
      sweeper: 0.02,
      kink: 0.02,
      doubleApex: 0.1,
      squareCorner: 0.22,
    },
  },
};

interface ShapeProfile {
  bayChance: number;
  straightScale: number;
  radiusScale: number;
}

const SHAPES: Record<TrackShape, ShapeProfile> = {
  compact: { bayChance: 0, straightScale: 0.9, radiusScale: 0.96 },
  balanced: { bayChance: 0, straightScale: 1, radiusScale: 1 },
  elongated: { bayChance: 0, straightScale: 1.18, radiusScale: 1.02 },
  round: { bayChance: 0, straightScale: 0.78, radiusScale: 1.12 },
  oval: { bayChance: 0, straightScale: 1.05, radiusScale: 1.04 },
  lobed: { bayChance: 0.6, straightScale: 0.96, radiusScale: 0.9 },
};

const MAX_LAYOUT_ATTEMPTS = 40;
const CLOSING_MAX_DEG = 95;

export function buildMotifLayout(
  stats: CorpusStats,
  rng: Rng,
  options: NovelLayoutOptions = {},
): NovelLayout {
  for (let attempt = 0; attempt < MAX_LAYOUT_ATTEMPTS; attempt++) {
    const layout = attemptLayout(stats, rng, options);
    if (layout) return layout;
  }
  throw new Error('Could not close a motif layout');
}

function attemptLayout(
  stats: CorpusStats,
  rng: Rng,
  options: NovelLayoutOptions,
): NovelLayout | null {
  const profile = CHARACTERS[options.character ?? 'balanced'];
  const shape = SHAPES[options.shape ?? 'balanced'];
  const direction = rng.chance(0.5) ? 1 : -1;
  const targetTurn = direction * 360;
  const segments: RecipeSegment[] = [];
  const push = (segment: RecipeSegment) => segments.push(segment);

  push(makeStraight(clamp(rng.range(420, 820) * profile.straightScale * shape.straightScale, 220, 1100), rng));

  let accumulated = 0;
  let corners = 0;
  let counterLeft = profile.counterBudget;
  let guard = 0;
  const desiredCorners = options.cornerTarget && options.cornerTarget > 0
    ? clamp(Math.round(options.cornerTarget), 6, 36)
    : rng.int(9, 18);

  while (
    (Math.abs(targetTurn - accumulated) > CLOSING_MAX_DEG ||
      corners < desiredCorners - 3) &&
    guard++ < 40 &&
    segments.length < 55
  ) {
    const remaining = targetTurn - accumulated;
    let allowCounter =
      counterLeft > 70 &&
      Math.abs(remaining) > 150 &&
      corners >= 3 &&
      rng.chance(profile.counterChance);
    let motif = makeMotif(stats, rng, allowCounter ? -direction : direction, profile, shape);
    let net = motif.segments.reduce((sum, segment) => sum + segment.turn_deg, 0);

    if (
      allowCounter &&
      (Math.abs(remaining) + Math.abs(net) > 540 || Math.abs(net) > counterLeft)
    ) {
      allowCounter = false;
      motif = makeMotif(stats, rng, direction, profile, shape);
      net = motif.segments.reduce((sum, segment) => sum + segment.turn_deg, 0);
    }

    if (!allowCounter && Math.abs(net) > Math.abs(remaining)) break;

    for (const segment of motif.segments) push(segment);
    accumulated += net;
    corners += motif.segments.filter((segment) => segment.type !== 'straight').length;
    if (allowCounter) counterLeft -= Math.abs(net);
  }

  const remaining = targetTurn - accumulated;
  if (Math.abs(remaining) >= 4) {
    const baseRadius = Math.abs(remaining) > 110 ? rng.range(55, 130) : rng.range(30, 90);
    const radius = clamp(baseRadius * profile.radiusScale * shape.radiusScale, MIN_RADIUS_M, MAX_RADIUS_M);
    push(makeArc(remaining, radius, stats, rng));
  }

  const totalCorners = segments.filter((segment) => segment.type !== 'straight').length;
  if (totalCorners < 5) return null;

  const turns = segments.map((segment) => segment.turn_deg);
  const straightIndices = segments
    .map((segment, index) => (segment.type === 'straight' ? index : -1))
    .filter((index) => index >= 0);

  const lengths = solveStraightLengths(segments, turns, straightIndices);
  if (!lengths) return null;

  for (let i = 0; i < segments.length; i++) segments[i].length = lengths[i];

  const totalLength = segments.reduce((sum, segment) => sum + segment.length, 0);
  if (totalLength < 2200 || totalLength > 14000) return null;

  const dense = buildPolyline(segments, turns, { stepM: 20, maxAngleDeg: 9 });
  if (dense.length > 1) dense[dense.length - 1] = { ...dense[0] };
  const points = dense.map((point) => [point.x, point.y]);
  if (selfIntersects(points)) return null;
  if (!plausibleShape(points, options.shape)) return null;

  return { segments, turnsDeg: turns };
}

const MIN_STRAIGHT_M = 40;
const MAX_STRAIGHT_M = 1300;

function solveStraightLengths(
  segments: readonly RecipeSegment[],
  turns: readonly number[],
  indices: readonly number[],
): number[] | null {
  if (indices.length < 2) return null;

  const headings: number[] = [];
  let heading = 0;
  for (let i = 0; i < segments.length; i++) {
    headings[i] = heading;
    heading += (turns[i] * Math.PI) / 180;
  }

  const position = integrate(segments, turns);
  const lengths = segments.map((segment) => segment.length);
  const fixed = new Map<number, number>();
  let active = indices.slice();

  for (let iteration = 0; iteration < indices.length + 2; iteration++) {
    if (active.length < 2) return null;

    let bx = -position.x;
    let by = -position.y;
    for (const [index, value] of fixed) {
      const delta = value - segments[index].length;
      bx -= Math.cos(headings[index]) * delta;
      by -= Math.sin(headings[index]) * delta;
    }

    const count = active.length;
    let sxx = 0;
    let sxy = 0;
    let syy = 0;
    for (const index of active) {
      const ux = Math.cos(headings[index]);
      const uy = Math.sin(headings[index]);
      sxx += ux * ux;
      sxy += ux * uy;
      syy += uy * uy;
    }

    const spread = sxx * syy - sxy * sxy;
    if (!(spread > 0.06 * count * count)) return null;

    const lambda = 1e-6 * count;
    const a11 = sxx + lambda;
    const a22 = syy + lambda;
    const determinant = a11 * a22 - sxy * sxy;
    if (!(Math.abs(determinant) > 1e-9)) return null;

    const y0 = (a22 * bx - sxy * by) / determinant;
    const y1 = (a11 * by - sxy * bx) / determinant;

    const accepted = new Map<number, number>();
    let violation = false;
    for (const index of active) {
      const delta = Math.cos(headings[index]) * y0 + Math.sin(headings[index]) * y1;
      const value = segments[index].length + delta;
      if (value < MIN_STRAIGHT_M || value > MAX_STRAIGHT_M) {
        fixed.set(index, clamp(value, MIN_STRAIGHT_M, MAX_STRAIGHT_M));
        violation = true;
      } else {
        accepted.set(index, value);
      }
    }

    if (!violation) {
      for (const [index, value] of accepted) lengths[index] = value;
      for (const [index, value] of fixed) lengths[index] = value;
      return lengths;
    }

    active = [...accepted.keys()];
  }

  return null;
}

function makeMotif(
  stats: CorpusStats,
  rng: Rng,
  side: number,
  profile: CharacterProfile,
  shape: ShapeProfile,
): Motif {
  const weights = profile.weights;
  let motif: Motif;

  if (shape.bayChance > 0 && rng.chance(shape.bayChance)) {
    motif = bay(stats, rng);
  } else {
    let roll = rng.next();
    if ((roll -= weights.longStraight) < 0) motif = longStraight(rng);
    else if ((roll -= weights.hairpin) < 0) motif = hairpin(stats, rng);
    else if ((roll -= weights.esses) < 0) motif = esses(stats, rng);
    else if ((roll -= weights.chicane) < 0) motif = chicane(stats, rng);
    else if ((roll -= weights.sweeper) < 0) motif = sweeper(stats, rng);
    else if ((roll -= weights.kink) < 0) motif = kink(stats, rng);
    else if ((roll -= weights.doubleApex) < 0) motif = doubleApex(stats, rng);
    else motif = squareCorner(stats, rng);
  }

  applyProfile(motif, profile, shape, stats, rng);

  if (side < 0) {
    for (const segment of motif.segments) segment.turn_deg = -segment.turn_deg;
  }
  return motif;
}

function applyProfile(
  motif: Motif,
  profile: CharacterProfile,
  shape: ShapeProfile,
  stats: CorpusStats,
  rng: Rng,
): void {
  const radiusScale = profile.radiusScale * shape.radiusScale;
  const straightScale = profile.straightScale * shape.straightScale;

  for (const segment of motif.segments) {
    if (segment.type === 'straight') {
      if (straightScale !== 1) {
        segment.length = clamp(segment.length * straightScale, 20, 1200);
      }
      continue;
    }

    const radius = clamp(segment.r_min * radiusScale, MIN_RADIUS_M, MAX_RADIUS_M);
    segment.r_min = radius;
    segment.length = ((Math.abs(segment.turn_deg) * Math.PI) / 180) * radius;
    segment.speed = speedForRadius(stats, radius, rng, 0.03);
    segment.type = cornerTypeForSpeed(segment.speed, stats);
  }
}

function longStraight(rng: Rng): Motif {
  return {
    segments: [makeStraight(rng.range(350, 900), rng)],
  };
}

function hairpin(stats: CorpusStats, rng: Rng): Motif {
  return {
    segments: [
      makeStraight(rng.range(110, 300), rng),
      makeArc(rng.range(155, 180), rng.range(24, 40), stats, rng),
    ],
  };
}

function esses(stats: CorpusStats, rng: Rng): Motif {
  return {
    segments: [
      makeArc(rng.range(35, 60), rng.range(35, 80), stats, rng),
      makeStraight(rng.range(25, 60), rng),
      makeArc(-rng.range(30, 50), rng.range(40, 85), stats, rng),
      makeStraight(rng.range(25, 60), rng),
      makeArc(rng.range(30, 55), rng.range(35, 80), stats, rng),
    ],
  };
}

function chicane(stats: CorpusStats, rng: Rng): Motif {
  return {
    segments: [
      makeStraight(rng.range(100, 280), rng),
      makeArc(rng.range(15, 30), rng.range(70, 150), stats, rng),
      makeStraight(rng.range(18, 42), rng),
      makeArc(-rng.range(15, 30), rng.range(70, 150), stats, rng),
    ],
  };
}

function sweeper(stats: CorpusStats, rng: Rng): Motif {
  return {
    segments: [makeArc(rng.range(55, 110), rng.range(110, 300), stats, rng)],
  };
}

function kink(stats: CorpusStats, rng: Rng): Motif {
  return {
    segments: [
      makeStraight(rng.range(250, 600), rng),
      makeArc(rng.range(7, 18), rng.range(260, 800), stats, rng),
    ],
  };
}

function doubleApex(stats: CorpusStats, rng: Rng): Motif {
  return {
    segments: [
      makeArc(rng.range(30, 52), rng.range(35, 72), stats, rng),
      makeStraight(rng.range(10, 26), rng),
      makeArc(rng.range(28, 48), rng.range(35, 72), stats, rng),
    ],
  };
}

function squareCorner(stats: CorpusStats, rng: Rng): Motif {
  return {
    segments: [
      makeStraight(rng.range(100, 280), rng),
      makeArc(rng.range(72, 98), rng.range(30, 62), stats, rng),
    ],
  };
}

function bay(stats: CorpusStats, rng: Rng): Motif {
  return { segments: makeBay(stats, rng) };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
