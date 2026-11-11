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
  pickWeightedWithBias,
  sampleCorpusValue,
  TypeBias,
} from './corpus-stats';
import { makeArc, makeBay, makeStraight } from './novel-segments';
import { buildPolyline, closeLoop } from '../geometry/arc-builder';
import { selfIntersects } from '../geometry/self-intersection';
import { plausibleShape } from '../geometry/shape-quality';

interface CharacterProfile {
  radiusScale: number;
  straightScale: number;
  turnScale: number;
  sameDirectionChance: number;
  typeBias: TypeBias;
}

const CHARACTERS: Record<TrackCharacter, CharacterProfile> = {
  flowing: {
    radiusScale: 1.4,
    straightScale: 1.25,
    turnScale: 0.85,
    sameDirectionChance: 0.78,
    typeBias: { straight: 1.35, high: 1.5, med: 1, low: 0.6 },
  },
  balanced: {
    radiusScale: 1.0,
    straightScale: 1.0,
    turnScale: 1.0,
    sameDirectionChance: 0.65,
    typeBias: {},
  },
  technical: {
    radiusScale: 0.72,
    straightScale: 0.82,
    turnScale: 1.15,
    sameDirectionChance: 0.58,
    typeBias: { straight: 0.6, high: 0.6, med: 1.25, low: 1.6 },
  },
  street: {
    radiusScale: 0.6,
    straightScale: 0.7,
    turnScale: 1.2,
    sameDirectionChance: 0.5,
    typeBias: { straight: 0.45, high: 0.35, med: 1.2, low: 2 },
  },
  power: {
    radiusScale: 1.5,
    straightScale: 1.45,
    turnScale: 0.85,
    sameDirectionChance: 0.8,
    typeBias: { straight: 1.6, high: 1.7, med: 0.9, low: 0.5 },
  },
  rhythmic: {
    radiusScale: 0.9,
    straightScale: 0.8,
    turnScale: 1.05,
    sameDirectionChance: 0.45,
    typeBias: { straight: 0.7, high: 0.9, med: 1.5, low: 1.1 },
  },
  'stop-go': {
    radiusScale: 0.8,
    straightScale: 1.35,
    turnScale: 1.05,
    sameDirectionChance: 0.7,
    typeBias: { straight: 1.4, high: 0.7, med: 0.8, low: 1.5 },
  },
};

interface ShapeProfile {
  directionBias: number;
  straightScale: number;
  radiusScale: number;
  bayChance: number;
}

const SHAPES: Record<TrackShape, ShapeProfile> = {
  compact: { directionBias: -0.12, straightScale: 0.9, radiusScale: 0.96, bayChance: 0 },
  balanced: { directionBias: 0, straightScale: 1, radiusScale: 1, bayChance: 0 },
  elongated: { directionBias: 0.12, straightScale: 1.18, radiusScale: 1.02, bayChance: 0 },
  round: { directionBias: -0.05, straightScale: 0.78, radiusScale: 1.12, bayChance: 0 },
  oval: { directionBias: 0.08, straightScale: 1.05, radiusScale: 1.04, bayChance: 0 },
  lobed: { directionBias: -0.02, straightScale: 0.94, radiusScale: 0.86, bayChance: 0.6 },
};

const MAX_LAYOUT_ATTEMPTS = 50;

export function buildStatisticalLayout(
  stats: CorpusStats,
  rng: Rng,
  options: NovelLayoutOptions = {},
): NovelLayout {
  for (let attempt = 0; attempt < MAX_LAYOUT_ATTEMPTS; attempt++) {
    const segments = sampleSequence(stats, rng, options);
    if (!segments) continue;

    const closure = closeLoop(segments, segments.map((segment) => segment.turn_deg));
    if (!(closure.error <= 0.5) || closure.maxCorrectionDeg > 12) continue;

    const turned = segments.map((segment, index) => ({
      ...segment,
      turn_deg: closure.turnsDeg[index],
    }));

    const dense = buildPolyline(turned, closure.turnsDeg, {
      stepM: 20,
      maxAngleDeg: 9,
    });
    if (dense.length > 1) dense[dense.length - 1] = { ...dense[0] };
    const points = dense.map((point) => [point.x, point.y]);
    if (selfIntersects(points)) continue;
    if (!plausibleShape(points, options.shape)) continue;

    return { segments: turned, turnsDeg: closure.turnsDeg };
  }
  throw new Error('Could not close a statistical layout');
}

function sampleSequence(
  stats: CorpusStats,
  rng: Rng,
  options: NovelLayoutOptions,
): RecipeSegment[] | null {
  const character = CHARACTERS[options.character ?? 'balanced'];
  const shape = SHAPES[options.shape ?? 'balanced'];
  const targetCorners = options.cornerTarget && options.cornerTarget > 0
    ? Math.round(clamp(options.cornerTarget, 6, 36))
    : rng.int(9, 18);
  const direction = rng.chance(0.5) ? 1 : -1;
  const sameDirectionChance = clamp(
    character.sameDirectionChance + shape.directionBias,
    0.42,
    0.86,
  );
  const straightScale = character.straightScale * shape.straightScale;
  const segments: RecipeSegment[] = [
    makeStraight(
      clamp(rng.range(240, 520) * straightScale, 160, 900),
      rng,
    ),
  ];

  let corners = 0;
  let guard = 0;
  while (corners < targetCorners && guard++ < targetCorners * 4 && segments.length < targetCorners * 3) {
    const type = pickWeightedWithBias(stats.typeWeights, character.typeBias, rng);

    if (type === 'straight') {
      const length = clamp(
        sampleCorpusValue(stats.lengths['straight'], rng, 0.8, 1.4, 300) *
          straightScale,
        40,
        1200,
      );
      segments.push(makeStraight(length, rng));
      continue;
    }

    const turn = clamp(
      sampleCorpusValue(stats.turns[type], rng, 0.8, 1.25, 45) * character.turnScale,
      6,
      170,
    );
    const radius = clamp(
      sampleCorpusValue(stats.radii[type], rng, 0.85, 1.2, 90) *
        character.radiusScale *
        shape.radiusScale,
      18,
      1200,
    );
    const sign = rng.chance(sameDirectionChance) ? direction : -direction;
    const turnRad = (turn * Math.PI) / 180;
    const adjustedRadius = Math.max(radius, 20 / turnRad);
    segments.push(makeArc(sign * turn, adjustedRadius, stats, rng));
    corners++;
  }

  const netTurn = segments.reduce((sum, segment) => sum + segment.turn_deg, 0);
  if (Math.abs(netTurn) < 240) return null;

  const factor = (netTurn < 0 ? -360 : 360) / netTurn;
  for (const segment of segments) {
    if (segment.turn_deg === 0) continue;
    segment.turn_deg *= factor;
    segment.length =
      ((Math.abs(segment.turn_deg) * Math.PI) / 180) * segment.r_min;
  }

  if (shape.bayChance > 0) {
    const bayCount = Math.max(
      2,
      Math.round(
        targetCorners *
          shape.bayChance *
          (0.4 + character.straightScale * 0.25),
      ),
    );
    for (let i = 0; i < bayCount; i++) {
      const at = 2 + Math.floor(rng.next() * Math.max(1, segments.length - 3));
      segments.splice(at, 0, ...makeBay(stats, rng));
    }
  }

  return segments;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
