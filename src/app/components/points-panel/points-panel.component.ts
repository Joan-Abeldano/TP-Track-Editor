import { Component, inject, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TrackStateService } from '../../services/track-state.service';
import { GeometryService } from '../../services/geometry.service';

@Component({
  selector: 'app-points-panel',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './points-panel.component.html',
  styleUrl: './points-panel.component.css',
})
export class PointsPanelComponent {
  private state = inject(TrackStateService);
  private geom = inject(GeometryService);

  readonly track = this.state.track;
  readonly selected = this.state.selectedPointIndex;

  readonly cum = computed(() => this.geom.computeCumulative(this.track().points));
  readonly total = computed(() => this.geom.totalLength(this.cum()));
  readonly segmentLengths = computed(() => this.cum().map((c) => c.segLength));

  select(i: number) {
    this.state.selectedPointIndex.set(i);
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

  updateCoord(i: number, axis: 0 | 1, e: Event) {
    const n = parseFloat(this.val(e));
    if (isNaN(n)) return;
    this.state.update((t) => {
      t.points[i][axis] = n;
    });
  }

  deletePoint(i: number, e: Event) {
    e.stopPropagation();
    this.state.update((t) => {
      t.points.splice(i, 1);
    });
    this.state.selectedPointIndex.set(null);
  }

  clearAll() {
    if (!confirm(`Delete all ${this.track().points.length} points?`)) return;
    this.state.update((t) => {
      t.points = [];
    });
    this.state.selectedPointIndex.set(null);
    this.state.toast('All points cleared', 'ok');
  }
}
