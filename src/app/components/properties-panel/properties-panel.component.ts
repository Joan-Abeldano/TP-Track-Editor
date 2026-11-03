import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TrackStateService } from '../../services/track-state.service';
import { TrackData, NATIONALITIES } from '../../models/track.model';

interface SectionState {
  basic: boolean;
  racing: boolean;
  grid: boolean;
  canvas: boolean;
  view: boolean;
}

@Component({
  selector: 'app-properties-panel',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './properties-panel.component.html',
  styleUrl: './properties-panel.component.css',
})
export class PropertiesPanelComponent {
  private state = inject(TrackStateService);

  readonly track = this.state.track;
  readonly nationalities = NATIONALITIES;
  readonly showBackground = this.state.showBackground;
  readonly showMicrosectors = this.state.showMicrosectors;
  readonly showDrs = this.state.showDrs;
  readonly showSectors = this.state.showSectors;
  readonly showPoints = this.state.showPoints;
  readonly snapToGrid = this.state.snapToGrid;
  readonly gridSize = this.state.gridSize;

  readonly collapsed = signal<SectionState>({
    basic: false,
    racing: false,
    grid: false,
    canvas: false,
    view: false,
  });

  toggle(key: keyof SectionState) {
    this.collapsed.update((s) => ({ ...s, [key]: !s[key] }));
  }

  beginEdit() {
    this.state.beginInteraction();
  }

  endEdit() {
    this.state.endInteraction();
  }

  val(e: Event): string {
    return (e.target as HTMLInputElement | HTMLSelectElement).value;
  }

  checked(e: Event): boolean {
    return (e.target as HTMLInputElement).checked;
  }

  num(v: string): number {
    const n = parseFloat(v);
    return isNaN(n) ? 0 : n;
  }

  int(v: string): number {
    const n = parseInt(v);
    return isNaN(n) ? 0 : n;
  }

  setNum(key: keyof TrackData, e: Event) {
    this.state.patch({ [key]: this.num(this.val(e)) } as Partial<TrackData>);
  }

  setStr(key: keyof TrackData, e: Event) {
    this.state.patch({ [key]: this.val(e) } as Partial<TrackData>);
  }

  setFlag(key: 'hide_polyline_visual' | 'use_raw_canvas_coordinates', e: Event) {
    this.state.patch({ [key]: this.checked(e) } as Partial<TrackData>);
  }

  setSurfaceNum(key: keyof TrackData['racing_surface'], e: Event) {
    this.state.update((t) => {
      (t.racing_surface as any)[key] = this.num(this.val(e));
    });
  }

  setSurfaceStr(key: keyof TrackData['racing_surface'], e: Event) {
    this.state.update((t) => {
      (t.racing_surface as any)[key] = this.val(e);
    });
  }

  setSurfaceFlag(key: keyof TrackData['racing_surface'], e: Event) {
    this.state.update((t) => {
      (t.racing_surface as any)[key] = this.checked(e);
    });
  }

  setGridNum(key: keyof TrackData['starting_grid'], e: Event) {
    this.state.update((t) => {
      (t.starting_grid as any)[key] = this.num(this.val(e));
    });
  }

  setGridInt(key: keyof TrackData['starting_grid'], e: Event) {
    this.state.update((t) => {
      (t.starting_grid as any)[key] = this.int(this.val(e));
    });
  }

  setGridStr(key: keyof TrackData['starting_grid'], e: Event) {
    this.state.update((t) => {
      (t.starting_grid as any)[key] = this.val(e);
    });
  }

  setCanvasSize(idx: 0 | 1, e: Event) {
    const n = this.int(this.val(e));
    this.state.update((t) => {
      if (!t.raw_canvas_size) t.raw_canvas_size = [1044, 1080];
      t.raw_canvas_size[idx] = n;
    });
  }
}
