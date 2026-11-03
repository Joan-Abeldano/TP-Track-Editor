import { Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FileBarComponent } from './components/file-bar/file-bar.component';
import { ToolbarComponent } from './components/toolbar/toolbar.component';
import { EditorCanvasComponent } from './components/editor-canvas/editor-canvas.component';
import { PropertiesPanelComponent } from './components/properties-panel/properties-panel.component';
import { PointsPanelComponent } from './components/points-panel/points-panel.component';
import { MicrosectorsPanelComponent } from './components/microsectors-panel/microsectors-panel.component';
import { DrsPanelComponent } from './components/drs-panel/drs-panel.component';
import { ToastComponent } from './components/toast/toast.component';
import { TrackStateService } from './services/track-state.service';

type Tab = 'points' | 'micros' | 'drs';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [
    CommonModule,
    FileBarComponent,
    ToolbarComponent,
    EditorCanvasComponent,
    PropertiesPanelComponent,
    PointsPanelComponent,
    MicrosectorsPanelComponent,
    DrsPanelComponent,
    ToastComponent,
  ],
  templateUrl: './app.component.html',
  styleUrl: './app.component.css',
})
export class AppComponent {
  private state = inject(TrackStateService);

  readonly activeTool = this.state.activeTool;
  readonly pointCount = this.state.pointCount;
  readonly microCount = this.state.microCount;
  readonly drsCount = this.state.drsCount;
  readonly trackName = this.state.trackName;

  readonly canvasToolClass = computed(() => `tool-${this.activeTool()}`);
  readonly activeTab = signal<Tab>('points');

  setTab(t: Tab) {
    this.activeTab.set(t);
  }

  isTab(t: Tab): boolean {
    return this.activeTab() === t;
  }
}
