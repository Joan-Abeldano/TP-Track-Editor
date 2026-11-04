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
  readonly closedLoop = computed(() => {
    const track = this.track();
    const pts = track.points;
    return pts.length >= 2 && (
      track.loop_closed === true ||
      (pts[0][0] === pts[pts.length - 1][0] && pts[0][1] === pts[pts.length - 1][1])
    );
  });

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
    if (i === 0 && this.closedLoop()) {
      this.state.toast('Cannot delete start/finish point — move it instead', 'warn');
      return;
    }
    if (i === this.track().points.length - 1 && this.closedLoop()) {
      this.state.toast('Cannot delete the closing duplicate — use Select to move it with the start', 'warn');
      return;
    }
    this.state.update((t) => {
      t.points.splice(i, 1);
    });
    this.state.selectedPointIndex.set(null);
  }

  clearAll() {
    if (!confirm(`Delete all ${this.track().points.length} points?`)) return;
    this.state.update((t) => {
      t.points = [];
      t.loop_closed = false;
    });
    this.state.selectedPointIndex.set(null);
    this.state.toast('All points cleared', 'ok');
  }

  closeLoop() {
    const pts = this.track().points;
    if (pts.length < 2) {
      this.state.toast('Need at least 2 points', 'warn');
      return;
    }
    if (this.closedLoop()) {
      this.state.update((t) => {
        if (t.points.length >= 2 &&
            t.points[0][0] === t.points[t.points.length - 1][0] &&
            t.points[0][1] === t.points[t.points.length - 1][1]) {
          t.points.pop();
        }
        t.loop_closed = false;
      });
      this.state.toast('Loop opened', 'ok');
    } else {
      this.state.update((t) => {
        t.loop_closed = true;
      });
      this.state.toast('Loop closed', 'ok');
    }
  }
}
