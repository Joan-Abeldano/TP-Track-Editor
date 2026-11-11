import { CornerType, RacingSurface, StartingGrid } from '../../models/track.model';

export interface CorpusSegment {
  type: CornerType;
  speed: number;
  length: number;
  turn_deg: number;
  r_min: number;
}

export interface CorpusDrs {
  zone_len: number;
  detect_lead: number;
  run_len: number;
  start_off: number;
  end_gap: number;
  covers: number;
}

export interface CorpusMeta {
  tyre_wear_mult: number;
  fuel_consumption: number;
  dnf_modifier: number;
  lap_modifier: number;
  overtaking_difficulty: number;
  pit_lane_loss_s: number;
  wet_weather_probability_multiplier: number;
  sector_splits: number[];
  nationality: string;
  racing_surface?: Partial<RacingSurface>;
  starting_grid?: Partial<StartingGrid>;
}

export interface CorpusTrack {
  id: string;
  name: string;
  length_m: number;
  net_turn_deg: number;
  self_intersects: boolean;
  points: number[][];
  sequence: CorpusSegment[];
  straight_runs: [number, number][];
  drs: CorpusDrs[];
  meta: CorpusMeta;
}

export interface CorpusFile {
  version: number;
  generated_from: string;
  speed_law: { a: number; b: number };
  thresholds: number[];
  tracks: CorpusTrack[];
}
