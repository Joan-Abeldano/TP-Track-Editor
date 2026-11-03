# Track Editor

A modular, easy-to-use web track editor for the game's track JSON format. Built with Angular 18, HTML canvas, and CSS — no database, no backend.

## Features

- **Path tool** — click to drop points and trace a track. The polyline closes automatically (the closing duplicate point is auto-added on save, matching the format of the base game tracks).
- **Select tool** — click and drag any point to move it. Coordinates snap to 0.1 px (or to a configurable grid when "snap to grid" is on).
- **Delete tool** — click a point to remove it. The start/finish point and the closing duplicate are protected.
- **Sector split tool** — click on the track to drop a sector split at that progress percentage. Up to 2 sector splits are supported.
- **DRS tool** — click on the track to add a DRS zone. Detection / start / end values are pre-filled and editable in the side panel.
- **Pan & zoom** — hold `Space` and drag (or use the Pan tool), scroll wheel to zoom around the cursor, reset view button.
- **Import / Save** — `Import` reads any track JSON (the format used by the base game), `Save` writes a clean JSON file. Save always adds the closing duplicate point so the loop is preserved.
- **PNG background** — load a PNG to trace an existing track map. Background dimensions auto-populate `raw_canvas_size`.
- **Sample tracks** — ten sample tracks (`mia`, `jap`, `ita`, `hun`, `hoc`, `fra`, `chi`, `bra`, `aus`, `afr`) are bundled in `public/samples/` for reference.

## UX touches for new users

- Toolbar with icons, keyboard shortcuts (`P`, `V`, `D`, `H`) and tooltips.
- Collapsible property sections (Track Basics, Racing Surface, Starting Grid, Canvas, Editor View).
- Right-side tabbed panel for Points / Microsectors / DRS — shows live counts in the tab badges. Track properties stay in the left panel.
- Live preview line from the last point to the cursor while drawing.
- Toast notifications confirm every action (import, save, delete, etc.).
- Microsector sum pill warns red when the lengths don't add up to 100%.
- `Normalize to 100%` button rescales all microsectors proportionally.
- Undo / Redo with `Ctrl+Z` / `Ctrl+Y` (up to 60 steps).

## Project structure

```
src/
  app/
    app.component.*              Shell: file bar + toolbar + 3-column layout
    models/
      track.model.ts             TrackData interface + helpers
    services/
      track-state.service.ts    Reactive state (signals), history, toasts
      file-io.service.ts         JSON import/export, PNG loading
      geometry.service.ts        Cumulative length, progress→point, etc.
    components/
      editor-canvas/             Main canvas with all rendering + mouse tools
      file-bar/                 Import / Save / New / Load BG buttons
      toolbar/                  Path / Select / Delete / Sector / DRS / Pan
      properties-panel/         Track metadata, surface, grid, view options
      points-panel/             Points list with editable coords
      microsectors-panel/       Microsector list with corner types
      drs-panel/                DRS zones list with detection / start / end
      toast/                    Toast notification overlay
  styles.css                    Global theme (black + light purple)
public/
  samples/                      10 reference track JSON files
```

Each component is self-contained (`*.ts`, `*.html`, `*.css`) and standalone, so adding or removing a feature only touches the relevant folder.

## Running

```bash
npm install
npm start
# open http://localhost:4200/
```

Build a static, deployable bundle:

```bash
npm run build
# output in dist/track-editor/browser/
```

## Keyboard shortcuts

| Key | Action |
| --- | --- |
| `P` | Path tool |
| `V` | Select tool |
| `D` | Delete tool |
| `H` | Pan tool |
| `Space` (hold) | Temporarily switch any tool to pan |
| `Ctrl+Z` | Undo |
| `Ctrl+Y` / `Ctrl+Shift+Z` | Redo |
| `Delete` / `Backspace` | Delete selected point |
| Mouse wheel | Zoom around cursor |
