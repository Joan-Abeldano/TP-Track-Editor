import { TrackData } from '../../models/track.model';
import { selfIntersects } from '../geometry/self-intersection';

export interface ValidationContext {
  closureErrorM: number;
  maxCorrectionDeg: number;
}

export function validateTrack(track: TrackData, context: ValidationContext): string[] {
  const errors: string[] = [];
  const points = track.points;

  if (!Array.isArray(points) || points.length < 8) {
    errors.push('too few points');
    return errors;
  }

  const first = points[0];
  const last = points[points.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) errors.push('polyline is not closed');

  if (!Number.isFinite(track.length_km) || track.length_km < 1 || track.length_km > 30) {
    errors.push(`implausible length ${track.length_km} km`);
  }

  const percentageSum = track.micro_sectors.reduce((sum, micro) => sum + micro.length_pct, 0);
  if (track.micro_sectors.length === 0) errors.push('no microsectors');
  if (Math.abs(percentageSum - 100) > 0.05) {
    errors.push(`microsectors sum to ${percentageSum.toFixed(2)}%`);
  }
  if (track.micro_sectors.some((micro) => !(micro.length_pct > 0) || !(micro.target_speed_kmh > 0))) {
    errors.push('invalid microsector');
  }

  if (track.sector_splits.length !== 2) {
    errors.push('expected exactly two sector splits');
  } else {
    const [firstSplit, secondSplit] = track.sector_splits;
    if (!(firstSplit > 0 && firstSplit < secondSplit && secondSplit < 1)) {
      errors.push('sector splits are not ordered');
    }
  }

  for (const zone of track.drs_zones) {
    for (const progress of [zone.detection_progress, zone.start_progress, zone.end_progress]) {
      if (!(progress >= 0 && progress < 1)) errors.push('DRS progress outside [0,1)');
    }
  }

  if (context.closureErrorM > 0.5) {
    errors.push(`closure error ${context.closureErrorM.toFixed(2)} m`);
  }
  if (context.maxCorrectionDeg > 15) {
    errors.push(`loop correction too large (${context.maxCorrectionDeg.toFixed(1)}°)`);
  }

  if (selfIntersects(points)) errors.push('centerline self-intersects');

  return errors;
}
