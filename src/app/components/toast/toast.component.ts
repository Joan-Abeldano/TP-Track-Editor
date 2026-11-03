import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TrackStateService } from '../../services/track-state.service';

@Component({
  selector: 'app-toast',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="toast-wrap">
      @for (t of toasts(); track t.id) {
        <div class="toast" [class.ok]="t.kind === 'ok'" [class.warn]="t.kind === 'warn'" [class.err]="t.kind === 'err'">
          {{ t.text }}
        </div>
      }
    </div>
  `,
  styles: [
    `
      :host {
        display: contents;
      }
    `,
  ],
})
export class ToastComponent {
  private state = inject(TrackStateService);
  readonly toasts = this.state.toasts;
}
