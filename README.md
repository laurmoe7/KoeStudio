# KoeStudio

A Windows drawing and painting program, built to grow into a full-purpose tool in the spirit of Clip Studio Paint.

## Running it

Double-click **KoeStudio** on the Desktop or in the Start menu. It runs straight from this folder (needs Python 3.10+ and `pip install -r requirements.txt`), so there is nothing to install or build. `Run KoeStudio.lnk` and `Run KoeStudio.bat` in this folder do the same.

If you move the folder, recreate the shortcuts with `powershell -ExecutionPolicy Bypass -File tools\make_shortcut.ps1`.

Press **F5** or **Ctrl+R** to reload the screen (your work is saved first).

## Where your work goes

- Artwork saves automatically to **Pictures\KoeStudio** as `.koe` files. Deleted artwork goes to the `.deleted` subfolder, so you can get it back.
- Exports go to **Pictures\KoeStudio\Exports**: PNG with Ctrl+Shift+S, or File → Export as other format… for JPEG, WebP, GIF, TGA and BMP. File → Save project file (.koe)… writes the whole layered artwork there too; open it again from the gallery with **Open image or project…**, or double-click the file in Explorer (run `tools\register_koe.ps1` once to set that up).
- Tool settings and colours are kept in `%LOCALAPPDATA%\KoeStudio`.

## Features

- **Gallery** of your artwork with thumbnails; new canvas presets (Full HD, A4 and B5 at print resolution, square, icon) or any size up to 10,000 px; open any image as a new artwork.
- **Tools:** Pen, Pencil, Brush, Airbrush, Eraser, Fill, Gradient, Figure, Text, Rectangle and Ellipse selection, Lasso, Polygon, Magic wand, Crop, Eyedropper, Move, Ruler, Hand. The **Tool property** panel next to the tool bar shows the current tool's settings, grouped for the pen tools into Brush, Pen pressure, Stroke and Texture; click its heading to fold it away.
  - Pen pressure for size and density, with a pressure curve and a minimum size.
  - Stabilization (smooths shaky lines), hardness, density, spacing. Each tool remembers its own settings.
  - **Brush textures:** paper, watercolor paper, canvas, chalk and noise grain, with strength and size. The grain is fixed to the canvas, so overlapping strokes share it like real paper. The Pencil has a paper grain by default.
  - Fill can look at all layers or only the current one, with a colour margin and an expand option that tucks the fill under line edges.
  - The pen's eraser end erases.
  - **Shift+click** draws a straight line from where the last stroke on the layer ended.
- **Figure (U, press again for the Ruler):** drag to draw a straight line, rectangle or ellipse with the brush size, opacity and hardness, outlined or filled; Shift makes a 45° line, a square or a circle.
- **Gradient (G, press again to switch between Fill and Gradient):** drag to set the direction (Shift snaps the angle). Colors main → sub, main → transparent (or the other way round), straight or circular, with opacity. It fills the selection if there is one, and works on masks too.
- **Text (T):** click to type a new text, click a text to edit it again; click elsewhere, switch tools or press Esc to finish. Font (including Japanese fonts), size, bold, italic, alignment, line spacing and **vertical writing** (top to bottom, columns right to left, as in manga). Text stays editable on its own text layer; the Move tool moves it. To paint on it, rasterize it (Layer → Rasterize text, or the button that appears when you try).
- **Selections:** rectangle, ellipse (M again), lasso, polygon (L again: click the corners, double-click or Enter closes) and magic wand; Shift adds, Alt subtracts, Shift+Alt keeps the overlap. Select all, deselect, invert, select layer pixels; **expand, shrink and feather** the selection by a number of pixels (Select menu). Painting, fills, filters, Delete and Alt+Del stay inside the selection, softly where it is feathered.
- **Transform (Ctrl+T):** scale with the handles (Shift or "Keep aspect" for proportions), rotate by dragging outside the box (Shift snaps to 15°), move by dragging inside or with the arrow keys, flip and turn 90°. Enter applies, Esc cancels. Works on the selection, or the whole layer when nothing is selected. The Move tool moves just the selected pixels when there is a selection.
- **Canvas and image size (Image menu):** Canvas size adds or removes space around the picture, kept at any of nine anchor points; Image size stretches or shrinks everything (by pixels or percent, smooth or hard-pixel). Rotate the canvas 90° or 180° and flip it.
- **Crop:** the Crop tool (C) shows a box you drag by its edges and corners (Shift keeps proportions) or redraw; Enter crops. Image → Crop to selection crops to the selection in one step.
- **Copy, cut and paste:** Ctrl+C / Ctrl+X / Ctrl+V paste onto a new layer in the same spot; images copied in other programs paste too.
- **Layers:** add, duplicate, delete, merge down, rename (double-click), hide, opacity, 16 blending modes, lock transparent pixels, clip to the layer below. Drag layers in the list to reorder them, or onto a folder to put them in it. Drop or paste images to add them as layers.
- **Folders:** new folder, Put in new folder (Ctrl+G), open/close, opacity and blending ("Through" by default, so the layers inside blend as if there were no folder), hide, duplicate, Merge folder (into one layer). The Move tool moves everything in a folder.
- **Layer masks:** add a mask to a layer or folder (with a selection, everything outside it is hidden). Click the mask thumbnail to paint on it: painting hides and erasing shows again, as in Clip Studio Paint. "Painting on mask" shows in the top bar. Turn masks off, apply them or delete them from the Layer menu. View → Show mask area tints what the mask hides in red while you paint on it.
- **Screentone:** Layer → New screentone makes a tone layer (in the selection, if there is one) with a density, dot spacing, angle, shape (dots, lines, squares, diamonds, noise) and dot colour, previewed in the dialog. Paint on a tone layer in gray: darker gives denser dots, white or erasing removes them. Layer → Screentone settings turns any layer into tone (or back) and changes its dots; Rasterize screentone turns the dots into ordinary pixels. Merging a tone layer down keeps its dots.
- **Filters (Filter menu):** Gaussian blur, Sharpen, Mosaic, Brightness/Contrast, Hue/Saturation/Lightness, Levels, Posterize, Threshold (black and white) and Invert colors. The canvas shows the result live while you drag the sliders; OK keeps it as one undo step, and Ctrl+F repeats the last filter with the same settings. Filters work on the current layer inside the selection, and on a layer mask while you are painting on it (blur a mask to soften its edge).
- **Layer colour labels:** mark layers and folders with a colour in the Layers panel, shown as a dot next to the name.
- **Colour:** HSV square and hue bar, main and sub colour, hex entry, recently used colours.
- **View:** zoom at the cursor (wheel), rotate (Shift+wheel, 4/5/6), mirror (Shift+M), fit (Ctrl+0), 100% (Ctrl+1); pixel-sharp when zoomed in.
- **Rulers and perspective:** pixel rulers along the canvas edges (View → Edge rulers). Drag out of them to add horizontal or vertical guides, and drag a guide back to remove it. The Ruler tool (U) adds a 1-, 2- or 3-point perspective ruler and moves its vanishing points and the guides. With snapping on (Ctrl+2, or the magnet in the status bar), each stroke follows the guide it starts on or the perspective line closest to the direction you draw.
- **Undo/redo** for every change, flip layer or canvas, clear or fill a layer.

## Shortcuts

| Key | Action | Key | Action |
| --- | --- | --- | --- |
| P / N / B / A | Pen / Pencil / Brush / Airbrush | Space (hold) | Pan |
| M / L / W | Rectangle selection / Lasso / Magic wand | Ctrl+T | Transform |
| M (again) / L (again) | Ellipse selection / Polygon selection | Enter / Esc | Close / drop the polygon |
| Ctrl+A / Ctrl+D | Select all / Deselect | Ctrl+Shift+I | Invert selection |
| Ctrl+C / Ctrl+X | Copy / cut | Ctrl+V | Paste |
| E | Eraser | Alt (hold) | Eyedropper |
| G | Fill | [ / ] | Smaller / bigger brush |
| I | Eyedropper | X | Swap main and sub colour |
| V | Move layer (or selection) | Ctrl+Z / Ctrl+Y | Undo / redo |
| H | Hand | Ctrl+Shift+N | New layer |
| Ctrl+G | Put in new folder | Ctrl+E | Merge down / merge folder |
| Del | Clear selection or layer | | |
| Alt+Del | Fill selection or layer | Ctrl+S / Ctrl+Shift+S | Save / export PNG |
| Shift+M | Mirror view | Enter / Esc | Apply / cancel transform or crop |
| C | Crop | Ctrl+Alt+C / Ctrl+Alt+I | Canvas size / Image size |
| T | Text | G (again) | Fill / Gradient |
| U | Figure (press again: Ruler) | Ctrl+2 / Ctrl+; | Snap to rulers / show guides |
| Shift+click (pen tools) | Straight line from the last stroke | Ctrl+F | Repeat last filter |
| F5 / Ctrl+R | Reload screen | Ctrl+0 / Ctrl+1 | Fit / 100% |
