import { createEmptyTrack, DrsZone, MicroSector, TrackData } from '../../models/track.model';
import { Rng } from '../rng';
import { ProceduralOptions, TrackRecipe } from '../recipe/recipe.types';
import { buildPolyline, closeLoop, integrate } from '../geometry/arc-builder';
import { fitToCanvas, simplify } from '../geometry/fit-canvas';

export interface AssemblyResult {
  track: TrackData;
  closureErrorM: number;
  maxCorrectionDeg: number;
  pointCount: number;
}

interface StraightRun {
  startM: number;
  length: number;
}

export function assembleTrack(
  recipe: TrackRecipe,
  options: ProceduralOptions,
  rng: Rng,
  seed: number,
): AssemblyResult {
  const segments = recipe.segments;
  const totalM = recipe.length_m;

  let points: number[][];
  let closureErrorM = 0;
  let maxCorrectionDeg = 0;

  if (recipe.geometry && recipe.geometry.length > 3) {
    const closed = recipe.geometry.map(([x, y]) => ({ x, y }));
    closed[closed.length - 1] = { ...closed[0] };
    points = fitToCanvas(closed, { width: 1044, height: 1080, margin: 70 });
  } else if (recipe.turnsDeg && recipe.turnsDeg.length === segments.length) {
    const dense = buildPolyline(segments, recipe.turnsDeg, { stepM: 20, maxAngleDeg: 9 });
    if (dense.length > 1) dense[dense.length - 1] = { ...dense[0] };
    points = fitToCanvas(simplify(dense, 0.8), { width: 1044, height: 1080, margin: 70 });
    const end = integrate(segments, recipe.turnsDeg);
    closureErrorM = Math.hypot(end.x, end.y);
  } else {
    const closure = closeLoop(segments, segments.map((s) => s.turn_deg));
    const dense = buildPolyline(segments, closure.turnsDeg, { stepM: 20, maxAngleDeg: 9 });
    if (dense.length > 1) dense[dense.length - 1] = { ...dense[0] };
    points = fitToCanvas(simplify(dense, 0.8), { width: 1044, height: 1080, margin: 70 });
    closureErrorM = closure.error;
    maxCorrectionDeg = closure.maxCorrectionDeg;
  }

  const microSectors = buildMicroSectors(segments, totalM);
  const drsZones = buildDrsZones(segments, totalM, recipe, options, rng);
  const sectorSplits = normalizeSplits(recipe.meta.sector_splits);
  const name = options.name ?? `${recipe.sourceName} ${seed.toString(36).toUpperCase()}`;

  const base = createEmptyTrack();
  const track: TrackData = {
    ...base,
    name,
    nationality: recipe.meta.nationality,
    points,
    length_km: Math.round(totalM) / 1000,
    micro_sectors: microSectors,
    sector_splits: sectorSplits,
    drs_zones: drsZones,
    tyre_wear_mult: round3(recipe.meta.tyre_wear_mult),
    fuel_consumption: round3(recipe.meta.fuel_consumption),
    dnf_modifier: round3(recipe.meta.dnf_modifier),
    lap_modifier: round3(recipe.meta.lap_modifier),
    overtaking_difficulty: round3(recipe.meta.overtaking_difficulty),
    pit_lane_loss_s: round3(recipe.meta.pit_lane_loss_s),
    wet_weather_probability_multiplier: round3(recipe.meta.wet_weather_probability_multiplier),
    racing_surface: { ...recipe.meta.racing_surface, mode: 'road_course' },
    starting_grid: { ...recipe.meta.starting_grid },
    use_raw_canvas_coordinates: true,
    raw_canvas_size: [1044, 1080],
    hide_polyline_visual: false,
  };

  return {
    track,
    closureErrorM,
    maxCorrectionDeg,
    pointCount: points.length,
  };
}

function buildMicroSectors(segments: TrackRecipe['segments'], totalM: number): MicroSector[] {
  if (segments.length === 0 || totalM <= 0) return [];

  const percentages = segments.map((segment) =>
    round4((segment.length / totalM) * 100),
  );
  const sum = percentages.reduce((total, value) => total + value, 0);
  percentages[percentages.length - 1] = round4(
    percentages[percentages.length - 1] + (100 - sum),
  );

  return segments.map((segment, index) => ({
    type: segment.type,
    length_pct: percentages[index],
    target_speed_kmh: round1(segment.speed),
  }));
}

function buildDrsZones(
  segments: TrackRecipe['segments'],
  totalM: number,
  recipe: TrackRecipe,
  options: ProceduralOptions,
  rng: Rng,
): DrsZone[] {
  const hint = recipe.drsCountHint + (options.mode === 'clone' ? 0 : rng.int(-1, 2));
  const auto = Math.max(0, Math.min(4, hint));
  const count = options.drsZones === undefined || options.drsZones === null
    ? auto
    : Math.max(0, Math.min(6, Math.round(options.drsZones)));
  if (count === 0 || totalM <= 0) return [];

  const runs = straightRuns(segments, totalM)
    .filter((run) => run.length >= 280)
    .sort((a, b) => b.length - a.length)
    .slice(0, count);

  const zones: DrsZone[] = [];
  for (const run of runs) {
    const covers = rng.range(0.70, 1.0);
    const zoneLength = run.length * covers;
    if (zoneLength < 140) continue;

    const maxStartOffset = Math.max(0, run.length - zoneLength);
    const startOffset = rng.range(0, Math.min(maxStartOffset, run.length * 0.35));
    const detectionLead = rng.range(140, 700);
    const startM = run.startM + startOffset;

    zones.push({
      detection_progress: progress(startM - detectionLead, totalM),
      start_progress: progress(startM, totalM),
      end_progress: progress(startM + zoneLength, totalM),
    });
  }
  return zones;
}

function straightRuns(segments: TrackRecipe['segments'], totalM: number): StraightRun[] {
  const runs: StraightRun[] = [];
  let cumulative = 0;
  let current: StraightRun | null = null;

  for (const segment of segments) {
    if (segment.type === 'straight') {
      if (!current) current = { startM: cumulative, length: 0 };
      current.length += segment.length;
    } else if (current) {
      runs.push(current);
      current = null;
    }
    cumulative += segment.length;
  }
  if (current) runs.push(current);

  if (runs.length >= 2) {
    const first = runs[0];
    const last = runs[runs.length - 1];
    if (first.startM < 1e-6 && Math.abs(last.startM + last.length - totalM) < 1) {
      last.length += first.length;
      runs.shift();
    }
  }

  return runs;
}

function normalizeSplits(splits: [number, number]): number[] {
  let first = clamp(splits[0], 0.12, 0.48);
  let second = clamp(splits[1], 0.52, 0.93);
  if (second <= first) second = Math.min(0.93, first + 0.15);
  if (second <= first) first = Math.max(0.12, second - 0.15);
  return [round4(first), round4(second)];
}

function progress(distanceM: number, totalM: number): number {
  const wrapped = ((distanceM / totalM) % 1 + 1) % 1;
  const rounded = round4(wrapped);
  return rounded >= 1 ? 0 : rounded;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}
