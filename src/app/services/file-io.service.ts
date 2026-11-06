import { Injectable, signal } from '@angular/core';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';

@Injectable({ providedIn: 'root' })
export class FileIoService {
  readonly backgroundUrl = signal<string | null>(null);
  readonly backgroundWidth = signal<number>(0);
  readonly backgroundHeight = signal<number>(0);
  private bgImg: HTMLImageElement | null = null;

  get backgroundImage(): HTMLImageElement | null {
    return this.bgImg;
  }

  loadBackgroundFile(file: File): Promise<void> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const url = reader.result as string;
        const img = new Image();
        img.onload = () => {
          this.bgImg = img;
          this.backgroundUrl.set(url);
          this.backgroundWidth.set(img.naturalWidth);
          this.backgroundHeight.set(img.naturalHeight);
          resolve();
        };
        img.onerror = () => reject(new Error('Invalid image'));
        img.src = url;
      };
      reader.onerror = () => reject(new Error('Could not read file'));
      reader.readAsDataURL(file);
    });
  }

  clearBackground() {
    this.bgImg = null;
    this.backgroundUrl.set(null);
    this.backgroundWidth.set(0);
    this.backgroundHeight.set(0);
  }

  loadTrackFile(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(new Error('Could not read file'));
      reader.readAsText(file);
    });
  }

  downloadJson(data: object, filename: string) {
    const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: 'application/json',
    });
    this.downloadBlob(blob, filename.endsWith('.json') ? filename : `${filename}.json`);
  }

  async downloadTrackBundle(data: object, backgroundUrl: string, filename: string): Promise<void> {
    const response = await fetch(backgroundUrl);
    if (!response.ok) throw new Error('Could not read the loaded background image');
    const contentType = response.headers.get('content-type')?.split(';')[0].toLowerCase() ?? '';
    const extension = this.imageExtension(contentType);
    const files = {
      [`${filename}.json`]: strToU8(JSON.stringify(data, null, 2)),
      [`background.${extension}`]: new Uint8Array(await response.arrayBuffer()),
    };
    const blob = new Blob([zipSync(files, { level: 0 })], { type: 'application/zip' });
    this.downloadBlob(blob, `${filename}.zip`);
  }

  async loadTrackBundle(file: File): Promise<{ trackText: string; backgroundFile: File }> {
    const entries = unzipSync(new Uint8Array(await file.arrayBuffer()));
    const jsonEntries = Object.entries(entries).filter(([name]) => name.endsWith('.json'));
    const imageEntry = Object.entries(entries).find(([name]) => /^background\.[^/]+$/i.test(name));
    if (jsonEntries.length !== 1 || !imageEntry) {
      throw new Error('Bundle must contain one track JSON and one background image');
    }

    const extension = imageEntry[0].split('.').pop()!.toLowerCase();
    const mimeType = this.imageMimeType(extension);
    const backgroundFile = new File(
      [new Blob([imageEntry[1]], { type: mimeType })],
      imageEntry[0],
      { type: mimeType },
    );
    return { trackText: strFromU8(jsonEntries[0][1]), backgroundFile };
  }

  private imageExtension(mimeType: string): string {
    const extensions: Record<string, string> = {
      'image/png': 'png',
      'image/jpeg': 'jpg',
      'image/webp': 'webp',
      'image/gif': 'gif',
      'image/bmp': 'bmp',
      'image/svg+xml': 'svg',
      'image/avif': 'avif',
      'image/tiff': 'tiff',
      'image/x-icon': 'ico',
    };
    const extension = extensions[mimeType];
    if (!extension) throw new Error(`Unsupported background image type: ${mimeType || 'unknown'}`);
    return extension;
  }

  private imageMimeType(extension: string): string {
    const mimeTypes: Record<string, string> = {
      png: 'image/png',
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      webp: 'image/webp',
      gif: 'image/gif',
      bmp: 'image/bmp',
      svg: 'image/svg+xml',
      avif: 'image/avif',
      tif: 'image/tiff',
      tiff: 'image/tiff',
      ico: 'image/x-icon',
    };
    const mimeType = mimeTypes[extension];
    if (!mimeType) throw new Error(`Unsupported background image file: .${extension}`);
    return mimeType;
  }

  private downloadBlob(blob: Blob, filename: string) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  pickFile(accept: string): Promise<File | null> {
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = accept;
      input.onchange = () => resolve(input.files?.[0] ?? null);
      input.click();
    });
  }
}
