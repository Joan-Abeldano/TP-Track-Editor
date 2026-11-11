import { inject, Injectable } from '@angular/core';
import { TrackData } from '../models/track.model';
import { TrackCorpusService } from './corpus/corpus.service';
import { generateRecipe } from './recipe/recipe-generator';
import { assembleTrack } from './assemble/track-assembler';
import { validateTrack } from './validate/track-validator';
import { GenerationMode, ProceduralOptions } from './recipe/recipe.types';
import { hashSeed, Rng } from './rng';

@Injectable({ providedIn: 'root' })
export class ProceduralTrackService {
  private readonly corpus = inject(TrackCorpusService);

  async generate(options: ProceduralOptions = {}): Promise<TrackData> {
    const corpus = await this.corpus.load();
    const seed = options.seed === undefined ? randomSeed() : options.seed >>> 0;
    const requested = options.mode ?? 'novel';
    const modes: GenerationMode[] =
      requested === 'novel'
        ? ['novel']
        : requested === 'clone'
          ? ['clone']
          : [requested, 'clone'];
    const attempts = requested === 'novel' ? 30 : 14;
    const problems: string[] = [];

    for (const mode of modes) {
      for (let attempt = 0; attempt < attempts; attempt++) {
        const rng = new Rng(hashSeed(`${seed}:${mode}:${options.style ?? ''}:${attempt}`));
        try {
          const recipe = generateRecipe(corpus, { ...options, mode }, rng);
          const result = assembleTrack(recipe, { ...options, mode }, rng, seed);
          const errors = validateTrack(result.track, {
            closureErrorM: result.closureErrorM,
            maxCorrectionDeg: result.maxCorrectionDeg,
          });
          if (errors.length === 0) return result.track;
          problems.push(`[${mode}] ${errors.join(', ')}`);
        } catch (error) {
          problems.push(`[${mode}] ${(error as Error).message}`);
        }
      }
    }

    throw new Error(
      `Could not generate a valid track. ${problems.slice(-4).join(' | ')}`,
    );
  }
}

function randomSeed(): number {
  return Math.floor(Math.random() * 0x7fffffff);
}
