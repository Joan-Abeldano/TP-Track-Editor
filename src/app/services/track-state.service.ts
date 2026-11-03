import { Injectable, signal, computed } from '@angular/core';
import { TrackData, createEmptyTrack } from '../models/track.model';

export type EditorTool = 'path' | 'select' | 'delete' | 'sector' | 'drs' | 'pan';

export interface ViewTransform {
  scale: number;
  offsetX: number;
  offsetY: number;
}

export interface ToastMsg {
  id: number;
  text: string;
  kind: 'ok' | 'warn' | 'err';
}

const HISTORY_LIMIT = 60;

interface HistoryState {
  past: TrackData[];
  future: TrackData[];
}

@Injectable({ providedIn: 'root' })
export class TrackStateService {
  readonly track = signal<TrackData>(createEmptyTrack());
  readonly selectedPointIndex = signal<number | null>(null);
  readonly selectedSectorIndex = signal<number | null>(null);
  readonly selectedDrsIndex = signal<number | null>(null);
  readonly selectedMicroIndex = signal<number | null>(null);
  readonly activeTool = signal<EditorTool>('pan');
  readonly showMicrosectors = signal<boolean>(true);
  readonly showDrs = signal<boolean>(true);
  readonly showSectors = signal<boolean>(true);
  readonly showPoints = signal<boolean>(true);
  readonly showBackground = signal<boolean>(true);
  readonly snapToGrid = signal<boolean>(false);
  readonly gridSize = signal<number>(15);
  readonly view = signal<ViewTransform>({ scale: 1, offsetX: 0, offsetY: 0 });
  readonly backgroundReady = signal<boolean>(false);
  readonly toasts = signal<ToastMsg[]>([]);
  readonly trackName = signal<string>('untitled');

  private history: HistoryState = { past: [], future: [] };
  readonly historyReady = signal<boolean>(false);
  readonly canUndo = computed(() => this.historyReady() && this.history.past.length > 0);
  readonly canRedo = computed(() => this.historyReady() && this.history.future.length > 0);
  private toastSeq = 0;
  private interactionDepth = 0;
  readonly inInteraction = computed(() => this.interactionDepth > 0);

  readonly pointCount = computed(() => this.track().points.length);
  readonly microCount = computed(() => this.track().micro_sectors.length);
  readonly drsCount = computed(() => this.track().drs_zones.length);
  readonly hasPoints = computed(() => this.pointCount() > 0);

  setTrack(t: TrackData, name = 'untitled') {
    this.interactionDepth = 0;
    this.track.set(JSON.parse(JSON.stringify(t)));
    this.history = { past: [], future: [] };
    this.historyReady.set(false);
    this.historyReady.set(true);
    this.selectedPointIndex.set(null);
    this.selectedSectorIndex.set(null);
    this.selectedDrsIndex.set(null);
    this.selectedMicroIndex.set(null);
    this.trackName.set(name);
  }

  beginInteraction() {
    if (this.interactionDepth === 0) {
      this.snapshot();
    }
    this.interactionDepth++;
  }

  endInteraction() {
    if (this.interactionDepth > 0) {
      this.interactionDepth--;
      if (this.interactionDepth === 0) {
        this.historyReady.set(false);
        this.historyReady.set(true);
      }
    }
  }

  cancelInteraction() {
    if (this.interactionDepth > 0) {
      this.interactionDepth--;
      if (this.interactionDepth === 0 && this.history.past.length > 0) {
        this.history.past.pop();
        this.historyReady.set(false);
        this.historyReady.set(true);
      }
    }
  }

  update(mutator: (t: TrackData) => void) {
    if (this.interactionDepth === 0) {
      this.snapshot();
    }
    const current = this.track();
    const next = JSON.parse(JSON.stringify(current)) as TrackData;
    mutator(next);
    this.track.set(next);
  }

  patch(partial: Partial<TrackData>) {
    this.update((t) => Object.assign(t, partial));
  }

  private snapshot() {
    const cur = JSON.parse(JSON.stringify(this.track())) as TrackData;
    this.history.past.push(cur);
    if (this.history.past.length > HISTORY_LIMIT) this.history.past.shift();
    this.history.future = [];
    this.historyReady.set(false);
    this.historyReady.set(true);
  }

  undo() {
    if (this.history.past.length === 0) return;
    const cur = JSON.parse(JSON.stringify(this.track())) as TrackData;
    this.history.future.push(cur);
    const prev = this.history.past.pop()!;
    this.track.set(JSON.parse(JSON.stringify(prev)));
    this.historyReady.set(false);
    this.historyReady.set(true);
    this.selectedPointIndex.set(null);
  }

  redo() {
    if (this.history.future.length === 0) return;
    const cur = JSON.parse(JSON.stringify(this.track())) as TrackData;
    this.history.past.push(cur);
    const next = this.history.future.pop()!;
    this.track.set(JSON.parse(JSON.stringify(next)));
    this.historyReady.set(false);
    this.historyReady.set(true);
  }

  toast(text: string, kind: ToastMsg['kind'] = 'ok') {
    const id = ++this.toastSeq;
    this.toasts.update((list) => [...list, { id, text, kind }]);
    setTimeout(() => {
      this.toasts.update((list) => list.filter((t) => t.id !== id));
    }, 2600);
  }
}
