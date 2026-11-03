import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TrackStateService, EditorTool } from '../../services/track-state.service';

interface ToolDef {
  id: EditorTool;
  label: string;
  key: string;
  icon: string;
  desc: string;
}

@Component({
  selector: 'app-toolbar',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './toolbar.component.html',
  styleUrl: './toolbar.component.css',
})
export class ToolbarComponent {
  private state = inject(TrackStateService);

  readonly tools: ToolDef[] = [
    { id: 'path', label: 'Path', key: 'P', icon: 'pen', desc: 'Click to add points. Path auto-closes.' },
    { id: 'select', label: 'Select', key: 'V', icon: 'cursor', desc: 'Click and drag points to move them.' },
    { id: 'delete', label: 'Delete', key: 'D', icon: 'trash', desc: 'Click a point to remove it.' },
    { id: 'sector', label: 'Sector', key: 'S', icon: 'flag', desc: 'Click on the track to add a sector split.' },
    { id: 'drs', label: 'DRS', key: 'R', icon: 'bolt', desc: 'Click on the track to add a DRS zone.' },
    { id: 'pan', label: 'Pan', key: 'H', icon: 'hand', desc: 'Drag to pan the canvas. (Hold Space with any tool.)' },
  ];

  readonly activeTool = this.state.activeTool;
  readonly canUndo = this.state.canUndo;
  readonly canRedo = this.state.canRedo;

  setTool(t: EditorTool) {
    this.state.activeTool.set(t);
  }

  undo() {
    this.state.undo();
  }

  redo() {
    this.state.redo();
  }

  iconSvg(name: string): string {
    const icons: Record<string, string> = {
      pen: '<svg viewBox="0 0 24 24"><path d="M12 19l7-7 3 3-7 7-3-3z"/><path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z"/><path d="M2 2l7.586 7.586"/><circle cx="11" cy="11" r="2"/></svg>',
      cursor: '<svg viewBox="0 0 24 24"><path d="M3 3l7.07 16.97 2.51-7.39 7.39-2.51L3 3z"/></svg>',
      trash: '<svg viewBox="0 0 24 24"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>',
      flag: '<svg viewBox="0 0 24 24"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><path d="M4 22V15"/></svg>',
      bolt: '<svg viewBox="0 0 24 24"><path d="M13 2L3 14h7l-1 8 10-12h-7l1-8z"/></svg>',
      hand: '<svg viewBox="0 0 24 24"><path d="M8 13V5a2 2 0 0 1 4 0v6"/><path d="M12 11V3a2 2 0 0 1 4 0v8"/><path d="M16 11V7a2 2 0 0 1 4 0v8a6 6 0 0 1-6 6h-3a6 6 0 0 1-6-6v-2a2 2 0 0 1 4 0"/></svg>',
      undo: '<svg viewBox="0 0 24 24"><path d="M3 7v6h6"/><path d="M3 13a9 9 0 1 0 3-7.7L3 8"/></svg>',
      redo: '<svg viewBox="0 0 24 24"><path d="M21 7v6h-6"/><path d="M21 13a9 9 0 1 1-3-7.7L21 8"/></svg>',
    };
    return icons[name] || icons['pen'];
  }
}
