import { CorpusFile, CorpusTrack } from '../corpus/corpus.types';
import { Rng } from '../rng';
import { deformPoints } from '../geometry/deform';
import { selfIntersects } from '../geometry/self-intersection';
import {
  ProceduralOptions,
  NovelLayout,
  NovelLayoutOptions,
  NovelStyle,
  RecipeMeta,
  RecipeSegment,
  TrackCharacter,
  TrackShape,
  TrackRecipe,
} from './recipe.types';
import {
  buildStats,
  CorpusStats,
  cornerTypeForSpeed,
  novelName,
  speedForRadius,
} from './corpus-stats';
import { buildMotifLayout } from './motif-layout';
import { buildStatisticalLayout } from './statistical-layout';
import { shapeMatchScore } from '../geometry/shape-quality';

const MIN_POINTS = 8;

const DEFAULT_META: RecipeMeta = {
  tyre_wear_mult: 1.0,
  fuel_consumption: 1.0,
  dnf_modifier: 1.0,
  lap_modifier: 1.2,
  overtaking_difficulty: 1.1,
  pit_lane_loss_s: 20.0,
  wet_weather_probability_multiplier: 2.0,
  sector_splits: [0.30, 0.68],
  nationality: 'custom',
  racing_surface: {
    enabled: true,
    mode: 'road_course',
    width_m: 12.0,
    edge_margin_m: 0.6,
    corridor_count: 3,
    visual_lateral_scale: 2.0,
  },
  starting_grid: {
    pole_side: 'left',
    row_spacing_m: 10.0,
    column_spacing_m: 3.0,
    stagger_m: 2.0,
  },
};

export function generateRecipe(
  corpus: CorpusFile,
  options: ProceduralOptions,
  rng: Rng,
): TrackRecipe {
  const mode = options.mode ?? 'novel';
  if (mode === 'novel') return generateNovelRecipe(corpus, options, rng);

  const candidates = corpus.tracks.filter(
    (track) =>
      track.sequence.length >= 6 &&
      track.points.length >= MIN_POINTS &&
      track.length_m > 800 &&
      track.self_intersects !== true &&
      Math.abs(Math.abs(track.net_turn_deg) - 360) < 5,
  );
  if (candidates.length === 0) {
    throw new Error('No usable corpus track found');
  }

  const parent = pickParent(candidates, options, rng);

  let segments: RecipeSegment[];
  let geometry: number[][];
  let sourceName = parent.name;
  let sourceId = parent.id;

  if (mode === 'clone') {
    segments = parent.sequence.map((segment) => ({ ...segment }));
    geometry = parent.points.map(([x, y]) => [x, y]);
  } else if (mode === 'mutate') {
    segments = mutateSequence(parent.sequence, options.variation ?? 0.12, rng);
    geometry = deformPoints(parent.points, rng, options.variation ?? 0.12);
  } else {
    const splice = buildSplice(candidates, parent, options.variation ?? 0.18, rng);
    segments = splice.segments;
    geometry = splice.points;
    sourceName = `${parent.name} × ${splice.otherName}`;
    sourceId = `${parent.id}+${splice.otherId}`;
  }

  segments = mergeAdjacentStraights(segments);

  const targetM = options.targetLengthKm && options.targetLengthKm > 0
    ? options.targetLengthKm * 1000
    : undefined;
  const sourceLength = totalLength(segments);
  const length = targetM ?? (mode === 'splice' ? clamp(sourceLength, 2500, 10000) : sourceLength);
  if (length < 1000 || length > 30000) {
    throw new Error(`Generated length ${(length / 1000).toFixed(1)} km is out of range`);
  }
  scaleLengths(segments, length);

  const meta = applyMetaOverrides(
    buildMeta(
      parent,
      options.mode === 'clone' ? 0 : 0.06 + (options.variation ?? 0.12) * 0.35,
      length / parent.length_m,
      rng,
    ),
    options,
  );

  return {
    sourceId,
    sourceName,
    segments,
    length_m: totalLength(segments),
    meta,
    geometry,
    drsCountHint: parent.drs.length,
  };
}

function generateNovelRecipe(
  corpus: CorpusFile,
  options: ProceduralOptions,
  rng: Rng,
): TrackRecipe {
  const usable = corpus.tracks.filter(
    (track) =>
      track.sequence.length >= 6 &&
      track.length_m > 800 &&
      track.self_intersects !== true,
  );
  if (usable.length === 0) {
    throw new Error('No usable corpus track found');
  }

  const stats = buildStats(usable);
  const style: NovelStyle = options.style ?? 'motifs';
  const layoutOptions = {
    cornerTarget: options.cornerCount,
    character: options.character,
    shape: options.shape,
  };
  const layout = buildNovelLayout(style, stats, rng, layoutOptions);

  if (layout.segments.length === 0) {
    throw new Error('Novel layout produced no segments');
  }

  const donor = rng.pick(usable);
  const natural = totalLength(layout.segments);
  const targetM = options.targetLengthKm && options.targetLengthKm > 0
    ? options.targetLengthKm * 1000
    : undefined;
  const length = targetM ?? clamp(natural, 2400, 9500);
  if (length < 1000 || length > 30000) {
    throw new Error(`Generated length ${(length / 1000).toFixed(1)} km is out of range`);
  }

  const scale = length / natural;
  scaleLengths(layout.segments, length);
  if (Math.abs(scale - 1) > 0.02) {
    rescaleCorners(layout.segments, scale, stats, rng);
  }

  const meta = applyMetaOverrides(buildMeta(donor, 0.14, length / donor.length_m, rng), options);
  const longStraights = layout.segments.filter(
    (segment) => segment.type === 'straight' && segment.length >= 380,
  ).length;

  return {
    sourceId: `novel:${style}`,
    sourceName: options.name ?? novelName(rng),
    segments: layout.segments,
    length_m: totalLength(layout.segments),
    meta,
    turnsDeg: layout.turnsDeg,
    drsCountHint: Math.min(3, longStraights),
  };
}

function buildNovelLayout(
  style: NovelStyle,
  stats: CorpusStats,
  rng: Rng,
  options: NovelLayoutOptions,
): NovelLayout {
  const motifs = () => buildMotifLayout(stats, rng, options);
  const statistical = () => buildStatisticalLayout(stats, rng, options);
  const [preferred, fallback] = style === 'statistical'
    ? [statistical, motifs]
    : [motifs, statistical];

  try {
    return preferred();
  } catch {
    return fallback();
  }
}

function rescaleCorners(
  segments: RecipeSegment[],
  scale: number,
  stats: CorpusStats,
  rng: Rng,
): void {
  for (const segment of segments) {
    if (segment.type === 'straight') continue;
    segment.r_min *= scale;
    segment.speed = speedForRadius(stats, segment.r_min, rng, 0.02);
    segment.type = cornerTypeForSpeed(segment.speed, stats);
  }
}

function pickParent(
  candidates: CorpusTrack[],
  options: ProceduralOptions,
  rng: Rng,
): CorpusTrack {
  if (options.sourceId) {
    const forced = candidates.find((track) => track.id === options.sourceId);
    if (!forced) throw new Error(`Unknown source track "${options.sourceId}"`);
    return forced;
  }

  let pool = candidates;

  if (options.cornerCount && options.cornerCount > 0) {
    const target = options.cornerCount;
    const scored = pool.map((track) => ({
      track,
      distance: Math.abs(cornerCount(track.sequence) - target),
    }));
    const best = Math.min(...scored.map((s) => s.distance));
    pool = scored.filter((s) => s.distance <= best + 3).map((s) => s.track);
  }

  const targetLength = options.targetLengthKm && options.targetLengthKm > 0
    ? options.targetLengthKm * 1000
    : null;
  if (targetLength !== null) {
    const filtered = pool.filter(
      (track) => track.length_m >= targetLength * 0.55 && track.length_m <= targetLength * 1.7,
    );
    if (filtered.length >= 3) pool = filtered;
  }

  pool = preferByStyle(pool, options);

  return rng.pick(pool);
}

function preferByStyle(pool: CorpusTrack[], options: ProceduralOptions): CorpusTrack[] {
  let result = pool;

  const character = options.character ?? 'balanced';
  if (character !== 'balanced') {
    result = topScored(result, (track) => characterScore(track, character));
  }

  const shape = options.shape ?? 'balanced';
  if (shape !== 'balanced') {
    result = topScored(result, (track) => shapeMatchScore(track.points, shape));
  }

  return result;
}

function topScored(
  pool: CorpusTrack[],
  score: (track: CorpusTrack) => number,
): CorpusTrack[] {
  if (pool.length <= 8) return pool;
  const scored = pool.map((track) => ({ track, score: score(track) }));
  scored.sort((a, b) => b.score - a.score);
  const keep = Math.max(8, Math.ceil(pool.length * 0.35));
  return scored.slice(0, keep).map((entry) => entry.track);
}

interface TrackSignature {
  lowShare: number;
  medShare: number;
  highShare: number;
  meanSpeed: number;
  speedSpread: number;
  longestStraight: number;
  straightShare: number;
  signChangeRate: number;
  cornerDensity: number;
}

const signatureCache = new WeakMap<CorpusTrack, TrackSignature>();

function signature(track: CorpusTrack): TrackSignature {
  const cached = signatureCache.get(track);
  if (cached) return cached;

  const corners = track.sequence.filter((segment) => segment.type !== 'straight');
  let low = 0;
  let med = 0;
  let high = 0;
  let speedSum = 0;
  let minSpeed = Infinity;
  let maxSpeed = -Infinity;
  let longestStraight = 0;
  let straightLength = 0;
  let totalLength = 0;
  let previousSign = 0;
  let transitions = 0;
  let changes = 0;

  for (const segment of track.sequence) {
    totalLength += segment.length;
    if (segment.type === 'straight') {
      straightLength += segment.length;
      longestStraight = Math.max(longestStraight, segment.length);
      continue;
    }
    if (segment.type === 'low') low++;
    else if (segment.type === 'med') med++;
    else high++;

    speedSum += segment.speed;
    minSpeed = Math.min(minSpeed, segment.speed);
    maxSpeed = Math.max(maxSpeed, segment.speed);

    const sign = Math.sign(segment.turn_deg);
    if (sign !== 0) {
      if (previousSign !== 0) {
        transitions++;
        if (sign !== previousSign) changes++;
      }
      previousSign = sign;
    }
  }

  const count = corners.length || 1;
  const meanSpeed = speedSum / count;
  const result: TrackSignature = {
    lowShare: low / count,
    medShare: med / count,
    highShare: high / count,
    meanSpeed,
    speedSpread: meanSpeed > 0 && Number.isFinite(minSpeed)
      ? (maxSpeed - minSpeed) / meanSpeed
      : 0,
    longestStraight,
    straightShare: totalLength > 0 ? straightLength / totalLength : 0,
    signChangeRate: transitions > 0 ? changes / transitions : 0,
    cornerDensity: corners.length / Math.max(0.5, track.length_m / 1000),
  };
  signatureCache.set(track, result);
  return result;
}

function characterScore(track: CorpusTrack, character: TrackCharacter): number {
  const s = signature(track);
  switch (character) {
    case 'technical':
      return (
        s.lowShare * 2 +
        s.medShare * 0.6 +
        Math.min(s.cornerDensity, 25) * 0.04 +
        s.signChangeRate * 0.3 -
        s.meanSpeed / 400
      );
    case 'flowing':
      return (
        s.highShare * 1.5 +
        s.meanSpeed / 400 +
        s.longestStraight / 1200 +
        s.straightShare * 0.8 -
        s.lowShare
      );
    case 'power':
      return (
        s.highShare * 1.2 +
        s.longestStraight / 800 +
        s.straightShare * 1.2 -
        s.lowShare * 0.5
      );
    case 'street':
      return (
        s.lowShare * 1.8 +
        Math.min(s.cornerDensity, 30) * 0.06 +
        s.signChangeRate * 0.5 +
        (1 - s.straightShare) * 0.5 -
        s.longestStraight / 1500
      );
    case 'rhythmic':
      return (
        s.signChangeRate * 1.5 +
        s.speedSpread * 0.8 +
        s.medShare * 0.8
      );
    case 'stop-go':
      return (
        s.lowShare * 1.2 +
        s.longestStraight / 900 +
        s.straightShare * 0.8
      );
    case 'balanced':
    default:
      return 0;
  }
}

function cornerCount(sequence: readonly RecipeSegment[]): number {
  return sequence.reduce((count, segment) => count + (segment.type === 'straight' ? 0 : 1), 0);
}

function mutateSequence(
  sequence: readonly RecipeSegment[],
  variation: number,
  rng: Rng,
): RecipeSegment[] {
  const v = clamp(variation, 0, 0.4);
  const turnJitter = 1.5 + v * 22;
  return sequence.map((segment) => {
    const turn = segment.turn_deg + rng.range(-turnJitter, turnJitter);
    const length = Math.max(15, segment.length * (1 + rng.range(-v, v)));
    return {
      ...segment,
      length,
      turn_deg: turn,
      speed: Math.max(40, segment.speed * (1 + rng.range(-v * 0.2, v * 0.2))),
      r_min: turnToRadius(length, turn),
    };
  });
}

interface SpliceResult {
  segments: RecipeSegment[];
  points: number[][];
  otherName: string;
  otherId: string;
}

interface SpliceCandidate extends SpliceResult {
  score: number;
}

function buildSplice(
  candidates: CorpusTrack[],
  parent: CorpusTrack,
  variation: number,
  rng: Rng,
): SpliceResult {
  const pool = candidates.filter((track) => track.id !== parent.id);
  const a = parent.points;
  let best: SpliceCandidate | null = null;

  for (let attempt = 0; attempt < 90; attempt++) {
    const other = rng.pick(pool);
    const b = other.points;
    if (a.length < 5 || b.length < 5) continue;

    const i = pickCutIndex(a, rng);
    const j = pickCutIndex(b, rng);

    const a0 = a[0];
    const ai = a[i];
    const b0 = b[0];
    const bj = b[j];

    const br = bj[0] - b0[0];
    const bi = bj[1] - b0[1];
    const ar = ai[0] - a0[0];
    const ay = ai[1] - a0[1];
    const denominator = br * br + bi * bi;
    if (denominator < 1e-6) continue;

    const cr = (ar * br + ay * bi) / denominator;
    const ci = (ay * br - ar * bi) / denominator;
    const scale = Math.hypot(cr, ci);
    if (scale < 0.45 || scale > 2.4) continue;

    const suffix = b.slice(j).map(([x, y]): number[] => {
      const dx = x - b0[0];
      const dy = y - b0[1];
      return [
        a0[0] + cr * dx - ci * dy,
        a0[1] + ci * dx + cr * dy,
      ];
    });
    if (suffix.length < 3) continue;
    suffix[suffix.length - 1] = [a0[0], a0[1]];

    const points = [...a.slice(0, i + 1).map(([x, y]) => [x, y]), ...suffix.slice(1)];
    points[points.length - 1] = [points[0][0], points[0][1]];
    if (selfIntersects(points)) continue;

    const fractionA = fractionAt(a, i);
    const fractionB = fractionAt(b, j);
    const head = splitSequence(parent.sequence, fractionA).head;
    const tail = splitSequence(other.sequence, fractionB).tail.map((segment) => ({
      ...segment,
      length: segment.length * scale,
    }));
    const segments = [...head, ...tail];
    if (segments.length < 5) continue;

    const rotation = Math.atan2(ci, cr);
    const score = seamMismatch(a, b, i, j, rotation);
    if (!best || score < best.score) {
      best = {
        segments,
        points,
        otherName: other.name,
        otherId: other.id,
        score,
      };
    }
    if (score < 0.35) break;
  }

  if (best) {
    return {
      segments: best.segments,
      points: best.points,
      otherName: best.otherName,
      otherId: best.otherId,
    };
  }

  return {
    segments: mutateSequence(parent.sequence, variation, rng),
    points: deformPoints(parent.points, rng, variation),
    otherName: 'variant',
    otherId: parent.id,
  };
}

function pickCutIndex(points: number[][], rng: Rng): number {
  const min = Math.max(1, Math.floor((points.length - 1) * 0.28));
  const max = Math.max(min + 1, Math.floor((points.length - 1) * 0.72));
  let bestIndex = rng.int(min, max);
  let bestTurn = Infinity;

  for (let attempt = 0; attempt < 5; attempt++) {
    const index = rng.int(min, max);
    const turn = localTurn(points, index);
    if (turn < bestTurn) {
      bestTurn = turn;
      bestIndex = index;
    }
    if (turn < 0.25) break;
  }
  return bestIndex;
}

function localTurn(points: number[][], index: number): number {
  const previous = points[Math.max(0, index - 1)];
  const current = points[index];
  const next = points[Math.min(points.length - 1, index + 1)];
  const incoming = Math.atan2(current[1] - previous[1], current[0] - previous[0]);
  const outgoing = Math.atan2(next[1] - current[1], next[0] - current[0]);
  return angleDifference(incoming, outgoing);
}

function seamMismatch(
  a: number[][],
  b: number[][],
  i: number,
  j: number,
  rotation: number,
): number {
  const incomingA = tangent(a, i - 1, i);
  const outgoingB = tangent(b, j, j + 1) + rotation;
  const seam = angleDifference(incomingA, outgoingB);

  const lastB = b.length - 1;
  const incomingB = tangent(b, lastB - 1, lastB) + rotation;
  const outgoingA = tangent(a, 0, 1);
  const finish = angleDifference(incomingB, outgoingA);

  return seam + finish * 0.6;
}

function tangent(points: number[][], from: number, to: number): number {
  const a = points[clampIndex(from, points.length)];
  const b = points[clampIndex(to, points.length)];
  return Math.atan2(b[1] - a[1], b[0] - a[0]);
}

function clampIndex(index: number, length: number): number {
  return Math.max(0, Math.min(length - 1, index));
}

function angleDifference(a: number, b: number): number {
  let difference = Math.abs(a - b) % (Math.PI * 2);
  if (difference > Math.PI) difference = Math.PI * 2 - difference;
  return difference;
}

function fractionAt(points: number[][], index: number): number {
  let total = 0;
  let upTo = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const distance = Math.hypot(
      points[i + 1][0] - points[i][0],
      points[i + 1][1] - points[i][1],
    );
    total += distance;
    if (i < index) upTo += distance;
  }
  return total > 0 ? upTo / total : 0;
}

function splitSequence(
  sequence: readonly RecipeSegment[],
  fraction: number,
): { head: RecipeSegment[]; tail: RecipeSegment[] } {
  const total = totalLength(sequence);
  const target = clamp(fraction, 0, 1) * total;
  const head: RecipeSegment[] = [];
  const tail: RecipeSegment[] = [];
  let cumulative = 0;

  for (const segment of sequence) {
    const next = cumulative + segment.length;
    if (next <= target + 1e-6) {
      head.push({ ...segment });
    } else if (cumulative >= target - 1e-6) {
      tail.push({ ...segment });
    } else {
      const t = segment.length > 0 ? (target - cumulative) / segment.length : 0;
      head.push({
        ...segment,
        length: segment.length * t,
        turn_deg: segment.turn_deg * t,
      });
      tail.push({
        ...segment,
        length: segment.length * (1 - t),
        turn_deg: segment.turn_deg * (1 - t),
      });
    }
    cumulative = next;
  }

  return { head, tail };
}

function mergeAdjacentStraights(sequence: RecipeSegment[]): RecipeSegment[] {
  const out: RecipeSegment[] = [];
  for (const source of sequence) {
    const segment = { ...source };
    const previous = out[out.length - 1];
    if (previous && previous.type === 'straight' && segment.type === 'straight') {
      const length = previous.length + segment.length;
      previous.speed = length > 0
        ? (previous.speed * previous.length + segment.speed * segment.length) / length
        : previous.speed;
      previous.length = length;
      previous.turn_deg += segment.turn_deg;
      previous.r_min = Math.min(previous.r_min, segment.r_min);
    } else if (segment.length > 0) {
      out.push(segment);
    }
  }

  const cleaned: RecipeSegment[] = [];
  for (const segment of out) {
    const previous = cleaned[cleaned.length - 1];
    if (previous && segment.length < 12) {
      previous.length += segment.length;
      previous.turn_deg += segment.turn_deg;
      previous.speed = (previous.speed + segment.speed) / 2;
    } else {
      cleaned.push(segment);
    }
  }
  return cleaned;
}

function scaleLengths(sequence: RecipeSegment[], targetM: number): void {
  const current = totalLength(sequence);
  if (current <= 0) throw new Error('Degenerate corner sequence (zero length)');
  const factor = targetM / current;
  for (const segment of sequence) segment.length *= factor;
}

function totalLength(sequence: readonly RecipeSegment[]): number {
  return sequence.reduce((sum, segment) => sum + segment.length, 0);
}

function turnToRadius(length: number, turnDeg: number): number {
  const turnRad = (Math.abs(turnDeg) * Math.PI) / 180;
  if (turnRad < 1e-4) return 2000;
  return length / turnRad;
}

function applyMetaOverrides(meta: RecipeMeta, options: ProceduralOptions): RecipeMeta {
  if (options.tyreWear !== undefined) {
    meta.tyre_wear_mult = clamp(options.tyreWear, 0.3, 3);
  }
  if (options.fuelConsumption !== undefined) {
    meta.fuel_consumption = clamp(options.fuelConsumption, 0.4, 2.5);
  }
  if (options.dnfModifier !== undefined) {
    meta.dnf_modifier = clamp(options.dnfModifier, 0.3, 3);
  }
  if (options.wetWeatherMultiplier !== undefined) {
    meta.wet_weather_probability_multiplier = clamp(options.wetWeatherMultiplier, 0.3, 8);
  }
  if (options.overtakingDifficulty !== undefined) {
    meta.overtaking_difficulty = clamp(options.overtakingDifficulty, 0.2, 2.5);
  }
  if (options.pitLaneLossS !== undefined) {
    meta.pit_lane_loss_s = clamp(options.pitLaneLossS, 8, 90);
  }
  if (options.widthM !== undefined) {
    meta.racing_surface = {
      ...meta.racing_surface,
      width_m: clamp(options.widthM, 6, 24),
    };
  }
  if (options.poleSide) {
    meta.starting_grid = { ...meta.starting_grid, pole_side: options.poleSide };
  }
  if (options.nationality) {
    meta.nationality = options.nationality;
  }
  return meta;
}

function buildMeta(
  parent: CorpusTrack,
  intensity: number,
  lengthRatio: number,
  rng: Rng,
): RecipeMeta {
  const source = parent.meta;
  const jitter = (value: number, amount: number, min: number, max: number) =>
    clamp(value * (1 + rng.range(-amount, amount)), min, max);

  const sourceSplits = Array.isArray(source.sector_splits) ? source.sector_splits : [];
  const splits: [number, number] = [
    clamp((sourceSplits[0] ?? DEFAULT_META.sector_splits[0]) + rng.range(-intensity, intensity), 0.15, 0.45),
    clamp((sourceSplits[1] ?? DEFAULT_META.sector_splits[1]) + rng.range(-intensity, intensity), 0.55, 0.90),
  ];
  if (splits[1] <= splits[0] + 0.12) splits[1] = splits[0] + 0.12;

  return {
    tyre_wear_mult: jitter(source.tyre_wear_mult ?? 1, intensity, 0.7, 1.9),
    fuel_consumption: jitter(source.fuel_consumption ?? 1, intensity, 0.8, 1.6),
    dnf_modifier: jitter(source.dnf_modifier ?? 1, intensity, 0.7, 1.9),
    lap_modifier: clamp(
      (source.lap_modifier ?? DEFAULT_META.lap_modifier) * lengthRatio * (1 + rng.range(-intensity, intensity)),
      0.6,
      3.0,
    ),
    overtaking_difficulty: jitter(source.overtaking_difficulty ?? 1, intensity, 0.35, 2.2),
    pit_lane_loss_s: clamp(
      (source.pit_lane_loss_s ?? 20) * (1 + rng.range(-intensity * 0.5, intensity * 0.5)),
      12,
      60,
    ),
    wet_weather_probability_multiplier: jitter(
      source.wet_weather_probability_multiplier ?? 2,
      intensity,
      0.3,
      7.0,
    ),
    sector_splits: [round4(splits[0]), round4(splits[1])],
    nationality: source.nationality || DEFAULT_META.nationality,
    racing_surface: {
      ...DEFAULT_META.racing_surface,
      ...(source.racing_surface ?? {}),
      enabled: true,
      mode: 'road_course',
    },
    starting_grid: {
      ...DEFAULT_META.starting_grid,
      ...(source.starting_grid ?? {}),
    },
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}
