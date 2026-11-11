import { CornerType, RacingSurface, StartingGrid } from '../../models/track.model';

export type GenerationMode = 'clone' | 'mutate' | 'splice' | 'novel';

export type NovelStyle = 'motifs' | 'statistical';

export type TrackCharacter =
  | 'flowing'
  | 'balanced'
  | 'technical'
  | 'street'
  | 'power'
  | 'rhythmic'
  | 'stop-go';

export type TrackShape =
  | 'compact'
  | 'balanced'
  | 'elongated'
  | 'round'
  | 'oval'
  | 'lobed';

export interface RecipeSegment {
  type: CornerType;
  speed: number;
  length: number;
  turn_deg: number;
  r_min: number;
}

export interface RecipeMeta {
  tyre_wear_mult: number;
  fuel_consumption: number;
  dnf_modifier: number;
  lap_modifier: number;
  overtaking_difficulty: number;
  pit_lane_loss_s: number;
  wet_weather_probability_multiplier: number;
  sector_splits: [number, number];
  nationality: string;
  racing_surface: RacingSurface;
  starting_grid: StartingGrid;
}

export interface TrackRecipe {
  sourceId: string;
  sourceName: string;
  segments: RecipeSegment[];
  length_m: number;
  meta: RecipeMeta;
  geometry?: number[][];
  turnsDeg?: number[];
  drsCountHint: number;
}

export interface NovelLayout {
  segments: RecipeSegment[];
  turnsDeg: number[];
}

export interface NovelLayoutOptions {
  cornerTarget?: number;
  character?: TrackCharacter;
  shape?: TrackShape;
}

export interface ProceduralOptions {
  seed?: number;
  mode?: GenerationMode;
  targetLengthKm?: number;
  cornerCount?: number;
  style?: NovelStyle;
  sourceId?: string;
  variation?: number;
  drsZones?: number | null;
  name?: string;
  character?: TrackCharacter;
  shape?: TrackShape;

  widthM?: number;
  tyreWear?: number;
  fuelConsumption?: number;
  dnfModifier?: number;
  wetWeatherMultiplier?: number;
  overtakingDifficulty?: number;
  pitLaneLossS?: number;
  poleSide?: 'left' | 'right';
  nationality?: string;
}
