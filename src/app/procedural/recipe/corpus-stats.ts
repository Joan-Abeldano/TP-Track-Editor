import { CornerType } from '../../models/track.model';
import { CorpusTrack } from '../corpus/corpus.types';
import { Rng } from '../rng';

export interface CorpusStats {
  typeWeights: Array<{ type: CornerType; weight: number }>;
  turns: Record<string, number[]>;
  radii: Record<string, number[]>;
  lengths: Record<string, number[]>;
  speedLaw: { a: number; b: number };
  thresholds: [number, number];
}

export function speedForRadius(
  stats: CorpusStats,
  radius: number,
  rng: Rng,
  jitter = 0.05,
): number {
  const raw = stats.speedLaw.a * Math.pow(Math.max(12, radius), stats.speedLaw.b);
  return clamp(raw * rng.range(1 - jitter, 1 + jitter), 55, 430);
}

export function cornerTypeForSpeed(speed: number, stats: CorpusStats): CornerType {
  if (speed < stats.thresholds[0]) return 'low';
  if (speed < stats.thresholds[1]) return 'med';
  return 'high';
}

export function buildStats(tracks: readonly CorpusTrack[]): CorpusStats {
  const counts = new Map<CornerType, number>();
  const turns: Record<string, number[]> = {};
  const radii: Record<string, number[]> = {};
  const lengths: Record<string, number[]> = {};
  const speedSamples: Array<[number, number]> = [];

  for (const track of tracks) {
    for (const segment of track.sequence) {
      counts.set(segment.type, (counts.get(segment.type) ?? 0) + 1);
      (turns[segment.type] ??= []).push(Math.abs(segment.turn_deg));
      (radii[segment.type] ??= []).push(radiusOf(segment.length, segment.turn_deg));
      (lengths[segment.type] ??= []).push(segment.length);

      if (segment.type !== 'straight') {
        const radius = radiusOf(segment.length, segment.turn_deg);
        if (radius > 6 && radius < 2000 && segment.speed > 20) {
          speedSamples.push([Math.log(radius), Math.log(segment.speed)]);
        }
      }
    }
  }

  const total = [...counts.values()].reduce((sum, value) => sum + value, 0) || 1;
  const typeWeights = [...counts.entries()].map(([type, weight]) => ({
    type,
    weight: weight / total,
  }));

  return {
    typeWeights,
    turns,
    radii,
    lengths,
    speedLaw: fitSpeedLaw(speedSamples),
    thresholds: [140, 195],
  };
}

function fitSpeedLaw(samples: readonly [number, number][]): { a: number; b: number } {
  if (samples.length < 16) return { a: 42.77, b: 0.281 };

  let meanX = 0;
  let meanY = 0;
  for (const [x, y] of samples) {
    meanX += x;
    meanY += y;
  }
  meanX /= samples.length;
  meanY /= samples.length;

  let numerator = 0;
  let denominator = 0;
  for (const [x, y] of samples) {
    numerator += (x - meanX) * (y - meanY);
    denominator += (x - meanX) * (x - meanX);
  }
  if (denominator < 1e-9) return { a: 42.77, b: 0.281 };

  const b = clamp(numerator / denominator, 0.18, 0.6);
  const a = Math.exp(meanY - b * meanX);
  return { a, b };
}

function radiusOf(length: number, turnDeg: number): number {
  const radians = (Math.abs(turnDeg) * Math.PI) / 180;
  return radians > 1e-4 ? length / radians : 1500;
}

export function sampleCorpusValue(
  values: readonly number[] | undefined,
  rng: Rng,
  minScale: number,
  maxScale: number,
  fallback: number,
): number {
  if (!values || values.length === 0) return fallback;
  return rng.pick(values) * rng.range(minScale, maxScale);
}

export function pickWeighted(
  weights: readonly { type: CornerType; weight: number }[],
  rng: Rng,
): CornerType {
  let roll = rng.next();
  for (const entry of weights) {
    roll -= entry.weight;
    if (roll <= 0) return entry.type;
  }
  return weights[weights.length - 1]?.type ?? 'high';
}

export type TypeBias = Partial<Record<CornerType, number>>;

export function pickWeightedWithBias(
  weights: readonly { type: CornerType; weight: number }[],
  bias: TypeBias,
  rng: Rng,
): CornerType {
  let total = 0;
  const scaled = weights.map((entry) => {
    const weight = entry.weight * Math.max(0, bias[entry.type] ?? 1);
    total += weight;
    return { type: entry.type, weight };
  });
  if (!(total > 0)) return pickWeighted(weights, rng);

  let roll = rng.next() * total;
  for (const entry of scaled) {
    roll -= entry.weight;
    if (roll <= 0) return entry.type;
  }
  return scaled[scaled.length - 1]?.type ?? 'high';
}

const NAME_ROOTS = [
  'Val', 'Cor', 'Mar', 'Bel', 'Tar', 'Kel', 'Nor', 'Aur', 'Sil', 'Dra',
  'Ver', 'Lun', 'Ast', 'Rav', 'Mon', 'Ser', 'Cal', 'Vin', 'Tor', 'Hal',
  'Est', 'Ard', 'Bra', 'Cen', 'Dor', 'Fen', 'Gal', 'Ish', 'Jur', 'Kae',
  'Lor', 'Mir', 'Ost', 'Pel', 'Quin', 'Ros', 'Sal', 'Tav', 'Ura', 'Vel',
];

const NAME_SUFFIXES = [
  'dale', 'mont', 'field', 'wood', 'haven', 'ridge', 'vale', 'brook',
  'crest', 'glen', 'hollow', 'reach', 'moor', 'point', 'gate', 'hurst',
  'ford', 'cliff', 'marsh', 'stead',
];

const NAME_KINDS = ['Circuit', 'Raceway', 'Park', 'Ring'];

export function novelName(rng: Rng): string {
  let name = rng.pick(NAME_ROOTS) + rng.pick(NAME_SUFFIXES);
  if (rng.chance(0.35)) {
    name += ` ${rng.pick(['Grand', 'International', 'National', 'Coastal', 'Highland', 'Lakeside'])}`;
  }
  return `${name} ${rng.pick(NAME_KINDS)}`;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
