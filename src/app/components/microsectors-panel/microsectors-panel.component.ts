import { Component, inject, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TrackStateService } from '../../services/track-state.service';
import { CORNER_TYPES, CornerType, MicroSector } from '../../models/track.model';

@Component({
  selector: 'app-microsectors-panel',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './microsectors-panel.component.html',
  styleUrl: './microsectors-panel.component.css',
})
export class MicrosectorsPanelComponent {
  private state = inject(TrackStateService);

  readonly track = this.state.track;
  readonly cornerTypes = CORNER_TYPES;
  readonly selected = this.state.selectedMicroIndex;

  readonly totalPct = computed(() => this.track().micro_sectors.reduce((a, m) => a + (m.length_pct || 0), 0));
  readonly totalValid = computed(() => Math.abs(this.totalPct() - 100) < 0.5);
  readonly trackKm = computed(() => this.track().length_km ?? 0);

  readonly cumPct = computed(() => {
    const arr: number[] = [];
    let cum = 0;
    for (const m of this.track().micro_sectors) {
      arr.push(cum);
      cum += m.length_pct;
    }
    return arr;
  });

  colorFor(type: CornerType): string {
    return CORNER_TYPES.find((c) => c.value === type)?.color ?? '#888';
  }

  lengthMeters(lengthPct: number): string {
    const m = lengthPct / 100 * this.trackKm() * 1000;
    if (m < 100) return `${m.toFixed(0)} m`;
    return `${(m / 1000).toFixed(3)} km`;
  }

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
    return (e.target as HTMLInputElement | HTMLSelectElement).value;
  }

  updateField(i: number, field: keyof MicroSector, e: Event) {
    const v = this.val(e);
    if (field === 'type') {
      this.state.update((t) => {
        t.micro_sectors[i].type = v as CornerType;
      });
      return;
    }
    const n = parseFloat(v);
    if (isNaN(n)) return;
    this.state.update((t) => {
      (t.micro_sectors[i] as any)[field] = n;
    });
  }

  addMicro() {
    const remaining = Math.max(0.5, 100 - this.totalPct());
    const t: CornerType = this.track().micro_sectors.length === 0 ? 'straight' : 'med';
    this.state.update((s) => {
      s.micro_sectors.push({ type: t, length_pct: Number(remaining.toFixed(2)), target_speed_kmh: 250 });
    });
    this.selected.set(this.track().micro_sectors.length - 1);
    this.state.toast('Microsector added', 'ok');
  }

  insertAfter(i: number, e: Event) {
    e.stopPropagation();
    const micros = this.track().micro_sectors;
    if (i < 0 || i >= micros.length) return;
    const cur = micros[i];
    if (cur.length_pct < 0.4) {
      this.state.toast('Microsector too small to split', 'warn');
      return;
    }
    const half = Number((cur.length_pct / 2).toFixed(4));
    this.state.update((t) => {
      t.micro_sectors[i].length_pct = Number((cur.length_pct - half).toFixed(4));
      t.micro_sectors.splice(i + 1, 0, {
        type: 'straight',
        length_pct: half,
        target_speed_kmh: 250,
      });
    });
    this.selected.set(i + 1);
    this.state.toast('Microsector inserted (split in half)', 'ok');
  }

  cycleType(i: number, e: Event) {
    e.stopPropagation();
    const cur = this.track().micro_sectors[i].type;
    const idx = CORNER_TYPES.findIndex((c) => c.value === cur);
    const next = CORNER_TYPES[(idx + 1) % CORNER_TYPES.length];
    this.state.update((t) => {
      t.micro_sectors[i].type = next.value;
    });
  }

  deleteMicro(i: number, e: Event) {
    e.stopPropagation();
    this.state.update((t) => {
      t.micro_sectors.splice(i, 1);
    });
    this.selected.set(null);
  }

  normalizeAll() {
    const sum = this.totalPct();
    if (sum === 0 || this.track().micro_sectors.length === 0) return;
    const factor = 100 / sum;
    this.state.update((t) => {
      t.micro_sectors.forEach((m) => {
        m.length_pct = Number((m.length_pct * factor).toFixed(4));
      });
    });
    this.state.toast(`Renormalized to 100% (was ${sum.toFixed(2)}%)`, 'ok');
  }

  clearAll() {
    if (!confirm('Delete all microsectors?')) return;
    this.state.update((t) => {
      t.micro_sectors = [];
    });
    this.selected.set(null);
  }
}
