import {
  Component,
  ElementRef,
  AfterViewInit,
  OnDestroy,
  signal,
  computed,
  inject,
  viewChild,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { TrackStateService, EditorTool } from '../../services/track-state.service';
import { FileIoService } from '../../services/file-io.service';
import { GeometryService, Pt, CumulativePoint } from '../../services/geometry.service';
import { CORNER_TYPES } from '../../models/track.model';

type MarkerKind = 'drs-det' | 'drs-start' | 'drs-end' | 'micro-boundary' | 'sector-split';

interface MarkerRef {
  kind: MarkerKind;
  zoneIndex?: number;
  field?: 'detection_progress' | 'start_progress' | 'end_progress';
  microIndex?: number;
  splitIndex?: number;
}

@Component({
  selector: 'app-editor-canvas',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './editor-canvas.component.html',
  styleUrl: './editor-canvas.component.css',
})
export class EditorCanvasComponent implements AfterViewInit, OnDestroy {
  private canvasRef = viewChild.required<ElementRef<HTMLCanvasElement>>('canvas');
  private hostRef = viewChild.required<ElementRef<HTMLDivElement>>('host');

  private state = inject(TrackStateService);
  private fileIo = inject(FileIoService);
  private geom = inject(GeometryService);

  private ctx!: CanvasRenderingContext2D;
  private rafId = 0;
  private dpr = 1;
  private resizeObs?: ResizeObserver;

  readonly hoverPointIndex = signal<number | null>(null);
  readonly cursorPos = signal<Pt | null>(null);
  readonly mouseDown = signal<boolean>(false);
  readonly hoverMarker = signal<MarkerRef | null>(null);
  private draggingPointIndex: number | null = null;
  private draggingMarker: MarkerRef | null = null;
  private panning = false;
  private lastPan: Pt = { x: 0, y: 0 };
  private spaceDown = false;

  readonly tool = this.state.activeTool;
  readonly scale = computed(() => this.state.view().scale);
  readonly canUndo = this.state.canUndo;
  readonly canRedo = this.state.canRedo;

  ngAfterViewInit() {
    const canvas = this.canvasRef().nativeElement;
    this.ctx = canvas.getContext('2d')!;
    this.dpr = window.devicePixelRatio || 1;

    this.resizeObs = new ResizeObserver(() => this.resize());
    this.resizeObs.observe(this.hostRef().nativeElement);
    this.resize();
    this.fitInitialView();

    canvas.addEventListener('mousedown', this.onMouseDown);
    canvas.addEventListener('mousemove', this.onMouseMove);
    canvas.addEventListener('mouseup', this.onMouseUp);
    canvas.addEventListener('mouseleave', this.onMouseUp);
    canvas.addEventListener('wheel', this.onWheel, { passive: false });
    canvas.addEventListener('dblclick', this.onDblClick);
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);

    this.startRenderLoop();
  }

  ngOnDestroy() {
    const canvas = this.canvasRef().nativeElement;
    canvas.removeEventListener('mousedown', this.onMouseDown);
    canvas.removeEventListener('mousemove', this.onMouseMove);
    canvas.removeEventListener('mouseup', this.onMouseUp);
    canvas.removeEventListener('mouseleave', this.onMouseUp);
    canvas.removeEventListener('wheel', this.onWheel);
    canvas.removeEventListener('dblclick', this.onDblClick);
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    this.resizeObs?.disconnect();
    cancelAnimationFrame(this.rafId);
  }

  private resize() {
    const canvas = this.canvasRef().nativeElement;
    const host = this.hostRef().nativeElement;
    const w = host.clientWidth;
    const h = host.clientHeight;
    canvas.width = Math.max(1, Math.floor(w * this.dpr));
    canvas.height = Math.max(1, Math.floor(h * this.dpr));
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
  }

  private fitInitialView() {
    const host = this.hostRef().nativeElement;
    const w = host.clientWidth || 800;
    const h = host.clientHeight || 600;
    const bgW = this.fileIo.backgroundWidth() || 1044;
    const bgH = this.fileIo.backgroundHeight() || 1080;
    const scale = Math.min(w / bgW, h / bgH) * 0.95;
    const offsetX = (w - bgW * scale) / 2;
    const offsetY = (h - bgH * scale) / 2;
    this.state.view.set({ scale, offsetX, offsetY });
  }

  resetView() {
    this.fitInitialView();
  }

  private startRenderLoop() {
    const loop = () => {
      this.render();
      this.rafId = requestAnimationFrame(loop);
    };
    loop();
  }

  private screenToWorld(sx: number, sy: number): Pt {
    const v = this.state.view();
    return { x: (sx - v.offsetX) / v.scale, y: (sy - v.offsetY) / v.scale };
  }

  private worldToScreen(wx: number, wy: number): Pt {
    const v = this.state.view();
    return { x: wx * v.scale + v.offsetX, y: wy * v.scale + v.offsetY };
  }

  private onWheel = (e: WheelEvent) => {
    e.preventDefault();
    const canvas = this.canvasRef().nativeElement;
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
    const v = this.state.view();
    const newScale = Math.max(0.1, Math.min(8, v.scale * factor));
    const wx = (mx - v.offsetX) / v.scale;
    const wy = (my - v.offsetY) / v.scale;
    this.state.view.set({
      scale: newScale,
      offsetX: mx - wx * newScale,
      offsetY: my - wy * newScale,
    });
  };

  private onMouseDown = (e: MouseEvent) => {
    const canvas = this.canvasRef().nativeElement;
    const rect = canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    this.mouseDown.set(true);
    this.lastPan = { x: sx, y: sy };

    if (e.button === 1 || (e.button === 0 && (this.spaceDown || this.tool() === 'pan'))) {
      this.panning = true;
      return;
    }

    if (e.button !== 0) return;

    this.clearSelection();

    const world = this.screenToWorld(sx, sy);
    const tool = this.tool();
    const track = this.state.track();
    const hitRadius = 8 / this.state.view().scale;

    const marker = this.hitTestMarker(sx, sy);
    if (marker) {
      this.draggingMarker = marker;
      this.state.beginInteraction();
      if (marker.kind === 'drs-det' || marker.kind === 'drs-start' || marker.kind === 'drs-end') {
        this.state.selectedDrsIndex.set(marker.zoneIndex!);
      } else if (marker.kind === 'micro-boundary') {
        this.state.selectedMicroIndex.set(marker.microIndex!);
      } else if (marker.kind === 'sector-split') {
        this.state.selectedSectorIndex.set(marker.splitIndex!);
      }
      return;
    }

    if (tool === 'path') {
      this.handlePathClick(world, hitRadius);
    } else if (tool === 'select') {
      const idx = this.geom.nearestPointIndex(track.points, world, hitRadius);
      if (idx !== null) {
        this.state.selectedPointIndex.set(idx);
        this.draggingPointIndex = idx;
        this.state.beginInteraction();
      } else {
        const microIdx = this.hitTestMicrosector(world);
        const drsIdx = this.hitTestDrsZone(world);
        if (drsIdx !== null) {
          this.state.selectedDrsIndex.set(drsIdx);
        } else if (microIdx !== null) {
          this.state.selectedMicroIndex.set(microIdx);
        }
      }
    } else if (tool === 'delete') {
      const idx = this.geom.nearestPointIndex(track.points, world, hitRadius);
      if (idx !== null) this.deletePoint(idx);
    } else if (tool === 'sector') {
      this.addSectorAt(world);
    } else if (tool === 'micro') {
      this.addMicrosectorAt(world);
    } else if (tool === 'drs') {
      this.addDrsAt(world);
    }
  };

  private clearSelection() {
    this.state.selectedPointIndex.set(null);
    this.state.selectedSectorIndex.set(null);
    this.state.selectedDrsIndex.set(null);
    this.state.selectedMicroIndex.set(null);
  }

  private onMouseMove = (e: MouseEvent) => {
    const canvas = this.canvasRef().nativeElement;
    const rect = canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;

    if (this.panning) {
      const v = this.state.view();
      this.state.view.set({
        ...v,
        offsetX: v.offsetX + (sx - this.lastPan.x),
        offsetY: v.offsetY + (sy - this.lastPan.y),
      });
      this.lastPan = { x: sx, y: sy };
      return;
    }

    const world = this.screenToWorld(sx, sy);
    this.cursorPos.set(world);

    if (this.draggingMarker) {
      this.handleMarkerDrag(world);
      return;
    }

    if (this.draggingPointIndex !== null && this.tool() === 'select') {
      const idx = this.draggingPointIndex;
      let snapped = world;
      if (this.state.snapToGrid()) {
        const g = this.state.gridSize();
        snapped = { x: Math.round(world.x / g) * g, y: Math.round(world.y / g) * g };
      } else {
        snapped = { x: Math.round(world.x * 10) / 10, y: Math.round(world.y * 10) / 10 };
      }
      this.state.update((t) => {
        if (idx < t.points.length) {
          t.points[idx] = [snapped.x, snapped.y];
        }
      });
      return;
    }

    const track = this.state.track();
    const hitRadius = 8 / this.state.view().scale;
    const idx = this.geom.nearestPointIndex(track.points, world, hitRadius);
    this.hoverPointIndex.set(idx);
    const marker = this.hitTestMarker(sx, sy);
    this.hoverMarker.set(marker);
    this.updateCanvasCursor(marker);
  };

  private onMouseUp = () => {
    if (this.draggingPointIndex !== null) {
      this.state.endInteraction();
    }
    if (this.draggingMarker) {
      if (this.draggingMarker.kind === 'sector-split') {
        this.state.update((t) => {
          t.sector_splits.sort((a, b) => a - b);
        });
      }
      this.state.endInteraction();
      this.draggingMarker = null;
    }
    this.mouseDown.set(false);
    this.panning = false;
    this.draggingPointIndex = null;
  };

  private updateCanvasCursor(marker: MarkerRef | null) {
    const canvas = this.canvasRef().nativeElement;
    if (this.draggingMarker) {
      canvas.style.cursor = 'grabbing';
    } else if (marker) {
      canvas.style.cursor = 'grab';
    } else {
      canvas.style.cursor = '';
    }
  }

  private handleMarkerDrag(world: Pt) {
    const m = this.draggingMarker!;
    const track = this.state.track();
    if (track.points.length < 2) return;
    const cum = this.geom.computeCumulative(track.points);
    const total = this.geom.totalLength(cum);
    const progress = this.geom.nearestProgress(cum, total, world);
    if (m.kind === 'drs-det' || m.kind === 'drs-start' || m.kind === 'drs-end') {
      const field = m.field!;
      this.state.update((t) => {
        (t.drs_zones[m.zoneIndex!] as any)[field] = Number(progress.toFixed(4));
      });
    } else if (m.kind === 'micro-boundary') {
      const i = m.microIndex!;
      const micros = track.micro_sectors;
      if (i < 0 || i >= micros.length - 1) return;
      const prevC = micros.slice(0, i).reduce((a, x) => a + x.length_pct, 0);
      const nextC = prevC + micros[i].length_pct + micros[i + 1].length_pct;
      let newC = progress * 100;
      newC = Math.max(prevC + 0.1, Math.min(nextC - 0.1, newC));
      this.state.update((t) => {
        const mi = t.micro_sectors[i];
        const mi1 = t.micro_sectors[i + 1];
        const sum = mi.length_pct + mi1.length_pct;
        mi.length_pct = Number((newC - prevC).toFixed(4));
        mi1.length_pct = Number((sum - mi.length_pct).toFixed(4));
      });
    } else if (m.kind === 'sector-split') {
      const i = m.splitIndex!;
      this.state.update((t) => {
        if (i < t.sector_splits.length) {
          t.sector_splits[i] = Number(progress.toFixed(4));
        }
      });
    }
  }

  private hitTestMarker(sx: number, sy: number): MarkerRef | null {
    const track = this.state.track();
    if (track.points.length < 2) return null;
    const cum = this.geom.computeCumulative(track.points);
    const total = this.geom.totalLength(cum);
    if (total <= 0) return null;
    const scale = this.state.view().scale;
    const widthWorld = this.getTrackWidthWorld();
    const drsMarkerScreenR = Math.max(8, 7 * Math.sqrt(scale));
    const microBoundaryScreenR = Math.max(12, widthWorld * scale / 2 + 6);

    for (let i = 0; i < track.sector_splits.length; i++) {
      const p = this.geom.progressToPoint(cum, total, track.sector_splits[i]);
      const s = this.worldToScreen(p.x, p.y);
      if (Math.hypot(s.x - sx, s.y - sy) <= Math.max(8, 9 * Math.sqrt(scale)) + 4) {
        return { kind: 'sector-split', splitIndex: i };
      }
    }

    for (let i = 0; i < track.drs_zones.length; i++) {
      const z = track.drs_zones[i];
      const fields: { field: 'detection_progress' | 'start_progress' | 'end_progress'; kind: MarkerKind }[] = [
        { field: 'detection_progress', kind: 'drs-det' },
        { field: 'start_progress', kind: 'drs-start' },
        { field: 'end_progress', kind: 'drs-end' },
      ];
      for (const f of fields) {
        const p = this.geom.progressToPoint(cum, total, (z as any)[f.field]);
        const s = this.worldToScreen(p.x, p.y);
        if (Math.hypot(s.x - sx, s.y - sy) <= drsMarkerScreenR + 4) {
          return { kind: f.kind, zoneIndex: i, field: f.field };
        }
      }
    }

    if (this.state.showMicrosectors() && track.micro_sectors.length > 1) {
      let cumPct = 0;
      for (let i = 0; i < track.micro_sectors.length - 1; i++) {
        cumPct += track.micro_sectors[i].length_pct / 100;
        const p = this.geom.progressToPoint(cum, total, cumPct);
        const s = this.worldToScreen(p.x, p.y);
        if (Math.hypot(s.x - sx, s.y - sy) <= microBoundaryScreenR) {
          return { kind: 'micro-boundary', microIndex: i };
        }
      }
    }

    return null;
  }

  private hitTestMicrosector(world: Pt): number | null {
    const track = this.state.track();
    if (track.points.length < 2 || track.micro_sectors.length === 0) return null;
    const cum = this.geom.computeCumulative(track.points);
    const total = this.geom.totalLength(cum);
    if (total <= 0) return null;
    const p = this.geom.progressToPoint(cum, total, this.geom.nearestProgress(cum, total, world));
    if (this.geom.dist(p, world) > this.getTrackWidthWorld()) return null;
    const prog = this.geom.nearestProgress(cum, total, world);
    const pct = prog * 100;
    let cumPct = 0;
    for (let i = 0; i < track.micro_sectors.length; i++) {
      cumPct += track.micro_sectors[i].length_pct;
      if (pct <= cumPct) return i;
    }
    return track.micro_sectors.length - 1;
  }

  private hitTestDrsZone(world: Pt): number | null {
    const track = this.state.track();
    if (track.points.length < 2 || track.drs_zones.length === 0) return null;
    const cum = this.geom.computeCumulative(track.points);
    const total = this.geom.totalLength(cum);
    if (total <= 0) return null;
    const p = this.geom.progressToPoint(cum, total, this.geom.nearestProgress(cum, total, world));
    if (this.geom.dist(p, world) > this.getTrackWidthWorld()) return null;
    const prog = this.geom.nearestProgress(cum, total, world);
    for (let i = 0; i < track.drs_zones.length; i++) {
      const z = track.drs_zones[i];
      let start = z.start_progress;
      let end = z.end_progress;
      if (end < start) end += 1;
      if (prog >= start && prog <= end) return i;
    }
    return null;
  }

  private onDblClick = (e: MouseEvent) => {
    if (this.tool() === 'path') {
      const canvas = this.canvasRef().nativeElement;
      const rect = canvas.getBoundingClientRect();
      const world = this.screenToWorld(e.clientX - rect.left, e.clientY - rect.top);
      const track = this.state.track();
      const hitRadius = 12 / this.state.view().scale;
      const idx = this.geom.nearestPointIndex(track.points, world, hitRadius);
      if (idx === 0 && track.points.length >= 3) {
        this.state.toast('Path closed automatically — last point connects to start', 'ok');
      }
    }
  };

  private onKeyDown = (e: KeyboardEvent) => {
    if (
      e.target instanceof HTMLInputElement ||
      e.target instanceof HTMLSelectElement ||
      e.target instanceof HTMLTextAreaElement ||
      (e.target instanceof HTMLElement && e.target.isContentEditable)
    ) {
      return;
    }
    if (e.code === 'Space' && !this.spaceDown) {
      this.spaceDown = true;
      e.preventDefault();
    }
    if (e.key === 'Escape' && this.draggingPointIndex !== null) {
      this.state.cancelInteraction();
      this.draggingPointIndex = null;
      this.mouseDown.set(false);
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
      e.preventDefault();
      this.state.undo();
    }
    if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.shiftKey && e.key === 'Z'))) {
      e.preventDefault();
      this.state.redo();
    }
    if (e.key === 'Delete' || e.key === 'Backspace') {
      const sel = this.state.selectedPointIndex();
      if (sel !== null) {
        e.preventDefault();
        this.deletePoint(sel);
      }
    }
    if (!e.ctrlKey && !e.metaKey && !e.altKey) {
      if (e.key === '+' || (e.key === '=' && e.shiftKey)) {
        e.preventDefault();
        this.zoomIn();
      } else if (e.key === '-') {
        e.preventDefault();
        this.zoomOut();
      } else if (e.key === '0') {
        e.preventDefault();
        this.resetView();
      } else if (!e.shiftKey) {
        const tools: Record<string, EditorTool> = {
          p: 'path',
          v: 'select',
          d: 'delete',
          s: 'sector',
          m: 'micro',
          r: 'drs',
          h: 'pan',
        };
        const tool = tools[e.key.toLowerCase()];
        if (tool) this.state.activeTool.set(tool);
      }
    }
  };

  private onKeyUp = (e: KeyboardEvent) => {
    if (e.code === 'Space') this.spaceDown = false;
  };

  private handlePathClick(world: Pt, hitRadius: number) {
    const track = this.state.track();
    const pts = track.points;

    if (pts.length === 0) {
      this.state.update((t) => {
        t.points.push([this.maybeSnap(world).x, this.maybeSnap(world).y]);
      });
      this.state.selectedPointIndex.set(0);
      return;
    }

    const nearest = this.nearestPathSegment(world, pts);
    if (nearest && nearest.distance <= 14 / this.state.view().scale) {
      const insertIndex = nearest.segmentIndex + 1;
      const point = this.maybeSnap(nearest.point);
      this.state.update((t) => {
        t.points.splice(insertIndex, 0, [point.x, point.y]);
      });
      this.state.selectedPointIndex.set(insertIndex);
      return;
    }

    const nearFirst = this.geom.dist({ x: pts[0][0], y: pts[0][1] }, world) <= hitRadius * 1.5;
    if (nearFirst && pts.length >= 3) {
      this.state.toast('Path is closed. Use Select tool to move points or Delete tool to remove.', 'ok');
      return;
    }

    let snapped = this.maybeSnap(world);
    this.state.update((t) => {
      if (t.points.length >= 2 && this.arrayEq(t.points[0], t.points[t.points.length - 1])) {
        t.points.splice(t.points.length - 1, 0, [snapped.x, snapped.y]);
      } else {
        t.points.push([snapped.x, snapped.y]);
      }
    });
    this.state.selectedPointIndex.set(this.state.track().points.length - 1);
  }

  private nearestPathSegment(
    point: Pt,
    points: number[][],
  ): { segmentIndex: number; point: Pt; distance: number } | null {
    let nearest: { segmentIndex: number; point: Pt; distance: number } | null = null;
    for (let i = 0; i < points.length; i++) {
      const start = points[i];
      const end = points[(i + 1) % points.length];
      const dx = end[0] - start[0];
      const dy = end[1] - start[1];
      const lengthSquared = dx * dx + dy * dy;
      if (lengthSquared === 0) continue;

      const t = Math.max(0, Math.min(1, ((point.x - start[0]) * dx + (point.y - start[1]) * dy) / lengthSquared));
      const projected = { x: start[0] + t * dx, y: start[1] + t * dy };
      const distance = this.geom.dist(point, projected);
      if (!nearest || distance < nearest.distance) {
        nearest = { segmentIndex: i, point: projected, distance };
      }
    }
    return nearest;
  }

  private maybeSnap(world: Pt): Pt {
    if (this.state.snapToGrid()) {
      const g = this.state.gridSize();
      return { x: Math.round(world.x / g) * g, y: Math.round(world.y / g) * g };
    }
    return { x: Math.round(world.x * 10) / 10, y: Math.round(world.y * 10) / 10 };
  }

  private arrayEq(a: number[], b: number[]): boolean {
    return a[0] === b[0] && a[1] === b[1];
  }

  private deletePoint(idx: number) {
    const track = this.state.track();
    if (idx === 0 && track.points.length >= 2 && this.arrayEq(track.points[0], track.points[track.points.length - 1])) {
      this.state.toast('Cannot delete start/finish point — move it instead', 'warn');
      return;
    }
    if (idx === track.points.length - 1 && track.points.length >= 2 && this.arrayEq(track.points[0], track.points[track.points.length - 1])) {
      this.state.toast('Cannot delete closing point — delete the duplicate instead', 'warn');
      return;
    }
    this.state.update((t) => {
      t.points.splice(idx, 1);
    });
    this.state.selectedPointIndex.set(null);
  }

  private addSectorAt(world: Pt) {
    const track = this.state.track();
    if (track.points.length < 2) {
      this.state.toast('Add some points first', 'warn');
      return;
    }
    const cum = this.geom.computeCumulative(track.points);
    const total = this.geom.totalLength(cum);
    if (track.sector_splits.length >= 2) {
      this.state.toast('Already two sector splits — move an existing split instead', 'warn');
      return;
    }
    const progress = this.geom.nearestProgress(cum, total, world);
    this.state.update((t) => {
      t.sector_splits.push(Number(progress.toFixed(4)));
      t.sector_splits.sort((a, b) => a - b);
    });
    this.state.toast(`Sector split added at ${(progress * 100).toFixed(1)}%`, 'ok');
  }

  private addMicrosectorAt(world: Pt) {
    const track = this.state.track();
    if (track.points.length < 2) {
      this.state.toast('Add some points first', 'warn');
      return;
    }

    const micros = track.micro_sectors;
    const totalPct = micros.reduce((sum, micro) => sum + micro.length_pct, 0);
    if (micros.length > 0 && Math.abs(totalPct - 100) >= 0.5) {
      this.state.toast('Normalize microsectors to 100% before adding one', 'warn');
      return;
    }

    const cum = this.geom.computeCumulative(track.points);
    const total = this.geom.totalLength(cum);
    const progress = this.geom.nearestProgress(cum, total, world);
    const positionPct = progress * 100;
    const minimumPct = 0.1;

    if (micros.length === 0) {
      if (positionPct < minimumPct || positionPct > 100 - minimumPct) {
        this.state.toast('Click farther from the start/finish to add a divider', 'warn');
        return;
      }
      this.state.update((t) => {
        t.micro_sectors = [
          { type: 'straight', length_pct: Number(positionPct.toFixed(4)), target_speed_kmh: 250 },
          { type: 'straight', length_pct: Number((100 - positionPct).toFixed(4)), target_speed_kmh: 250 },
        ];
      });
      this.state.selectedMicroIndex.set(1);
      this.state.toast('Microsector divider added', 'ok');
      return;
    }

    let startPct = 0;
    const index = micros.findIndex((micro) => {
      const endPct = startPct + micro.length_pct;
      const containsPosition = positionPct >= startPct && positionPct <= endPct;
      if (!containsPosition) startPct = endPct;
      return containsPosition;
    });
    if (index < 0) {
      this.state.toast('Could not find a microsector at that position', 'warn');
      return;
    }

    const current = micros[index];
    const leftPct = positionPct - startPct;
    const rightPct = current.length_pct - leftPct;
    if (leftPct < minimumPct || rightPct < minimumPct) {
      this.state.toast('Click farther from an existing divider', 'warn');
      return;
    }

    this.state.update((t) => {
      t.micro_sectors[index].length_pct = Number(leftPct.toFixed(4));
      t.micro_sectors.splice(index + 1, 0, {
        ...current,
        length_pct: Number(rightPct.toFixed(4)),
      });
    });
    this.state.selectedMicroIndex.set(index + 1);
    this.state.toast('Microsector added at clicked position', 'ok');
  }

  private addDrsAt(world: Pt) {
    const track = this.state.track();
    if (track.points.length < 2) {
      this.state.toast('Add some points first', 'warn');
      return;
    }
    const cum = this.geom.computeCumulative(track.points);
    const total = this.geom.totalLength(cum);
    let bestProgress = 0;
    let bestDist = Infinity;
    const steps = 200;
    for (let i = 0; i <= steps; i++) {
      const p = i / steps;
      const pt = this.geom.progressToPoint(cum, total, p);
      const d = this.geom.dist(pt, world);
      if (d < bestDist) {
        bestDist = d;
        bestProgress = p;
      }
    }
    const start = Number(bestProgress.toFixed(4));
    let end = Number(((start + 0.1) % 1).toFixed(4));
    const detection = Number(((start - 0.02 + 1) % 1).toFixed(4));
    this.state.update((t) => {
      t.drs_zones.push({ detection_progress: detection, start_progress: start, end_progress: end });
    });
    const idx = this.state.track().drs_zones.length - 1;
    this.state.selectedDrsIndex.set(idx);
    this.state.toast('DRS zone added — adjust detection/start/end in the panel', 'ok');
  }

  zoomIn() {
    const v = this.state.view();
    this.state.view.set({ ...v, scale: Math.min(8, v.scale * 1.2) });
  }

  zoomOut() {
    const v = this.state.view();
    this.state.view.set({ ...v, scale: Math.max(0.1, v.scale / 1.2) });
  }

  private render() {
    const ctx = this.ctx;
    const canvas = this.canvasRef().nativeElement;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#0b0b12';
    ctx.fillRect(0, 0, w, h);

    this.drawGrid(w, h);
    this.drawBackground();
    this.drawTrack();
    this.drawCursor();
  }

  private drawGrid(w: number, h: number) {
    const ctx = this.ctx;
    const v = this.state.view();
    const grid = this.state.gridSize();
    ctx.strokeStyle = 'rgba(120, 100, 200, 0.06)';
    ctx.lineWidth = 1;
    const startX = Math.floor(-v.offsetX / v.scale / grid) * grid;
    const startY = Math.floor(-v.offsetY / v.scale / grid) * grid;
    const endX = startX + (w / v.scale) + grid * 2;
    const endY = startY + (h / v.scale) + grid * 2;
    ctx.beginPath();
    for (let x = startX; x < endX; x += grid) {
      const s = this.worldToScreen(x, 0);
      ctx.moveTo(s.x, 0);
      ctx.lineTo(s.x, h);
    }
    for (let y = startY; y < endY; y += grid) {
      const s = this.worldToScreen(0, y);
      ctx.moveTo(0, s.y);
      ctx.lineTo(w, s.y);
    }
    ctx.stroke();
  }

  private drawBackground() {
    if (!this.state.showBackground()) return;
    const img = this.fileIo.backgroundImage;
    if (!img) return;
    const ctx = this.ctx;
    ctx.save();
    const tl = this.worldToScreen(0, 0);
    const br = this.worldToScreen(img.naturalWidth, img.naturalHeight);
    ctx.globalAlpha = 0.85;
    ctx.drawImage(img, tl.x, tl.y, br.x - tl.x, br.y - tl.y);
    ctx.restore();
  }

  private drawTrack() {
    const ctx = this.ctx;
    const track = this.state.track();
    const pts = track.points;
    if (pts.length === 0) {
      this.drawEmptyHint();
      return;
    }

    const screenPts = pts.map((p) => this.worldToScreen(p[0], p[1]));
    const cum = this.geom.computeCumulative(pts);
    const total = this.geom.totalLength(cum);

    const thinTrackLine = this.state.thinTrackLine();
    if (!thinTrackLine) this.drawRoadSurface(cum, total);

    if (this.state.showMicrosectors() && total > 0 && track.micro_sectors.length > 0) {
      if (thinTrackLine) {
        this.drawMicrosectorBoundaries(cum, total, track.micro_sectors, true);
      } else {
        this.drawMicrosectorsOnRoad(cum, total);
      }
    }

    if (thinTrackLine || !track.hide_polyline_visual) {
      this.drawCenterline(cum, total, thinTrackLine);
    }

    if (this.state.showDrs() && total > 0 && track.drs_zones.length > 0) {
      this.drawDrsZones(cum, total);
    }

    if (this.state.showSectors() && total > 0) {
      this.drawSectors(cum, total);
    }

    if (this.state.showPoints()) {
      this.drawPoints(screenPts);
    }
  }

  private getTrackWidthWorld(): number {
    const track = this.state.track();
    const w = track.racing_surface?.width_m ?? 12;
    const s = track.racing_surface?.visual_lateral_scale ?? 2;
    return Math.max(2, w * s);
  }

  private drawRoadSurface(cum: CumulativePoint[], total: number) {
    const ctx = this.ctx;
    const widthWorld = this.getTrackWidthWorld();
    const scale = this.state.view().scale;
    const widthScreen = widthWorld * scale;
    if (total <= 0) return;
    const steps = Math.max(80, Math.min(600, Math.floor(total / 3)));
    const leftEdge: Pt[] = [];
    const rightEdge: Pt[] = [];
    for (let i = 0; i <= steps; i++) {
      const p = i / steps;
      const pt = this.geom.progressToPoint(cum, total, p);
      const ang = this.geom.progressToAngle(cum, total, p);
      const nx = -Math.sin(ang) * widthWorld / 2;
      const ny = Math.cos(ang) * widthWorld / 2;
      leftEdge.push({ x: pt.x + nx, y: pt.y + ny });
      rightEdge.push({ x: pt.x - nx, y: pt.y - ny });
    }
    ctx.beginPath();
    for (let i = 0; i < leftEdge.length; i++) {
      const s = this.worldToScreen(leftEdge[i].x, leftEdge[i].y);
      if (i === 0) ctx.moveTo(s.x, s.y);
      else ctx.lineTo(s.x, s.y);
    }
    for (let i = rightEdge.length - 1; i >= 0; i--) {
      const s = this.worldToScreen(rightEdge[i].x, rightEdge[i].y);
      ctx.lineTo(s.x, s.y);
    }
    ctx.closePath();
    ctx.fillStyle = '#1c1c2b';
    ctx.fill();
    if (widthScreen >= 4) {
      ctx.strokeStyle = 'rgba(120, 100, 200, 0.35)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }

  private drawMicrosectorsOnRoad(cum: CumulativePoint[], total: number) {
    const ctx = this.ctx;
    const track = this.state.track();
    const micros = track.micro_sectors;
    const widthWorld = this.getTrackWidthWorld();
    const scale = this.state.view().scale;
    const widthScreen = widthWorld * scale * 0.92;
    const selectedMicro = this.state.selectedMicroIndex();
    let cumPct = 0;
    const steps = 24;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'butt';
    for (let m = 0; m < micros.length; m++) {
      const ms = micros[m];
      const startP = cumPct;
      const endP = cumPct + ms.length_pct / 100;
      const typeInfo = CORNER_TYPES.find((c) => c.value === ms.type) ?? CORNER_TYPES[0];
      const isSelected = selectedMicro === m;
      ctx.strokeStyle = typeInfo.color;
      ctx.lineWidth = Math.max(2.5, widthScreen) + (isSelected ? Math.max(2, widthScreen * 0.18) : 0);
      ctx.globalAlpha = isSelected ? 0.95 : 0.72;
      ctx.beginPath();
      let started = false;
      for (let i = 0; i <= steps; i++) {
        const p = startP + ((endP - startP) * i) / steps;
        const pt = this.geom.progressToPoint(cum, total, p);
        const s = this.worldToScreen(pt.x, pt.y);
        if (!started) {
          ctx.moveTo(s.x, s.y);
          started = true;
        } else {
          ctx.lineTo(s.x, s.y);
        }
      }
      ctx.stroke();
      cumPct = endP;
    }
    ctx.globalAlpha = 1;
    this.drawMicrosectorBoundaries(cum, total, micros);
  }

  private drawMicrosectorBoundaries(cum: CumulativePoint[], total: number, micros: any[], thin = false) {
    const ctx = this.ctx;
    const widthWorld = this.getTrackWidthWorld();
    const scale = this.state.view().scale;
    const hover = this.hoverMarker();
    let cumPct = 0;
    for (let m = 0; m < micros.length - 1; m++) {
      cumPct += micros[m].length_pct / 100;
      const pt = this.geom.progressToPoint(cum, total, cumPct);
      const ang = this.geom.progressToAngle(cum, total, cumPct);
      const nx = -Math.sin(ang) * widthWorld / 2;
      const ny = Math.cos(ang) * widthWorld / 2;
      const a = this.worldToScreen(pt.x + nx, pt.y + ny);
      const b = this.worldToScreen(pt.x - nx, pt.y - ny);
      const isHover = hover?.kind === 'micro-boundary' && hover?.microIndex === m;
      const isDragging = this.draggingMarker?.kind === 'micro-boundary' && this.draggingMarker?.microIndex === m;
      if (!thin) {
        ctx.strokeStyle = isHover || isDragging ? '#c9acff' : 'rgba(11, 11, 18, 0.85)';
        ctx.lineWidth = isHover || isDragging ? 3 : widthWorld * scale >= 8 ? 1.5 : 1;
        ctx.setLineDash(isHover || isDragging ? [4, 3] : []);
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      ctx.fillStyle = isHover || isDragging ? '#e2d6ff' : '#0b0b12';
      ctx.strokeStyle = '#c9acff';
      ctx.lineWidth = isHover || isDragging ? 2 : 1.5;
      ctx.beginPath();
      ctx.arc(mid.x, mid.y, isHover || isDragging ? 6 : 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  }

  private drawCenterline(cum: CumulativePoint[], total: number, thin = false) {
    const ctx = this.ctx;
    const track = this.state.track();
    const pts = track.points;
    const hasMicros = !thin && this.state.showMicrosectors() && track.micro_sectors.length > 0;
    ctx.lineWidth = thin ? 1.5 : hasMicros ? 1.2 : Math.max(2, 3 * this.state.view().scale * 0.8);
    ctx.strokeStyle = hasMicros ? 'rgba(232, 230, 245, 0.6)' : 'rgba(182, 156, 255, 0.95)';
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    if (hasMicros) ctx.setLineDash([5, 5]);
    ctx.beginPath();
    const first = this.worldToScreen(pts[0][0], pts[0][1]);
    ctx.moveTo(first.x, first.y);
    for (let i = 1; i < pts.length; i++) {
      const s = this.worldToScreen(pts[i][0], pts[i][1]);
      ctx.lineTo(s.x, s.y);
    }
    if (pts.length >= 2) {
      ctx.lineTo(first.x, first.y);
    }
    ctx.stroke();
    if (hasMicros) ctx.setLineDash([]);
  }

  private drawDrsZones(cum: CumulativePoint[], total: number) {
    const ctx = this.ctx;
    const track = this.state.track();
    const widthWorld = this.getTrackWidthWorld();
    const scale = this.state.view().scale;
    const stripeWidth = Math.max(3, widthWorld * scale * 0.28);
    const steps = 48;
    const hover = this.hoverMarker();
    const dragging = this.draggingMarker;
    for (let i = 0; i < track.drs_zones.length; i++) {
      const z = track.drs_zones[i];
      const selected = this.state.selectedDrsIndex() === i;
      let start = z.start_progress;
      let end = z.end_progress;
      if (end < start) end += 1;
      ctx.strokeStyle = selected ? '#c9acff' : 'rgba(182, 156, 255, 0.95)';
      ctx.lineWidth = stripeWidth + (selected ? 1 : 0);
      ctx.globalAlpha = selected ? 1 : 0.9;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.setLineDash([12, 6]);
      ctx.beginPath();
      let started = false;
      for (let s = 0; s <= steps; s++) {
        const p = (start + ((end - start) * s) / steps) % 1;
        const pt = this.geom.progressToPoint(cum, total, p);
        const screen = this.worldToScreen(pt.x, pt.y);
        if (!started) {
          ctx.moveTo(screen.x, screen.y);
          started = true;
        } else {
          ctx.lineTo(screen.x, screen.y);
        }
      }
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;

      const baseR = Math.max(4, 6 * Math.sqrt(scale));
      const markers: { field: 'detection_progress' | 'start_progress' | 'end_progress'; color: string; label: string; kind: MarkerKind }[] = [
        { field: 'detection_progress', color: '#ffcc6b', label: 'DET', kind: 'drs-det' },
        { field: 'start_progress', color: '#6bd8a0', label: 'START', kind: 'drs-start' },
        { field: 'end_progress', color: '#ff6b8b', label: 'END', kind: 'drs-end' },
      ];
      for (const mk of markers) {
        const mkPos = this.geom.progressToPoint(cum, total, (z as any)[mk.field]);
        const mkScreen = this.worldToScreen(mkPos.x, mkPos.y);
        const isHover = hover?.kind === mk.kind && hover?.zoneIndex === i;
        const isDragging = dragging?.kind === mk.kind && dragging?.zoneIndex === i;
        const r = baseR * (selected || isHover || isDragging ? 1.4 : 1);
        if (isHover || isDragging) {
          ctx.fillStyle = 'rgba(201, 172, 255, 0.25)';
          ctx.beginPath();
          ctx.arc(mkScreen.x, mkScreen.y, r + 6, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.fillStyle = mk.color;
        ctx.strokeStyle = selected ? '#c9acff' : '#0b0b12';
        ctx.lineWidth = selected ? 2.5 : 2;
        ctx.beginPath();
        ctx.arc(mkScreen.x, mkScreen.y, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        if (selected || isHover || isDragging) {
          ctx.fillStyle = '#e8e6f5';
          ctx.font = `bold ${Math.max(9, 10 * scale)}px Inter, sans-serif`;
          ctx.fillText(mk.label, mkScreen.x + r + 4, mkScreen.y - r - 2);
        }
      }
    }
  }

  private drawSectors(cum: CumulativePoint[], total: number) {
    const ctx = this.ctx;
    const track = this.state.track();
    const widthWorld = this.getTrackWidthWorld();
    const scale = this.state.view().scale;
    const half = widthWorld / 2 + 6;
    const hover = this.hoverMarker();
    const dragging = this.draggingMarker;
    for (let i = 0; i < track.sector_splits.length; i++) {
      const p = track.sector_splits[i];
      const pt = this.geom.progressToPoint(cum, total, p);
      const ang = this.geom.progressToAngle(cum, total, p);
      const nx = -Math.sin(ang);
      const ny = Math.cos(ang);
      const a = this.worldToScreen(pt.x - nx * half, pt.y - ny * half);
      const b = this.worldToScreen(pt.x + nx * half, pt.y + ny * half);
      ctx.strokeStyle = '#b69cff';
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 4]);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
      ctx.setLineDash([]);
      const isHover = hover?.kind === 'sector-split' && hover.splitIndex === i;
      const isDragging = dragging?.kind === 'sector-split' && dragging.splitIndex === i;
      const markerR = Math.max(8, 9 * Math.sqrt(scale)) * (isHover || isDragging ? 1.3 : 1);
      if (isHover || isDragging) {
        ctx.fillStyle = 'rgba(201, 172, 255, 0.25)';
        ctx.beginPath();
        ctx.arc(a.x + (b.x - a.x) * 0.5, a.y + (b.y - a.y) * 0.5, markerR + 6, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = '#0b0b12';
      ctx.beginPath();
      ctx.arc(a.x + (b.x - a.x) * 0.5, a.y + (b.y - a.y) * 0.5, markerR, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = isHover || isDragging ? '#e2d6ff' : '#b69cff';
      ctx.lineWidth = isHover || isDragging ? 2.5 : 1.5;
      ctx.stroke();
      ctx.fillStyle = '#b69cff';
      ctx.font = `bold ${Math.max(9, 10 * scale)}px Inter, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(`S${i + 1}`, a.x + (b.x - a.x) * 0.5, a.y + (b.y - a.y) * 0.5);
      ctx.textAlign = 'start';
      ctx.textBaseline = 'alphabetic';
    }
  }

  private drawPoints(screenPts: Pt[]) {
    const ctx = this.ctx;
    const track = this.state.track();
    const sel = this.state.selectedPointIndex();
    const hover = this.hoverPointIndex();
    const scale = this.state.view().scale;
    const r = Math.max(3, 5 * Math.sqrt(scale));
    for (let i = 0; i < screenPts.length; i++) {
      const p = screenPts[i];
      const isStart = i === 0 && track.points.length >= 2 && this.arrayEq(track.points[0], track.points[track.points.length - 1]);
      const isSel = i === sel;
      const isHover = i === hover;

      ctx.beginPath();
      ctx.arc(p.x, p.y, r + (isSel ? 3 : 0), 0, Math.PI * 2);
      if (isStart) {
        ctx.fillStyle = '#6bd8a0';
      } else if (isSel) {
        ctx.fillStyle = '#9b78ff';
      } else if (isHover) {
        ctx.fillStyle = '#b69cff';
      } else {
        ctx.fillStyle = '#24243a';
      }
      ctx.fill();
      ctx.strokeStyle = isStart ? '#6bd8a0' : isSel ? '#9b78ff' : '#b69cff';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      if (isSel || isHover) {
        ctx.fillStyle = '#e8e6f5';
        ctx.font = `${Math.max(9, 10 * scale)}px Inter, sans-serif`;
        ctx.fillText(`${i}`, p.x + r + 3, p.y - r - 3);
      }
    }
  }

  private drawCursor() {
    if (this.tool() !== 'path' || !this.cursorPos() || this.state.track().points.length === 0) return;
    const ctx = this.ctx;
    const track = this.state.track();
    const pts = track.points;
    const last = pts[pts.length - 1];
    if (!last) return;
    const a = this.worldToScreen(last[0], last[1]);
    const b = this.worldToScreen(this.cursorPos()!.x, this.cursorPos()!.y);
    ctx.strokeStyle = 'rgba(182, 156, 255, 0.5)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([5, 5]);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    ctx.setLineDash([]);

    if (pts.length >= 3) {
      const first = pts[0];
      const c = this.worldToScreen(first[0], first[1]);
      ctx.strokeStyle = 'rgba(107, 216, 160, 0.4)';
      ctx.setLineDash([3, 6]);
      ctx.beginPath();
      ctx.moveTo(b.x, b.y);
      ctx.lineTo(c.x, c.y);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  private drawEmptyHint() {
    const ctx = this.ctx;
    const canvas = this.canvasRef().nativeElement;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    ctx.fillStyle = 'rgba(182, 156, 255, 0.6)';
    ctx.font = '14px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Click anywhere with the Path tool to start drawing', w / 2, h / 2);
    ctx.font = '12px Inter, sans-serif';
    ctx.fillStyle = 'rgba(160, 159, 184, 0.5)';
    ctx.fillText('Tip: load a PNG background to trace an existing track', w / 2, h / 2 + 22);
    ctx.textAlign = 'start';
  }
}
