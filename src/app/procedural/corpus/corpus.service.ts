import { Injectable, signal } from '@angular/core';
import {
  CorpusFile,
  CorpusTrack,
} from './corpus.types';
import {
  CorpusSkip,
  createCorpusTrack,
  finalizeCorpus,
  parseTrackJson,
} from './corpus-builder';
import {
  clearStoredCorpus,
  loadStoredCorpus,
  saveStoredCorpus,
} from './corpus-storage';

export interface CorpusImportSummary {
  loaded: number;
  total: number;
  skipped: CorpusSkip[];
}

@Injectable({ providedIn: 'root' })
export class TrackCorpusService {
  private data: CorpusFile | null = null;
  private hydrating: Promise<void> | null = null;
  private hydrationToken = 0;

  readonly trackCount = signal(0);
  readonly busy = signal(false);

  constructor() {
    void this.hydrate();
  }

  async load(): Promise<CorpusFile> {
    await this.hydrate();
    if (!this.data || this.data.tracks.length === 0) {
      throw new Error(
        'No track corpus yet. Open Generate and load your track JSON files to build one.',
      );
    }
    return this.data;
  }

  async addFiles(files: readonly File[]): Promise<CorpusImportSummary> {
    this.busy.set(true);
    try {
      await this.hydrate();

      const tracks = new Map<string, CorpusTrack>();
      const skipped: CorpusSkip[] = [];
      let loaded = 0;

      for (const file of files) {
        if (!/\.json$/i.test(file.name)) continue;
        try {
          const raw = parseTrackJson(await file.text(), file.name);
          const relative = (file as File & { webkitRelativePath?: string }).webkitRelativePath;
          const track = createCorpusTrack(relative || file.name, raw);
          tracks.set(track.id, track);
          loaded++;
        } catch (error) {
          skipped.push({ name: file.name, reason: (error as Error).message });
        }
      }

      const total = tracks.size;
      if (loaded > 0) {
        const corpus = finalizeCorpus([...tracks.values()]);
        this.install(corpus);
        await saveStoredCorpus(corpus);
      } else {
        this.hydrationToken++;
        this.data = null;
        this.updateCounts([]);
        await clearStoredCorpus();
      }

      return { loaded, total, skipped };
    } finally {
      this.busy.set(false);
    }
  }

  private install(corpus: CorpusFile): void {
    this.data = corpus;
    this.updateCounts(corpus.tracks);
  }

  private updateCounts(tracks: readonly CorpusTrack[]): void {
    this.trackCount.set(tracks.length);
  }

  private async hydrate(): Promise<void> {
    if (this.data) return;
    if (!this.hydrating) {
      const token = this.hydrationToken;
      this.hydrating = (async () => {
        try {
          const stored = await loadStoredCorpus();
          if (stored && !this.data && token === this.hydrationToken) this.install(stored);
        } finally {
          this.hydrating = null;
        }
      })();
    }
    await this.hydrating;
  }
}
