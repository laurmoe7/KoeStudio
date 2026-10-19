# Changelog

What changed in KoeStudio, newest first. Older changes are in the git history.

## 2026-10-19

### New
- Draft layers (the Draft switch in the Layers panel): for sketches you see while drawing but never want in the result. Exports leave them out, and Fill and the Magic wand looking at all layers ignore them.
- The animation timeline, onion skins and animation export are taken out for now, so the app stays focused on drawing. Older artworks made with frames open with every frame as an ordinary layer.
- A Settings menu holds the theme, pen pressure, the shortcut strip and keyboard shortcuts; on the start screen the Theme button became a Settings button.
- The app icon has bolder colours (golden horns, a shaded edge and a shadow underneath), so the cow no longer fades into light backgrounds, and he now holds his palette up at his side.
- Wet edges (Brush settings → Paint): paint gathers at the edge of the stroke and the middle stays lighter, as watercolour does when it dries.
- Watercolour now gives see-through washes with darker edges and a mottled grain, and strokes laid over each other get deeper. The Marker's ink gathers slightly at its edges.
- Gouache covers flat and opaque, and runs dry into the paper grain at a light touch instead of looking sandy all over. The Dry brush leaves bristle streaks instead of scattered dots.
- Colour themes for the app: Dusty rose, Lavender dusk, Moss, Deep sea, Cocoa and Ink black, besides the usual Midnight. Pick one from View → Theme or the Theme button on the start screen.
- The Pencil shades more like graphite: a light touch now gives a soft grey line instead of broken black dots, and pressing harder darkens it smoothly to near black. The HB, 6B, Charcoal and Chalk brushes do the same.
- Brushes window: every brush with a sample stroke in your colour, a search box, and one click to use it. Open it from View → Brushes or by clicking the new stroke of the current brush under the Brush choice.
- A * after a brush's name shows that you changed its settings; click the brush again to undo the changes.
- The Brushes window has small, medium and large strokes, can be resized, steps through brushes with the arrow keys, and has a right-click menu to copy, update, rename or delete a brush.
- More canvas sizes to choose from in New canvas, grouped into Screen, Illustration, Print and Social media: 4K, QHD, phone wallpaper, A3, A5, US Letter, postcard, Instagram, stories, YouTube thumbnails, headers, emotes and more.
- Auto actions (View → Auto actions): record menu commands, their dialog values and Layers panel changes once, then play them again with one click. A Basic set of ready-made actions is included.
- Colorize (Edit menu) fills every closed shape of your line art with flat colour on a new layer: from a little colour you scribble in each shape, or picked for you from a colour scheme (Harmony, Complementary, Three hues, Pastel or your palette), with Shuffle for other colours.
- Brushes can stay inside lines: with Stay inside lines ticked (Brush settings → Paint), a stroke paints only inside the shape of the reference line art it starts in.
- Layer color (Layer menu) shows everything on a layer in one colour without changing the paint, to try out colours quickly.
- Layer → Find layer on canvas: click something you drew and its layer is selected.
- The shortcut strip can float over the canvas: drag it by its grip to anywhere you like, upright or lying flat, and it stays there (View → Shortcut strip → Floating).
- The shortcut strip can also sit under the canvas (View → Shortcut strip → At the bottom).
- A shortcut strip beside the canvas for drawing on a pen tablet without a keyboard: big buttons for undo, redo, brush size, swapping colours, fitting the view, and hold-down buttons to pick a colour or move the view while the pen draws. It turns on by itself once you use a pen or touch screen; View → Shortcut strip turns it off, moves it to the other side or folds it up.
- The Figure tool draws arrows and double arrows.
- Lasso fill can erase: tick Erase and draw round what should go.
- A mixing strip in the Color panel shows nine shades between the main and sub colour to pick from.
- Change any keyboard shortcut: Help → Change shortcuts… gives a tool or command the key you press, and the menus show your keys.
- New filters: Vignette, Emboss, Oil paint, Wave, Find edges, Grayscale and Auto contrast.
- Filter → Render → Clouds fills with soft clouds from the main to the sub colour.
- Filter → Color → Reduce to palette colors turns a picture into your palette's colours, with optional dithering, for pixel art.
- Filter → Line art → Main color to transparency takes a colour (such as the paper of a scan) out of a layer.
- Ready-made brushes in the Brush row of every paint tool: G-pen, Fineliner, Brush pen, HB and 6B pencils, Charcoal, Chalk, Gouache, Watercolour, Dry brush, Marker, Soft blend, Spatter, and hard, soft and kneaded erasers.
- A new Bristles brush tip that leaves streaks like a dry brush.
- The Brush tool paints a fuller, firmer stroke with a tapered end (for new settings).
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
- An artwork that fails to open no longer leaves errors behind on the start screen.
- Task Manager now lists KoeStudio under its own name and cow icon, instead of under "Python launcher (windowed)".
- The KoeStudio window always belongs to KoeStudio.exe, so programs that recognise apps by their file name no longer mistake other Python programs for KoeStudio.
- Painting on a layer whose opacity is 0% no longer seems to do nothing: KoeStudio says so and offers to set it back to 100%.
- Changing a layer's opacity always shows up in the history, even when a pen drag on the slider ends oddly.
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
