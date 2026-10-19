# Changelog

What changed in KoeStudio, newest first. Older changes are in the git history.

## 2026-10-19

### New
- The tool bar has redrawn icons: one even style with soft fills, and clearer pictures for the airbrush, smudge, fill, eyedropper, dodge (a sun) and burn (a moon).
- The Pencil works like graphite: a light touch only catches the tops of the paper grain, pressing harder fills it in, and edges break up into grain. Any brush can do this with Brush settings → Texture → Grain by pressure.
- The Paper texture has a finer, crisper grain instead of soft blotches.
- Long menus are grouped into smaller menus (Layer → New, Mask and Rasterize; Filter by kind; View → Rulers and symmetry; File → Timelapse), so every menu fits on the screen.
- With a menu open, pointing at another menu name opens it, and the arrow keys move through the menus.
- Lock alpha, Clip below, Lock and Reference in the Layers panel are now neat toggle buttons.
- The gallery's buttons all have icons.
- Record a timelapse of an artwork and export it as a video (File → Timelapse → Record timelapse).
- Transform: type an exact width, height or angle.
- A bar under the selection with deselect, invert, transform, fill, delete, copy to new layer and crop.
- Filter → Dust cleaner removes small specks, such as dust on a scan.
- Filter → Median reduces grain and noise while keeping edges sharp.
- Find layers by name with the magnifier under the layer list.
- View → Zoom to selection (Ctrl+Alt+0) fills the window with the selected part.
- Shift+Alt+Del fills the selection or layer with the sub colour.
- Tab hides the tool bar and panels; Tab again brings them back.
- Ctrl+click a layer thumbnail to select its pixels (Shift adds, Alt takes away).
- Hold a tool's key to use that tool for a moment; let go to go back.
- Ctrl+Alt+drag on the canvas sets the brush size.
- Shift+Space+drag turns the view, Ctrl+Space+drag zooms it.
- Alt+click a layer's eye to see only that layer; again to see the others.
- The brush cursor takes the brush tip's shape.
- Transform: Alt+drag a handle to scale from the middle.
- Arrow keys nudge the layer or selection with the Move tool.
- Gallery: search by title, sort by last change, name or size.

### Faster
- Painting next to screentone or effect layers.
- Opening artwork with many layers.
- Fill and the magic wand, including Close gaps.
- Autosave no longer freezes the pen on big layers.
- Undo history takes much less memory.
- Filter previews, Smudge, Liquify, Blur, Dodge/Burn and Clone stamp.
- Picking a layer with Ctrl+click on the Move tool no longer slows the program down afterwards.

### Fixed
- On short windows the tool bar shows in two columns instead of hiding the last tools.
- Video export no longer fails the first time in a newly opened window.
- Layer and timeline thumbnails are sharp on scaled screens and no longer skip thin lines.
- Timeline thumbnails no longer draw their paper too faint.

## 2026-10-18

### New
- Vector selections: delete, move, transform and distort lines as lines.
- Text: different font, size, bold, italic and colour per letter.
- Transform text without turning it into pixels.
- Export animations as WebM video.
- Animation: hold a frame for several frame times (on twos).
- Screentone: set it in lines per inch, shift the dots, and fade between two densities.
- Move tool: Ctrl+click picks the layer under the pointer, right-click lists them.
- Dual brush, also imported from Photoshop brushes.
- Hard-pixel brushes for pixel art, and File → Export layers.
- Import and export palette files (.gpl, .aco, .ase, .hex).
- Transform a layer together with its mask.
- Vector lines keep pen tilt, speed and the dual brush.

### Faster
- Saving sends only the layers that changed.

### Fixed
- Curve rulers no longer jump to another part of the curve.
- Long menus scroll on short windows.
