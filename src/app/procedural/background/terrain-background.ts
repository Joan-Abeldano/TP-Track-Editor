import { hashSeed, Rng } from '../rng';

export type TerrainBiome =
  | 'auto'
  | 'grassland'
  | 'desert'
  | 'alpine'
  | 'coastal'
  | 'autumn'
  | 'night';

export const TERRAIN_BIOMES: { value: TerrainBiome; label: string }[] = [
  { value: 'auto', label: 'Auto' },
  { value: 'grassland', label: 'Grassland' },
  { value: 'desert', label: 'Desert' },
  { value: 'alpine', label: 'Alpine' },
  { value: 'coastal', label: 'Coastal' },
  { value: 'autumn', label: 'Autumn' },
  { value: 'night', label: 'Night' },
];

export interface TerrainOptions {
  width: number;
  height: number;
  seed: number;
  biome?: TerrainBiome;
  trackPoints?: readonly (readonly number[])[];
  roadWidth?: number;
}

interface Palette {
  name: Exclude<TerrainBiome, 'auto'>;
  base: string;
  light: string;
  high: string;
  water: string;
  deep: string;
  forest: string;
  clear: string;
  waterLevel: number;
  highLevel: number;
  nightLights?: boolean;
}

const PALETTES: Record<Exclude<TerrainBiome, 'auto'>, Palette> = {
  grassland: {
    name: 'grassland',
    base: '#3f7a3e',
    light: '#739f4d',
    high: '#8c7d56',
    water: '#2f6b82',
    deep: '#1d4356',
    forest: '#224a24',
    clear: '#c9d6a0',
    waterLevel: 0.26,
    highLevel: 0.78,
  },
  desert: {
    name: 'desert',
    base: '#c9a66b',
    light: '#e2c68b',
    high: '#9a6a44',
    water: '#4f8a9a',
    deep: '#2f5f70',
    forest: '#7a6a3a',
    clear: '#f0e2b8',
    waterLevel: 0.1,
    highLevel: 0.72,
  },
  alpine: {
    name: 'alpine',
    base: '#5e7a63',
    light: '#9db08a',
    high: '#d8e0da',
    water: '#3d6f86',
    deep: '#254a60',
    forest: '#2c4a34',
    clear: '#c8d2c0',
    waterLevel: 0.18,
    highLevel: 0.7,
  },
  coastal: {
    name: 'coastal',
    base: '#4f8a6a',
    light: '#8fc08a',
    high: '#c8b98a',
    water: '#2a6f9a',
    deep: '#1c4a6e',
    forest: '#2f5a3a',
    clear: '#e0d8b0',
    waterLevel: 0.3,
    highLevel: 0.74,
  },
  autumn: {
    name: 'autumn',
    base: '#7a6a3a',
    light: '#b98a4a',
    high: '#8a5a3a',
    water: '#3f6f86',
    deep: '#284c60',
    forest: '#5a3a24',
    clear: '#d8b070',
    waterLevel: 0.16,
    highLevel: 0.76,
  },
  night: {
    name: 'night',
    base: '#16283a',
    light: '#244058',
    high: '#2e3e4a',
    water: '#143a5a',
    deep: '#0a2036',
    forest: '#0c2018',
    clear: '#3a5a7a',
    waterLevel: 0.22,
    highLevel: 0.74,
    nightLights: true,
  },
};

const AUTO_BIOMES: Array<Exclude<TerrainBiome, 'auto'>> = [
  'grassland',
  'grassland',
  'coastal',
  'alpine',
  'autumn',
  'desert',
];

type Rgb = [number, number, number];

export function renderTerrainBackground(options: TerrainOptions): HTMLCanvasElement {
  const width = Math.max(64, Math.round(options.width));
  const height = Math.max(64, Math.round(options.height));
  const biome = options.biome && options.biome !== 'auto' ? options.biome : 'auto';
  const rng = new Rng(hashSeed(`terrain:${options.seed}:${biome}`));
  const palette = PALETTES[
    biome === 'auto' ? rng.pick(AUTO_BIOMES) : biome
  ];

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not create a canvas for the background');

  const fieldW = Math.max(48, Math.round(width / 4));
  const fieldH = Math.max(48, Math.round(height / 4));
  const field = buildField(fieldW, fieldH, rng);

  const fieldCanvas = document.createElement('canvas');
  fieldCanvas.width = fieldW;
  fieldCanvas.height = fieldH;
  const fieldCtx = fieldCanvas.getContext('2d');
  if (!fieldCtx) throw new Error('Could not create a canvas for the terrain field');

  const image = fieldCtx.createImageData(fieldW, fieldH);
  paintField(image.data, field, palette, rng);

  ctx.imageSmoothingEnabled = true;
  fieldCtx.putImageData(image, 0, 0);
  ctx.drawImage(fieldCanvas, 0, 0, width, height);

  const sample = (x: number, y: number): number => {
    const fx = Math.min(
      fieldW - 1,
      Math.max(0, Math.round((x / Math.max(1, width - 1)) * (fieldW - 1))),
    );
    const fy = Math.min(
      fieldH - 1,
      Math.max(0, Math.round((y / Math.max(1, height - 1)) * (fieldH - 1))),
    );
    return field[fy * fieldW + fx];
  };

  drawForests(ctx, width, height, palette, rng, sample);
  if (palette.nightLights) drawNightLights(ctx, width, height, palette, rng, sample);
  drawTrackRoad(ctx, options.trackPoints, palette, options.roadWidth);
  drawVignette(ctx, width, height);

  return canvas;
}

function buildField(width: number, height: number, rng: Rng): Float32Array {
  const octaves = [
    { grid: 3, weight: 0.5 },
    { grid: 6, weight: 0.28 },
    { grid: 12, weight: 0.15 },
    { grid: 24, weight: 0.07 },
  ];
  const layers = octaves.map((octave) => {
    const size = octave.grid + 1;
    const values = new Float32Array(size * size);
    for (let i = 0; i < values.length; i++) values[i] = rng.next();
    return { ...octave, size, values };
  });

  const field = new Float32Array(width * height);
  let min = Infinity;
  let max = -Infinity;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let value = 0;
      for (const layer of layers) {
        const fx = (x / Math.max(1, width - 1)) * layer.grid;
        const fy = (y / Math.max(1, height - 1)) * layer.grid;
        const x0 = Math.min(layer.grid - 1, Math.floor(fx));
        const y0 = Math.min(layer.grid - 1, Math.floor(fy));
        const tx = smooth(fx - x0);
        const ty = smooth(fy - y0);
        const i00 = y0 * layer.size + x0;
        const a = layer.values[i00];
        const b = layer.values[i00 + 1];
        const c = layer.values[i00 + layer.size];
        const d = layer.values[i00 + layer.size + 1];
        const top = a + (b - a) * tx;
        const bottom = c + (d - c) * tx;
        value += (top + (bottom - top) * ty) * layer.weight;
      }
      field[y * width + x] = value;
      if (value < min) min = value;
      if (value > max) max = value;
    }
  }

  const scale = max > min ? 1 / (max - min) : 1;
  for (let i = 0; i < field.length; i++) field[i] = (field[i] - min) * scale;
  return field;
}

function paintField(
  data: Uint8ClampedArray,
  field: Float32Array,
  palette: Palette,
  rng: Rng,
): void {
  const base = hexToRgb(palette.base);
  const light = hexToRgb(palette.light);
  const high = hexToRgb(palette.high);
  const water = hexToRgb(palette.water);
  const deep = hexToRgb(palette.deep);
  const waterLevel = palette.waterLevel;
  const highLevel = palette.highLevel;

  for (let i = 0; i < field.length; i++) {
    const h = field[i];
    let r: number;
    let g: number;
    let b: number;

    if (h < waterLevel) {
      const t = clamp01(h / waterLevel);
      r = deep[0] + (water[0] - deep[0]) * t;
      g = deep[1] + (water[1] - deep[1]) * t;
      b = deep[2] + (water[2] - deep[2]) * t;
    } else if (h > highLevel) {
      const t = clamp01((h - highLevel) / (1 - highLevel));
      r = light[0] + (high[0] - light[0]) * t;
      g = light[1] + (high[1] - light[1]) * t;
      b = light[2] + (high[2] - light[2]) * t;
    } else {
      const t = clamp01((h - waterLevel) / Math.max(1e-6, highLevel - waterLevel));
      r = base[0] + (light[0] - base[0]) * t;
      g = base[1] + (light[1] - base[1]) * t;
      b = base[2] + (light[2] - base[2]) * t;
    }

    const band = ((h * 22) % 1 + 1) % 1;
    const shade = band < 0.035 ? 0.87 : 1;
    const dither = (rng.next() - 0.5) * 7;

    const index = i * 4;
    data[index] = r * shade + dither;
    data[index + 1] = g * shade + dither;
    data[index + 2] = b * shade + dither;
    data[index + 3] = 255;
  }
}

function drawForests(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  palette: Palette,
  rng: Rng,
  sample: (x: number, y: number) => number,
): void {
  const clusters = Math.round((width * height) / 14000);
  ctx.save();
  ctx.fillStyle = palette.forest;

  for (let c = 0; c < clusters; c++) {
    const cx = rng.range(0, width);
    const cy = rng.range(0, height);
    const h = sample(cx, cy);
    if (h < palette.waterLevel + 0.04 || h > palette.highLevel - 0.02) continue;

    const blobs = rng.int(6, 16);
    const spread = rng.range(10, 34);
    for (let i = 0; i < blobs; i++) {
      const x = cx + rng.gaussian() * spread;
      const y = cy + rng.gaussian() * spread * 0.8;
      if (x < 0 || y < 0 || x > width || y > height) continue;
      ctx.globalAlpha = rng.range(0.16, 0.42);
      ctx.beginPath();
      ctx.arc(x, y, rng.range(2.5, 8), 0, Math.PI * 2);
      ctx.fill();
    }
  }

  ctx.restore();
}

function drawNightLights(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  palette: Palette,
  rng: Rng,
  sample: (x: number, y: number) => number,
): void {
  ctx.save();
  const count = Math.round((width * height) / 6000);
  for (let i = 0; i < count; i++) {
    const x = rng.range(0, width);
    const y = rng.range(0, height);
    const h = sample(x, y);
    if (h < palette.waterLevel + 0.03 || h > palette.highLevel) continue;
    const radius = rng.range(0.8, 2.4);
    ctx.globalAlpha = rng.range(0.25, 0.7);
    ctx.fillStyle = '#ffd98a';
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawTrackRoad(
  ctx: CanvasRenderingContext2D,
  points: readonly (readonly number[])[] | undefined,
  palette: Palette,
  roadWidth: number | undefined,
): void {
  if (!points || points.length < 2) return;

  const path = new Path2D();
  path.moveTo(points[0][0], points[0][1]);
  for (let i = 1; i < points.length; i++) path.lineTo(points[i][0], points[i][1]);
  path.closePath();

  const road = Math.max(8, roadWidth ?? 24);
  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  ctx.shadowColor = withAlpha(palette.clear, 0.55);
  ctx.shadowBlur = road * 1.2 + 14;
  ctx.strokeStyle = withAlpha(palette.clear, 0.2);
  ctx.lineWidth = road + 44;
  ctx.stroke(path);

  ctx.shadowBlur = 0;
  ctx.strokeStyle = withAlpha(palette.clear, 0.5);
  ctx.lineWidth = road + 22;
  ctx.stroke(path);

  ctx.strokeStyle = 'rgba(226, 229, 240, 0.4)';
  ctx.lineWidth = road + 4;
  ctx.stroke(path);

  ctx.strokeStyle = '#232330';
  ctx.lineWidth = road;
  ctx.stroke(path);

  ctx.strokeStyle = 'rgba(235, 235, 245, 0.12)';
  ctx.lineWidth = Math.max(1, road * 0.07);
  ctx.setLineDash([Math.max(8, road * 0.9), Math.max(10, road * 1.15)]);
  ctx.stroke(path);
  ctx.setLineDash([]);

  drawStartLine(ctx, points, road);
  ctx.restore();
}

function drawStartLine(
  ctx: CanvasRenderingContext2D,
  points: readonly (readonly number[])[],
  road: number,
): void {
  const start = points[0];
  const next = points[1] ?? points[0];
  const angle = Math.atan2(next[1] - start[1], next[0] - start[0]);
  if (!Number.isFinite(angle)) return;

  const nx = -Math.sin(angle);
  const ny = Math.cos(angle);
  const tx = Math.cos(angle);
  const ty = Math.sin(angle);
  const cells = 8;
  const cell = road / cells;
  const depth = Math.max(2, road * 0.22);

  ctx.save();
  for (let i = 0; i < cells; i++) {
    const offset = -road / 2 + cell * (i + 0.5);
    const cx = start[0] + nx * offset;
    const cy = start[1] + ny * offset;
    const halfAlong = depth / 2;
    const halfAcross = cell / 2;
    ctx.fillStyle = i % 2 === 0
      ? 'rgba(242, 244, 252, 0.82)'
      : 'rgba(26, 26, 36, 0.82)';
    ctx.beginPath();
    ctx.moveTo(cx - tx * halfAlong - nx * halfAcross, cy - ty * halfAlong - ny * halfAcross);
    ctx.lineTo(cx + tx * halfAlong - nx * halfAcross, cy + ty * halfAlong - ny * halfAcross);
    ctx.lineTo(cx + tx * halfAlong + nx * halfAcross, cy + ty * halfAlong + ny * halfAcross);
    ctx.lineTo(cx - tx * halfAlong + nx * halfAcross, cy - ty * halfAlong + ny * halfAcross);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

function drawVignette(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
): void {
  const radius = Math.max(width, height) * 0.72;
  const gradient = ctx.createRadialGradient(
    width / 2,
    height / 2,
    Math.min(width, height) * 0.28,
    width / 2,
    height / 2,
    radius,
  );
  gradient.addColorStop(0, 'rgba(0, 0, 0, 0)');
  gradient.addColorStop(1, 'rgba(0, 0, 0, 0.4)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);
}

function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

function hexToRgb(hex: string): Rgb {
  const value = hex.replace('#', '');
  const full = value.length === 3
    ? value.split('').map((c) => c + c).join('')
    : value;
  const number = Number.parseInt(full, 16);
  return [(number >> 16) & 255, (number >> 8) & 255, number & 255];
}

function withAlpha(hex: string, alpha: number): string {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
