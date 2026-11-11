import { Component, computed, EventEmitter, HostListener, inject, Input, Output, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ProceduralTrackService } from '../../procedural/procedural-track.service';
import { TrackCorpusService } from '../../procedural/corpus/corpus.service';
import { TrackStateService } from '../../services/track-state.service';
import { FileIoService } from '../../services/file-io.service';
import { TrackBackgroundService } from '../../services/track-background.service';
import { TERRAIN_BIOMES, TerrainBiome } from '../../procedural/background/terrain-background';
import { ProceduralOptions } from '../../procedural/recipe/recipe.types';

type MetaKey =
  | 'widthM'
  | 'overtaking'
  | 'tyreWear'
  | 'fuelConsumption'
  | 'dnfModifier'
  | 'wetWeatherMultiplier'
  | 'pitLaneLossS';

@Component({
  selector: 'app-generate-dialog',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './generate-dialog.component.html',
  styleUrl: './generate-dialog.component.css',
})
export class GenerateDialogComponent {
  private readonly procedural = inject(ProceduralTrackService);
  private readonly corpus = inject(TrackCorpusService);
  private readonly state = inject(TrackStateService);
  private readonly fileIo = inject(FileIoService);
  private readonly background = inject(TrackBackgroundService);

  @Input() open = false;
  @Output() readonly closed = new EventEmitter<void>();

  readonly busy = signal(false);
  readonly bgBusy = signal(false);
  readonly error = signal('');
  readonly corpusNote = signal('');
  readonly biomes = TERRAIN_BIOMES;

  readonly corpusCount = this.corpus.trackCount;
  readonly corpusBusy = this.corpus.busy;
  readonly hasCorpus = computed(() => this.corpus.trackCount() > 0);

  seed: number | null = null;
  lengthKm = 0;
  cornerCount = 0;
  drsZones = 0;
  biome: TerrainBiome = 'auto';
  backgroundSeed = 0;
  poleSide: '' | 'left' | 'right' = '';
  nationality = '';
  customName = '';

  readonly settings: Record<MetaKey, number | null> = {
    widthM: null,
    overtaking: null,
    tyreWear: null,
    fuelConsumption: null,
    dnfModifier: null,
    wetWeatherMultiplier: null,
    pitLaneLossS: null,
  };

  @HostListener('window:keydown.escape')
  onEscape(): void {
    this.close();
  }

  reroll(): void {
    this.seed = randomSeed();
  }

  close(): void {
    if (!this.busy()) this.closed.emit();
  }

  onBackdrop(): void {
    this.close();
  }

  onSeed(event: Event): void {
    const raw = (event.target as HTMLInputElement).value.trim();
    if (raw === '') {
      this.seed = null;
      return;
    }
    const value = Math.floor(Number(raw));
    this.seed = Number.isFinite(value) ? Math.max(0, value) : null;
  }

  onLength(event: Event): void {
    this.lengthKm = clamp(Number((event.target as HTMLInputElement).value) || 0, 0, 12);
  }

  onCorners(event: Event): void {
    this.cornerCount = clamp(Math.round(Number((event.target as HTMLInputElement).value) || 0), 0, 40);
  }

  onDrsZones(event: Event): void {
    this.drsZones = clamp(Math.round(Number((event.target as HTMLInputElement).value) || 0), 0, 6);
  }

  onBiome(event: Event): void {
    this.biome = (event.target as HTMLSelectElement).value as TerrainBiome;
  }

  onBackgroundSeed(event: Event): void {
    this.backgroundSeed = Math.max(
      0,
      Math.floor(Number((event.target as HTMLInputElement).value) || 0),
    );
  }

  onPoleSide(event: Event): void {
    this.poleSide = (event.target as HTMLSelectElement).value as GenerateDialogComponent['poleSide'];
  }

  onNationality(event: Event): void {
    this.nationality = (event.target as HTMLInputElement).value;
  }

  onName(event: Event): void {
    this.customName = (event.target as HTMLInputElement).value;
  }

  onSetting(event: Event, key: MetaKey): void {
    const raw = (event.target as HTMLInputElement).value.trim();
    if (raw === '') {
      this.settings[key] = null;
      return;
    }
    const value = Number(raw);
    this.settings[key] = Number.isFinite(value) ? value : null;
  }

  async loadCorpus(directory: boolean): Promise<void> {
    if (this.corpusBusy()) return;
    this.error.set('');
    this.corpusNote.set('');

    const files = await this.fileIo.pickFiles('application/json,.json', {
      multiple: true,
      directory,
    });
    if (files.length === 0) return;
    const jsonFiles = files.filter((file) => /\.json$/i.test(file.name));
    if (jsonFiles.length === 0) {
      this.corpusNote.set('No .json track files found in that selection.');
      return;
    }

    try {
      const summary = await this.corpus.addFiles(jsonFiles);
      const skipped = summary.skipped.length;
      const reason = summary.skipped
        .slice(0, 2)
        .map((entry) => `${entry.name}: ${entry.reason}`)
        .join(' · ');
      if (summary.loaded === 0) {
        this.corpusNote.set(`No usable tracks in that selection${reason ? ` — ${reason}` : ''}.`);
        this.state.toast('No usable tracks found', 'warn');
        return;
      }
      this.corpusNote.set(
        skipped > 0
          ? `${summary.loaded} track(s) loaded, ${skipped} skipped${reason ? ` — ${reason}` : ''}.`
          : `${summary.loaded} track(s) loaded.`,
      );
      this.state.toast(
        skipped > 0
          ? `Corpus replaced: ${summary.total} tracks (${skipped} skipped)`
          : `Corpus replaced: ${summary.total} tracks`,
        skipped > 0 ? 'warn' : 'ok',
      );
    } catch (error) {
      this.error.set((error as Error).message);
    }
  }

  async apply(): Promise<void> {
    if (this.busy() || this.bgBusy() || this.corpusBusy()) return;
    if (!this.hasCorpus()) {
      this.error.set('Load your track JSON files first so the generator can work.');
      return;
    }
    this.busy.set(true);
    this.error.set('');

    const seed = this.seed ?? randomSeed();

    const s = this.settings;
    const options: ProceduralOptions = {
      seed,
      mode: 'novel',
      style: 'motifs',
      character: 'technical',
      shape: 'balanced',
      targetLengthKm: this.lengthKm > 0 ? this.lengthKm : undefined,
      cornerCount: this.cornerCount > 0 ? this.cornerCount : undefined,
      drsZones: this.drsZones,
      widthM: s.widthM ?? undefined,
      overtakingDifficulty: s.overtaking ?? undefined,
      tyreWear: s.tyreWear ?? undefined,
      fuelConsumption: s.fuelConsumption ?? undefined,
      dnfModifier: s.dnfModifier ?? undefined,
      wetWeatherMultiplier: s.wetWeatherMultiplier ?? undefined,
      pitLaneLossS: s.pitLaneLossS ?? undefined,
      poleSide: this.poleSide || undefined,
      nationality: this.nationality.trim() || undefined,
      name: this.customName.trim() || undefined,
    };

    try {
      const track = await this.procedural.generate(options);
      this.fileIo.clearBackground();

      const backgroundSeed = this.backgroundSeed > 0 ? this.backgroundSeed : seed;
      let backgroundFailed = false;
      try {
        await this.background.generate(track, backgroundSeed, this.biome);
      } catch {
        backgroundFailed = true;
      }

      this.state.setTrack(track, track.name ?? 'procedural');
      this.state.toast(
        backgroundFailed
          ? `Generated ${track.name} · seed ${seed} (background failed)`
          : `Generated ${track.name} · seed ${seed}`,
        backgroundFailed ? 'err' : 'ok',
      );
      this.closed.emit();
    } catch (error) {
      this.error.set((error as Error).message);
    } finally {
      this.busy.set(false);
    }
  }
}

function randomSeed(): number {
  return Math.floor(Math.random() * 0x7fffffff);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
