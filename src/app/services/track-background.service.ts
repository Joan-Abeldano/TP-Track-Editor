import { inject, Injectable } from '@angular/core';
import { TrackData } from '../models/track.model';
import { FileIoService } from './file-io.service';
import {
  renderTerrainBackground,
  TerrainBiome,
} from '../procedural/background/terrain-background';

@Injectable({ providedIn: 'root' })
export class TrackBackgroundService {
  private readonly fileIo = inject(FileIoService);
  private lastBiome: TerrainBiome = 'auto';

  async generate(
    track: TrackData,
    seed: number,
    biome: TerrainBiome = 'auto',
  ): Promise<void> {
    this.lastBiome = biome;
    const [rawWidth, rawHeight] = track.raw_canvas_size ?? [];
    const width = Number.isFinite(rawWidth) && rawWidth > 0 ? rawWidth : 1044;
    const height = Number.isFinite(rawHeight) && rawHeight > 0 ? rawHeight : 1080;
    const roadWidth = Math.max(
      6,
      (track.racing_surface?.width_m ?? 12) *
        (track.racing_surface?.visual_lateral_scale ?? 2),
    );

    const canvas = renderTerrainBackground({
      width,
      height,
      seed: seed >>> 0,
      biome,
      trackPoints: track.points,
      roadWidth,
    });

    await this.fileIo.loadBackgroundDataUrl(canvas.toDataURL('image/png'));
  }

  async regenerate(track: TrackData): Promise<void> {
    const seed = Math.floor(Math.random() * 0x7fffffff);
    await this.generate(track, seed, this.lastBiome);
  }
}
