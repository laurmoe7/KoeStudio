# KoeStudio

A Windows drawing and painting program, built to grow into a full-purpose tool in the spirit of Clip Studio Paint.

## Running it

Double-click **KoeStudio** on the Desktop or in the Start menu. It runs straight from this folder (needs Python 3.10+ and `pip install -r requirements.txt`), so there is nothing to install or build. `Run KoeStudio.lnk` and `Run KoeStudio.bat` in this folder do the same.

If you move the folder, recreate the shortcuts with `powershell -ExecutionPolicy Bypass -File tools\make_shortcut.ps1`.

Press **F5** or **Ctrl+R** to reload the screen (your work is saved first).

## Where your work goes

- Artwork saves automatically to **Pictures\KoeStudio** as `.koe` files. Deleted artwork goes to the `.deleted` subfolder, so you can get it back.
- PNG exports go to **Pictures\KoeStudio\Exports**.
- Tool settings and colours are kept in `%LOCALAPPDATA%\KoeStudio`.

## Features

- **Gallery** of your artwork with thumbnails; new canvas presets (Full HD, A4 and B5 at print resolution, square, icon) or any size up to 10,000 px; open any image as a new artwork.
- **Tools:** Pen, Pencil, Brush, Airbrush, Eraser, Fill, Eyedropper, Move layer, Hand.
  - Pen pressure for size and density, with a pressure curve and a minimum size.
  - Stabilization (smooths shaky lines), hardness, density, spacing. Each tool remembers its own settings.
  - Fill can look at all layers or only the current one, with a colour margin and an expand option that tucks the fill under line edges.
  - The pen's eraser end erases.
- **Layers:** add, duplicate, delete, reorder, merge down, rename (double-click), hide, opacity, 16 blending modes, lock transparent pixels, clip to the layer below. Drop or paste images to add them as layers.
- **Colour:** HSV square and hue bar, main and sub colour, hex entry, recently used colours.
- **View:** zoom at the cursor (wheel), rotate (Shift+wheel, 4/5/6), mirror (M), fit (Ctrl+0), 100% (Ctrl+1); pixel-sharp when zoomed in.
- **Undo/redo** for every change, flip layer or canvas, clear or fill a layer.

## Shortcuts

| Key | Action | Key | Action |
| --- | --- | --- | --- |
| P / N / B / A | Pen / Pencil / Brush / Airbrush | Space (hold) | Pan |
| E | Eraser | Alt (hold) | Eyedropper |
| G | Fill | [ / ] | Smaller / bigger brush |
| I | Eyedropper | X | Swap main and sub colour |
| V | Move layer | Ctrl+Z / Ctrl+Y | Undo / redo |
| H | Hand | Ctrl+Shift+N | New layer |
| Del | Clear layer | Ctrl+E | Merge down |
| Alt+Del | Fill layer | Ctrl+S / Ctrl+Shift+S | Save / export PNG |
| F5 / Ctrl+R | Reload screen | Ctrl+0 / Ctrl+1 | Fit / 100% |
