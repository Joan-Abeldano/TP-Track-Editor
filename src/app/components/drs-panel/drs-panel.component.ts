import { Component, inject, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TrackStateService } from '../../services/track-state.service';
import { DrsZone } from '../../models/track.model';

@Component({
  selector: 'app-drs-panel',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './drs-panel.component.html',
  styleUrl: './drs-panel.component.css',
})
export class DrsPanelComponent {
  private state = inject(TrackStateService);

  readonly track = this.state.track;
  readonly selected = this.state.selectedDrsIndex;
  readonly trackKm = computed(() => this.track().length_km ?? 0);

  select(i: number) {
    this.selected.set(i);
  }

  beginEdit() {
    this.state.beginInteraction();
  }

  endEdit() {
    this.state.endInteraction();
  }

  private val(e: Event): string {
    return (e.target as HTMLInputElement).value;
  }

  update(i: number, field: keyof DrsZone, e: Event) {
    let n = parseFloat(this.val(e));
    if (isNaN(n)) return;
    n = Math.max(0, Math.min(1, n));
    this.state.update((t) => {
      (t.drs_zones[i] as any)[field] = Number(n.toFixed(4));
    });
  }

  add() {
    this.state.update((t) => {
      t.drs_zones.push({ detection_progress: 0.05, start_progress: 0.1, end_progress: 0.3 });
    });
    this.selected.set(this.track().drs_zones.length - 1);
    this.state.toast('DRS zone added — drag the markers on the canvas to position', 'ok');
  }

  remove(i: number, e: Event) {
    e.stopPropagation();
    this.state.update((t) => {
      t.drs_zones.splice(i, 1);
    });
    this.selected.set(null);
  }

  duplicate(i: number, e: Event) {
    e.stopPropagation();
    const z = this.track().drs_zones[i];
    this.state.update((t) => {
      t.drs_zones.splice(i + 1, 0, { ...z });
    });
    this.selected.set(i + 1);
    this.state.toast('DRS zone duplicated', 'ok');
  }

  zoneLengthPct(z: DrsZone): number {
    let end = z.end_progress;
    if (end < z.start_progress) end += 1;
    return (end - z.start_progress) * 100;
  }

  zoneLengthMeters(z: DrsZone): string {
    const m = this.zoneLengthPct(z) / 100 * this.trackKm() * 1000;
    if (m < 1000) return `${m.toFixed(0)} m`;
    return `${(m / 1000).toFixed(3)} km`;
  }

  formatPct(p: number): string {
    return (p * 100).toFixed(2) + '%';
  }
}
