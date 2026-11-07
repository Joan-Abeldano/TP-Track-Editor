import { Component, HostListener, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TrackStateService } from '../../services/track-state.service';
import { FileIoService } from '../../services/file-io.service';
import { CornerType, TrackData, createEmptyTrack } from '../../models/track.model';

@Component({
  selector: 'app-file-bar',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './file-bar.component.html',
  styleUrl: './file-bar.component.css',
})
export class FileBarComponent {
  private state = inject(TrackStateService);
  private fileIo = inject(FileIoService);

  readonly trackName = this.state.trackName;
  readonly backgroundUrl = this.fileIo.backgroundUrl;
  readonly hasPoints = this.state.hasPoints;
  showBrandMark = false;

  @HostListener('window:keydown', ['$event'])
  onShortcut(e: KeyboardEvent) {
    const key = e.key.toLowerCase();
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && !e.altKey && key === 'y') {
      this.showBrandMark = true;
      e.preventDefault();
      return;
    }

    if (
      e.defaultPrevented ||
      e.target instanceof HTMLInputElement ||
      e.target instanceof HTMLSelectElement ||
      e.target instanceof HTMLTextAreaElement ||
      (e.target instanceof HTMLElement && e.target.isContentEditable)
    ) {
      return;
    }

    const modifier = e.ctrlKey || e.metaKey;
    if (!modifier) return;

    if (e.altKey && e.shiftKey && key === 'o') {
      e.preventDefault();
      void this.onLoadBackground();
    } else if (e.altKey && !e.shiftKey && key === 'b' && this.backgroundUrl()) {
      e.preventDefault();
      this.clearBackground();
    } else if (e.altKey) {
      return;
    } else if (!e.shiftKey && key === 'n') {
      e.preventDefault();
      this.onNewTrack();
    } else if (!e.shiftKey && key === 'o') {
      e.preventDefault();
      void this.onImportTrack();
    } else if (!e.shiftKey && key === 's') {
      e.preventDefault();
      if (this.hasPoints()) this.onSaveTrack();
    }
  }

  @HostListener('window:keyup', ['$event'])
  onShortcutKeyUp(e: KeyboardEvent) {
    if (['control', 'meta', 'shift', 'y'].includes(e.key.toLowerCase())) {
      this.showBrandMark = false;
    }
  }

  @HostListener('window:blur')
  onWindowBlur() {
    this.showBrandMark = false;
  }

  async onImportTrack() {
    const file = await this.fileIo.pickFile('application/json,.json,application/zip,.zip');
    if (!file) return;
    try {
      const bundle = /\.zip$/i.test(file.name)
        ? await this.fileIo.loadTrackBundle(file)
        : null;
      const text = bundle?.trackText ?? await this.fileIo.loadTrackFile(file);
      const defaults = createEmptyTrack();
      const data = { ...defaults, ...JSON.parse(text) } as TrackData;
      if (!data.points || !Array.isArray(data.points)) {
        throw new Error('Missing points array');
      }
      data.sector_splits = Array.isArray(data.sector_splits) ? data.sector_splits : defaults.sector_splits;
      data.micro_sectors = Array.isArray(data.micro_sectors)
        ? data.micro_sectors.map((micro, index) => ({
          ...micro,
          type: this.normalizeMicrosectorType(micro?.type, index),
        }))
        : defaults.micro_sectors;
      data.drs_zones = Array.isArray(data.drs_zones) ? data.drs_zones : defaults.drs_zones;
      data.racing_surface = {
        ...defaults.racing_surface,
        ...data.racing_surface,
        mode: 'road_course',
      };
      data.starting_grid = { ...defaults.starting_grid, ...data.starting_grid };
      if (bundle) await this.fileIo.loadBackgroundFile(bundle.backgroundFile);
      this.state.setTrack(data, file.name.replace(/\.(json|zip)$/i, ''));
      this.state.toast(`Imported ${file.name}`, 'ok');
    } catch (e) {
      this.state.toast(`Import failed: ${(e as Error).message}`, 'err');
    }
  }

  private normalizeMicrosectorType(value: unknown, index: number): CornerType {
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
      mediumspeed: 'med',
      mediumspeedcorner: 'med',
      low: 'low',
      lowspeed: 'low',
      lowspeedcorner: 'low',
    };
    const type = types[normalized];
    if (!type) {
      throw new Error(`Invalid microsector type at index ${index}: ${String(value)}`);
    }
    return type;
  }

  async onLoadBackground() {
    const file = await this.fileIo.pickFile('image/*');
    if (!file) return;
    try {
      await this.fileIo.loadBackgroundFile(file);
      const w = this.fileIo.backgroundWidth();
      const h = this.fileIo.backgroundHeight();
      this.state.update((t) => {
        if (!t.raw_canvas_size) t.raw_canvas_size = [w, h];
      });
      this.state.toast(`Background ${w}×${h} loaded`, 'ok');
    } catch (e) {
      this.state.toast(`Background failed: ${(e as Error).message}`, 'err');
    }
  }

  clearBackground() {
    this.fileIo.clearBackground();
    this.state.toast('Background cleared', 'ok');
  }

  onNewTrack() {
    if (this.state.track().points.length > 0 && !confirm('Start a new track? Unsaved changes will be lost.')) {
      return;
    }
    this.fileIo.clearBackground();
    this.state.setTrack(createEmptyTrack(), 'untitled');
    this.state.toast('New track created', 'ok');
  }

  async onSaveTrack() {
    const t = JSON.parse(JSON.stringify(this.state.track())) as TrackData;
    t.name = this.trackName().trim() || 'track';
    const pts = t.points;
    if (pts.length >= 2) {
      const first = pts[0];
      const last = pts[pts.length - 1];
      if (first[0] !== last[0] || first[1] !== last[1]) {
        pts.push([first[0], first[1]]);
      }
    }
    if (t.sector_splits.length > 2) {
      t.sector_splits = t.sector_splits.slice(0, 2);
    }
    const sumPct = t.micro_sectors.reduce((a, m) => a + (m.length_pct || 0), 0);
    if (Math.abs(sumPct - 100) > 0.5 && t.micro_sectors.length > 0) {
      this.state.toast(`Warning: microsectors sum to ${sumPct.toFixed(2)}% (should be 100%)`, 'warn');
    }
    const name = (this.trackName().trim() || 'track')
      .replace(/\s+/g, '')
      .replace(/[^\w-]+/g, '_')
      .toLowerCase();
    try {
      if (this.backgroundUrl()) {
        const rawWidth = t.raw_canvas_size?.[0];
        const rawHeight = t.raw_canvas_size?.[1];
        const width = typeof rawWidth === 'number' && Number.isFinite(rawWidth) && rawWidth > 0
          ? rawWidth
          : this.fileIo.backgroundWidth();
        const height = typeof rawHeight === 'number' && Number.isFinite(rawHeight) && rawHeight > 0
          ? rawHeight
          : this.fileIo.backgroundHeight();
        await this.fileIo.downloadTrackBundle(t, name, width, height);
        this.state.toast(`Saved ${name}.zip with track and background`, 'ok');
      } else {
        this.fileIo.downloadJson(t, name);
        this.state.toast(`Saved ${name}.json`, 'ok');
      }
    } catch (e) {
      this.state.toast(`Save failed: ${(e as Error).message}`, 'err');
    }
  }

  onNameInput(e: Event) {
    const val = (e.target as HTMLInputElement).value;
    this.state.trackName.set(val);
  }
}
