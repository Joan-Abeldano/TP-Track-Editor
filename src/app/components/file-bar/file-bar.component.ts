import { Component, HostListener, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TrackStateService } from '../../services/track-state.service';
import { FileIoService } from '../../services/file-io.service';
import { TrackData, createEmptyTrack } from '../../models/track.model';

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

  @HostListener('window:keydown', ['$event'])
  onShortcut(e: KeyboardEvent) {
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

    const key = e.key.toLowerCase();
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

  async onImportTrack() {
    const file = await this.fileIo.pickFile('application/json,.json');
    if (!file) return;
    try {
      const text = await this.fileIo.loadTrackFile(file);
      const data = JSON.parse(text) as TrackData;
      if (!data.points || !Array.isArray(data.points)) {
        throw new Error('Missing points array');
      }
      data.racing_surface = {
        ...createEmptyTrack().racing_surface,
        ...data.racing_surface,
        mode: 'road_course',
      };
      this.state.setTrack(data, file.name.replace(/\.json$/i, ''));
      if (this.fileIo.backgroundImage) {
      }
      this.state.toast(`Imported ${file.name}`, 'ok');
    } catch (e) {
      this.state.toast(`Import failed: ${(e as Error).message}`, 'err');
    }
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

  onSaveTrack() {
    const t = JSON.parse(JSON.stringify(this.state.track())) as TrackData;
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
    const name = (this.trackName() || 'track').replace(/[^\w-]+/g, '_');
    this.fileIo.downloadJson(t, name);
    this.state.toast(`Saved ${name}.json`, 'ok');
  }

  onNameInput(e: Event) {
    const val = (e.target as HTMLInputElement).value;
    this.state.trackName.set(val);
  }
}
