export type CornerType = 'straight' | 'high' | 'med' | 'low';

export interface MicroSector {
  type: CornerType;
  length_pct: number;
  target_speed_kmh: number;
}

export interface DrsZone {
  detection_progress: number;
  start_progress: number;
  end_progress: number;
}

export interface RacingSurface {
  enabled: boolean;
  mode: 'road_course';
  width_m: number;
  edge_margin_m: number;
  corridor_count: number;
  visual_lateral_scale: number;
}

export interface StartingGrid {
  pole_side: 'left' | 'right';
  row_spacing_m: number;
  column_spacing_m: number;
  stagger_m: number;
}

export interface TrackData {
  wet_weather_probability_multiplier: number;
  pit_lane_loss_s: number;
  points: number[][];
  sector_splits: number[];
  tyre_wear_mult?: number;
  fuel_consumption?: number;
  dnf_modifier?: number;
  lap_modifier?: number;
  track_time_mult?: number;
  length_km: number;
  use_raw_canvas_coordinates?: boolean;
  raw_canvas_size?: number[];
  hide_polyline_visual?: boolean;
  micro_sectors: MicroSector[];
  drs_zones: DrsZone[];
  nationality: string;
  racing_surface: RacingSurface;
  starting_grid: StartingGrid;
}

export function createEmptyTrack(): TrackData {
  return {
    wet_weather_probability_multiplier: 1.0,
    pit_lane_loss_s: 20.0,
    points: [],
    sector_splits: [0.33, 0.66],
    tyre_wear_mult: 1.0,
    fuel_consumption: 1.0,
    dnf_modifier: 1.0,
    lap_modifier: 1.0,
    length_km: 5.0,
    use_raw_canvas_coordinates: true,
    raw_canvas_size: [1044, 1080],
    hide_polyline_visual: false,
    micro_sectors: [],
    drs_zones: [],
    nationality: '',
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
}

export const CORNER_TYPES: { value: CornerType; label: string; color: string }[] = [
  { value: 'straight', label: 'Straight', color: '#6bd8a0' },
  { value: 'high', label: 'High Speed', color: '#ffd76b' },
  { value: 'med', label: 'Medium', color: '#ffaa6b' },
  { value: 'low', label: 'Low Speed', color: '#ff6b8b' },
];

export const NATIONALITIES: string[] = [
  'afghan',
  'albanian',
  'algerian',
  'andorran',
  'angolan',
  'antiguan',
  'argentine',
  'armenian',
  'azerbaijani',
  'bahamian',
  'bahraini',
  'bangladeshi',
  'barbadian',
  'belarusian',
  'belizean',
  'beninese',
  'bhutanese',
  'bolivian',
  'bosnian',
  'botswanan',
  'bruneian',
  'bulgarian',
  'burkinabe',
  'burundian',
  'cambodian',
  'cameroonian',
  'cape_verdean',
  'central_african',
  'chadian',
  'colombian',
  'comorian',
  'congolese',
  'costa_rican',
  'croatian',
  'cuban',
  'cypriot',
  'czech',
  'danish',
  'djiboutian',
  'dominican',
  'timorese',
  'ecuadorian',
  'egyptian',
  'salvadoran',
  'equatorial_guinean',
  'eritrean',
  'estonian',
  'eswatini',
  'ethiopian',
  'fijian',
  'finnish',
  'gabonese',
  'gambian',
  'georgian',
  'ghanaian',
  'greek',
  'grenadian',
  'guatemalan',
  'guinean',
  'guyanese',
  'haitian',
  'honduran',
  'icelandic',
  'indian',
  'indonesian',
  'iranian',
  'iraqi',
  'irish',
  'israeli',
  'jamaican',
  'jordanian',
  'kazakh',
  'kenyan',
  'kiribati',
  'kosovan',
  'kuwaiti',
  'kyrgyz',
  'laotian',
  'latvian',
  'lebanese',
  'liberian',
  'libyan',
  'liechtensteiner',
  'lithuanian',
  'luxembourgish',
  'malagasy',
  'malawian',
  'malaysian',
  'maldivian',
  'malian',
  'maltese',
  'marshallese',
  'mauritanian',
  'mauritian',
  'micronesian',
  'moldovan',
  'monacan',
  'mongolian',
  'montenegrin',
  'moroccan',
  'mozambican',
  'myanmar',
  'namibian',
  'nauruan',
  'nepalese',
  'new_zealander',
  'nicaraguan',
  'nigerien',
  'nigerian',
  'north_korean',
  'north_macedonian',
  'norwegian',
  'omani',
  'pakistani',
  'palauan',
  'palestinian',
  'panamanian',
  'papua_new_guinean',
  'paraguayan',
  'peruvian',
  'filipino',
  'polish',
  'portuguese',
  'romanian',
  'rwandan',
  'saint_lucian',
  'samoan',
  'san_marinese',
  'sao_tomean',
  'senegalese',
  'serbian',
  'seychellois',
  'sierra_leonean',
  'slovak',
  'slovenian',
  'solomon_islander',
  'somali',
  'south_korean',
  'south_sudanese',
  'sri_lankan',
  'sudanese',
  'surinamese',
  'swedish',
  'swiss',
  'syrian',
  'taiwanese',
  'tajik',
  'tanzanian',
  'thai',
  'togolese',
  'tongan',
  'trinidadian',
  'tunisian',
  'turkmen',
  'tuvaluan',
  'ugandan',
  'ukrainian',
  'uruguayan',
  'uzbek',
  'vanuatuan',
  'venezuelan',
  'vietnamese',
  'yemeni',
  'zambian',
  'zimbabwean',
  'american',
  'japanese',
  'italian',
  'hungarian',
  'german',
  'french',
  'chinese',
  'brazilian',
  'australian',
  'south_african',
  'british',
  'spanish',
  'dutch',
  'belgian',
  'mexican',
  'canadian',
  'russian',
  'turkish',
  'emirati',
  'saudi',
  'singaporean',
  'qatari',
  'custom',
];
