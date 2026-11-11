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
    return new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(new Error('Could not read file'));
      reader.readAsDataURL(file);
    }).then((url) => this.loadBackgroundDataUrl(url));
  }

  loadBackgroundDataUrl(url: string): Promise<void> {
    return new Promise((resolve, reject) => {
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

  async downloadTrackBundle(
    data: object,
    filename: string,
    width: number,
    height: number,
  ): Promise<void> {
    const backgroundBlob = await this.resizeBackground(width, height);
    const files = {
      [`${filename}.json`]: strToU8(JSON.stringify(data, null, 2)),
      [`${filename}.png`]: new Uint8Array(await backgroundBlob.arrayBuffer()),
    };
    const blob = new Blob([zipSync(files, { level: 0 })], { type: 'application/zip' });
    this.downloadBlob(blob, `${filename}.zip`);
  }

  private async resizeBackground(width: number, height: number): Promise<Blob> {
    if (!Number.isInteger(width) || width <= 0 || !Number.isInteger(height) || height <= 0) {
      throw new Error('Canvas width and height must be positive whole numbers');
    }
    if (!this.bgImg) throw new Error('No background image is loaded');

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Could not create a canvas to resize the background');
    context.drawImage(this.bgImg, 0, 0, width, height);

    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob) {
          resolve(blob);
        } else {
          reject(new Error('Could not encode the resized background image'));
        }
      }, 'image/png');
    });
  }

  async loadTrackBundle(file: File): Promise<{ trackText: string; backgroundFile: File }> {
    const entries = unzipSync(new Uint8Array(await file.arrayBuffer()));
    const jsonEntries = Object.entries(entries).filter(([name]) => name.endsWith('.json'));
    const imageEntries = Object.entries(entries).filter(([name]) => /\.(png|jpe?g|webp|gif|bmp|svg|avif|tiff?|ico)$/i.test(name));
    const trackBaseName = jsonEntries.length === 1
      ? jsonEntries[0][0].replace(/\.json$/i, '')
      : '';
    const imageEntry = imageEntries.find(([name]) => name.replace(/\.[^.]+$/, '') === trackBaseName)
      ?? imageEntries.find(([name]) => /^background\.[^/]+$/i.test(name));
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

  pickFiles(
    accept: string,
    options: { multiple?: boolean; directory?: boolean } = {},
  ): Promise<File[]> {
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = accept;
      if (options.multiple !== false) input.multiple = true;
      if (options.directory) {
        input.setAttribute('webkitdirectory', '');
        input.setAttribute('directory', '');
      }
      input.onchange = () => resolve(Array.from(input.files ?? []));
      input.addEventListener('cancel', () => resolve([]));
      input.click();
    });
  }
}
