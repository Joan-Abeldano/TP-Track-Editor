import { Injectable, signal } from '@angular/core';

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
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename.endsWith('.json') ? filename : `${filename}.json`;
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
