import {
  CornerType,
  createEmptyTrack,
  RacingSurface,
  StartingGrid,
} from '../../models/track.model';
import { selfIntersects } from '../geometry/self-intersection';
import {
  CorpusDrs,
  CorpusFile,
  CorpusMeta,
  CorpusSegment,
  CorpusTrack,
} from './corpus.types';

const STEP_M = 5.0;
const SMOOTH_SIGMA_M = 10.0;
const MIN_UNIQUE_POINTS = 3;

type Vec2 = [number, number];

export interface RawTrackData {
  name?: string;
  era?: string;
  points?: unknown;
  length_km?: number;
  micro_sectors?: unknown;
  drs_zones?: unknown;
  tyre_wear_mult?: number;
  fuel_consumption?: number;
  dnf_modifier?: number;
  lap_modifier?: number;
  overtaking_difficulty?: number;
  pit_lane_loss_s?: number;
  wet_weather_probability_multiplier?: number;
  sector_splits?: number[];
  nationality?: string;
  racing_surface?: Partial<RacingSurface>;
  starting_grid?: Partial<StartingGrid>;
}

export interface CorpusTrackInput {
  id: string;
  data: RawTrackData;
}

export interface CorpusSkip {
  name: string;
  reason: string;
}

interface IngestEvent {
  type: CornerType;
  speed: number;
  s0: number;
  length: number;
  turn_deg: number;
  r_min: number;
}

export function parseTrackJson(text: string, fallbackName: string): RawTrackData {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('not valid JSON');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('expected a JSON object');
  }
  const data = parsed as RawTrackData;
  if (!Array.isArray(data.points) || data.points.length < MIN_UNIQUE_POINTS) {
    throw new Error('missing a centerline (points)');
  }
  if (!Array.isArray(data.micro_sectors) || data.micro_sectors.length === 0) {
    throw new Error('missing micro_sectors');
  }
  if (!Number.isFinite(Number(data.length_km)) || Number(data.length_km) <= 0) {
    throw new Error('missing a positive length_km');
  }
  if (!data.name || typeof data.name !== 'string') {
    data.name = fallbackName.replace(/\.json$/i, '');
  }
  return data;
}

export function createCorpusTrack(id: string, raw: RawTrackData): CorpusTrack {
  const name = (raw.name ?? id.replace(/\.json$/i, '')).trim() || id;
  const lengthM = Number(raw.length_km) * 1000;
  if (!Number.isFinite(lengthM) || lengthM < 100) {
    throw new Error('length_km is too small');
  }

  const rawPoints = parsePoints(raw.points);
  const geometryPoints = normalizePoints(rawPoints);
  const pixelLength = closedLength(geometryPoints);
  if (!(pixelLength > 0)) throw new Error('centerline has zero length');

  const pxPerM = pixelLength / lengthM;
  const resampled = resampleClosed(geometryPoints, STEP_M * pxPerM);
  const xy = resampled.xy.map(([x, y]): Vec2 => [x / pxPerM, y / pxPerM]);
  const ds = resampled.ds / pxPerM;
  const kappa = curvature(xy, ds);

  const events = eventsFromMicroSectors(raw.micro_sectors, lengthM, kappa, ds);
  const sequence: CorpusSegment[] = events.map((event) => ({
    type: event.type,
    speed: r1(event.speed),
    length: r1(event.length),
    turn_deg: r1(event.turn_deg),
    r_min: r1(event.r_min),
  }));
  const runs = straightRuns(events);
  const drs = drsRows(raw.drs_zones, lengthM, runs);

  const points = rawPoints.map(([x, y]) => [r1(x), r1(y)]);
  const closed = isClosed(points) ? points : [...points, points[0] ?? [0, 0]];
  const netTurn = sequence.reduce((sum, segment) => sum + segment.turn_deg, 0);

  return {
    id,
    name,
    length_m: r1(lengthM),
    net_turn_deg: r1(netTurn),
    self_intersects: points.length > 3 ? selfIntersects(closed) : false,
    points,
    sequence,
    straight_runs: runs.map(([start, length]) => [r1(start), r1(length)]),
    drs,
    meta: buildMeta(raw),
  };
}

export function finalizeCorpus(
  tracks: readonly CorpusTrack[],
  generatedFrom = 'user-import',
): CorpusFile {
  const ordered = [...tracks].sort((a, b) => a.id.localeCompare(b.id));
  const stats = corpusStats(ordered);
  return {
    version: 2,
    generated_from: generatedFrom,
    speed_law: stats.speedLaw,
    thresholds: stats.thresholds,
    tracks: ordered,
  };
}

export function buildCorpusFromTracks(inputs: readonly CorpusTrackInput[]): {
  corpus: CorpusFile;
  loaded: number;
  skipped: CorpusSkip[];
} {
  const tracks: CorpusTrack[] = [];
  const skipped: CorpusSkip[] = [];
  for (const input of inputs) {
    try {
      tracks.push(createCorpusTrack(input.id, input.data));
    } catch (error) {
      skipped.push({ name: input.id, reason: (error as Error).message });
    }
  }
  return {
    corpus: finalizeCorpus(tracks),
    loaded: tracks.length,
    skipped,
  };
}

function parsePoints(value: unknown): Vec2[] {
  if (!Array.isArray(value) || value.length < MIN_UNIQUE_POINTS) {
    throw new Error('missing a centerline (points)');
  }
  const points: Vec2[] = [];
  for (const entry of value) {
    if (!Array.isArray(entry) || entry.length < 2) {
      throw new Error('points must be [x, y] pairs');
    }
    const x = Number(entry[0]);
    const y = Number(entry[1]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      throw new Error('points contain a non-numeric coordinate');
    }
    points.push([x, y]);
  }
  return points;
}

function normalizePoints(points: readonly Vec2[]): Vec2[] {
  const cleaned: Vec2[] = [];
  for (const point of points) {
    if (cleaned.length === 0 || distance(cleaned[cleaned.length - 1], point) > 1e-6) {
      cleaned.push(point);
    }
  }
  while (cleaned.length > 1 && distance(cleaned[0], cleaned[cleaned.length - 1]) < 1e-6) {
    cleaned.pop();
  }
  if (cleaned.length < MIN_UNIQUE_POINTS) {
    throw new Error('centerline has too few unique points');
  }
  return cleaned;
}

function closedLength(points: readonly Vec2[]): number {
  let total = 0;
  for (let i = 0; i < points.length; i++) {
    total += distance(points[i], points[(i + 1) % points.length]);
  }
  return total;
}

function resampleClosed(points: readonly Vec2[], step: number): { xy: Vec2[]; ds: number } {
  const loop = [...points, points[0]];
  const cumulative = [0];
  for (let i = 1; i < loop.length; i++) {
    cumulative.push(cumulative[i - 1] + distance(loop[i - 1], loop[i]));
  }
  const total = cumulative[cumulative.length - 1];
  const count = Math.max(Math.round(total / step), 16);
  const ds = total / count;
  const xy: Vec2[] = [];
  let segment = 0;

  for (let i = 0; i < count; i++) {
    const target = (total * i) / count;
    while (segment < loop.length - 2 && cumulative[segment + 1] < target) {
      segment++;
    }
    const span = cumulative[segment + 1] - cumulative[segment];
    const f = span > 1e-12 ? (target - cumulative[segment]) / span : 0;
    xy.push([
      loop[segment][0] + (loop[segment + 1][0] - loop[segment][0]) * f,
      loop[segment][1] + (loop[segment + 1][1] - loop[segment][1]) * f,
    ]);
  }

  return { xy, ds };
}

function curvature(xy: readonly Vec2[], ds: number): Float64Array {
  const n = xy.length;
  const dx = new Float64Array(n);
  const dy = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const next = xy[(i + 1) % n];
    const prev = xy[(i - 1 + n) % n];
    dx[i] = next[0] - prev[0];
    dy[i] = next[1] - prev[1];
  }

  const sigma = SMOOTH_SIGMA_M / ds;
  const tx = smoothPeriodic(dx, sigma);
  const ty = smoothPeriodic(dy, sigma);

  const heading = new Float64Array(n);
  for (let i = 0; i < n; i++) heading[i] = Math.atan2(ty[i], tx[i]);

  const kappa = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const delta = wrapAngle(heading[(i + 1) % n] - heading[(i - 1 + n) % n]);
    kappa[i] = delta / (2 * ds);
  }
  return kappa;
}

function smoothPeriodic(values: Float64Array, sigma: number): Float64Array {
  const k = Math.max(Math.trunc(4 * sigma), 1);
  const weights = new Float64Array(2 * k + 1);
  let weightSum = 0;
  for (let x = -k; x <= k; x++) {
    const weight = Math.exp(-0.5 * (x / sigma) ** 2);
    weights[x + k] = weight;
    weightSum += weight;
  }

  const n = values.length;
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let sum = 0;
    for (let x = -k; x <= k; x++) {
      sum += values[(i + x + n) % n] * weights[x + k];
    }
    out[i] = sum / weightSum;
  }
  return out;
}

function eventsFromMicroSectors(
  rawMicrosectors: unknown,
  lengthM: number,
  kappa: Float64Array,
  ds: number,
): IngestEvent[] {
  if (!Array.isArray(rawMicrosectors) || rawMicrosectors.length === 0) {
    throw new Error('missing micro_sectors');
  }

  const micros = rawMicrosectors.map((entry, index) => {
    if (!entry || typeof entry !== 'object') {
      throw new Error(`invalid microsector at index ${index}`);
    }
    const micro = entry as Record<string, unknown>;
    const type = normalizeCornerType(micro['type'], index);
    const lengthPct = Number(micro['length_pct']);
    const speed = Number(micro['target_speed_kmh']);
    if (!Number.isFinite(lengthPct) || lengthPct <= 0) {
      throw new Error(`invalid length_pct at microsector ${index}`);
    }
    if (!Number.isFinite(speed) || speed <= 0) {
      throw new Error(`invalid target_speed_kmh at microsector ${index}`);
    }
    return { type, lengthPct, speed };
  });

  const totalPct = micros.reduce((sum, micro) => sum + micro.lengthPct, 0);
  if (!(totalPct > 0)) throw new Error('microsectors have no length');

  const n = kappa.length;
  const edges = [0];
  for (const micro of micros) {
    edges.push(edges[edges.length - 1] + micro.lengthPct / totalPct);
  }

  return micros.map((micro, index) => {
    const start = Math.min(n - 1, Math.round(edges[index] * n));
    const end = Math.min(n, Math.max(Math.round(edges[index + 1] * n), start + 1));

    let turn = 0;
    let maxKappa = 0;
    for (let i = start; i < end; i++) {
      turn += kappa[i];
      const abs = Math.abs(kappa[i]);
      if (abs > maxKappa) maxKappa = abs;
    }

    return {
      type: micro.type,
      speed: micro.speed,
      s0: edges[index] * lengthM,
      length: (edges[index + 1] - edges[index]) * lengthM,
      turn_deg: (turn * ds * 180) / Math.PI,
      r_min: 1 / Math.max(maxKappa, 1e-5),
    };
  });
}

function straightRuns(events: readonly IngestEvent[]): Array<[number, number]> {
  const runs: Array<[number, number]> = [];
  let current: [number, number] | null = null;

  for (const event of events) {
    if (event.type === 'straight') {
      if (current) current[1] += event.length;
      else current = [event.s0, event.length];
    } else if (current) {
      runs.push(current);
      current = null;
    }
  }

  if (current) {
    if (runs.length > 0 && events[0]?.type === 'straight') {
      runs[0] = [current[0], current[1] + runs[0][1]];
    } else {
      runs.push(current);
    }
  }
  return runs;
}

function drsRows(
  rawZones: unknown,
  lengthM: number,
  runs: readonly [number, number][],
): CorpusDrs[] {
  if (!Array.isArray(rawZones)) return [];

  const rows: CorpusDrs[] = [];
  for (const entry of rawZones) {
    if (!entry || typeof entry !== 'object') continue;
    const zone = entry as Record<string, unknown>;
    const detection = Number(zone['detection_progress']);
    const startProgress = Number(zone['start_progress']);
    const endProgress = Number(zone['end_progress']);
    if (![detection, startProgress, endProgress].every(Number.isFinite)) continue;

    const start = mod(startProgress * lengthM, lengthM);
    const end = mod(endProgress * lengthM, lengthM);
    const detectionS = mod(detection * lengthM, lengthM);
    const zoneLength = mod(end - start, lengthM);
    const row: CorpusDrs = {
      zone_len: r1(zoneLength),
      detect_lead: r1(mod(start - detectionS, lengthM)),
      run_len: 0,
      start_off: 0,
      end_gap: 0,
      covers: 0,
    };

    for (const [runStart, runLength] of runs) {
      const offset = mod(start - runStart, lengthM);
      if (offset <= runLength + 1) {
        row.run_len = r1(runLength);
        row.start_off = r1(offset);
        row.end_gap = r1(runLength - offset - zoneLength);
        row.covers = r1(zoneLength / Math.max(runLength, 1e-9));
        break;
      }
    }
    rows.push(row);
  }
  return rows;
}

function buildMeta(raw: RawTrackData): CorpusMeta {
  const defaults = createEmptyTrack();
  return {
    tyre_wear_mult: numberOr(raw.tyre_wear_mult, 1),
    fuel_consumption: numberOr(raw.fuel_consumption, 1),
    dnf_modifier: numberOr(raw.dnf_modifier, 1),
    lap_modifier: numberOr(raw.lap_modifier, 1.2),
    overtaking_difficulty: numberOr(raw.overtaking_difficulty, 1),
    pit_lane_loss_s: numberOr(raw.pit_lane_loss_s, 20),
    wet_weather_probability_multiplier: numberOr(raw.wet_weather_probability_multiplier, 2),
    sector_splits: normalizeSplits(raw.sector_splits),
    nationality: typeof raw.nationality === 'string' ? raw.nationality : '',
    racing_surface: {
      ...defaults.racing_surface,
      ...objectOrEmpty<Partial<RacingSurface>>(raw.racing_surface),
      mode: 'road_course',
    },
    starting_grid: {
      ...defaults.starting_grid,
      ...objectOrEmpty<Partial<StartingGrid>>(raw.starting_grid),
    },
  };
}

function normalizeSplits(value: unknown): number[] {
  if (!Array.isArray(value) || value.length < 2) return [0.33, 0.66];
  const first = Number(value[0]);
  const second = Number(value[1]);
  return [Number.isFinite(first) ? first : 0.33, Number.isFinite(second) ? second : 0.66];
}

function corpusStats(tracks: readonly CorpusTrack[]): {
  speedLaw: { a: number; b: number };
  thresholds: number[];
} {
  const corners = tracks.flatMap((track) =>
    track.sequence.filter((segment) => segment.type !== 'straight'),
  );

  const samples = corners
    .filter((segment) => segment.r_min > 8 && segment.r_min < 400 && segment.speed > 20)
    .map((segment) => [Math.log(segment.r_min), Math.log(segment.speed)] as const);

  let speedLaw = { a: 42.77, b: 0.281 };
  if (samples.length > 1) {
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
      denominator += (x - meanX) ** 2;
    }
    if (denominator > 1e-9) {
      const b = numerator / denominator;
      speedLaw = { a: Math.exp(meanY - b * meanX), b };
    }
  }

  let thresholds = [140, 195];
  if (corners.length > 0) {
    const speeds = {
      low: corners.filter((segment) => segment.type === 'low').map((segment) => segment.speed),
      med: corners.filter((segment) => segment.type === 'med').map((segment) => segment.speed),
      high: corners.filter((segment) => segment.type === 'high').map((segment) => segment.speed),
    };
    let bestAccuracy = 0;
    for (let c1 = 100; c1 < 200; c1 += 5) {
      for (let c2 = c1 + 10; c2 < 300; c2 += 5) {
        const accuracy =
          (speeds.low.filter((speed) => speed < c1).length +
            speeds.med.filter((speed) => speed >= c1 && speed < c2).length +
            speeds.high.filter((speed) => speed >= c2).length) /
          corners.length;
        if (accuracy > bestAccuracy) {
          bestAccuracy = accuracy;
          thresholds = [c1, c2];
        }
      }
    }
  }

  return { speedLaw, thresholds };
}

function normalizeCornerType(value: unknown, index: number): CornerType {
  const normalized = typeof value === 'string'
    ? value.trim().toLowerCase().replace(/[\s_-]+/g, '')
    : '';
  const types: Record<string, CornerType> = {
    straight: 'straight',
    high: 'high',
    highspeed: 'high',
    highspeedcorner: 'high',
    med: 'med',
    medium: 'med',
    mediumsector: 'med',
    mediumspeed: 'med',
    mediumsectorcorner: 'med',
    mediumspeedcorner: 'med',
    low: 'low',
    lowspeed: 'low',
    lowspeedcorner: 'low',
  };
  const type = types[normalized];
  if (!type) {
    throw new Error(`invalid microsector type "${String(value)}" at index ${index}`);
  }
  return type;
}

function isClosed(points: readonly number[][]): boolean {
  if (points.length < 2) return false;
  const first = points[0];
  const last = points[points.length - 1];
  return Math.hypot(first[0] - last[0], first[1] - last[1]) < 1e-6;
}

function distance(a: Vec2, b: Vec2): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

function wrapAngle(angle: number): number {
  return ((angle + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
}

function mod(value: number, divisor: number): number {
  if (!(divisor > 0)) return 0;
  return ((value % divisor) + divisor) % divisor;
}

function r1(value: number): number {
  return Number.isFinite(value) ? Math.round(value * 10) / 10 : 0;
}

function numberOr(value: unknown, fallback: number): number {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function objectOrEmpty<T extends object>(value: unknown): Partial<T> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Partial<T>)
    : {};
}
