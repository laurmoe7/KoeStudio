# Changelog

What changed in KoeStudio, newest first. Older changes are in the git history.

## 2026-10-20

### Fixed
- Importing brushes from Clip Studio Paint while it is open now says to close it first, since it saves newly added brushes only when it closes.

### New
- Import brushes from Clip Studio Paint on this PC (Brush ⋯ menu, or Import… in the Brushes window): every brush you downloaded or made in Clip Studio shows up, with its tip and texture, with nothing to export first.
- Grain angle (Brush settings → Texture) turns a brush's texture; Clip Studio Paint brushes bring their texture rotation.
- Imported Photoshop brushes bring their texture mode and Texture Each Tip, with the texture depth following pen pressure when they set it.
- Texture mode and Texture each dab (Brush settings → Texture): the ten ways Clip Studio Paint mixes a texture with the paint, matched to Clip Studio's own output, and imported Clip Studio brushes bring theirs.
- Clip Studio Paint brushes now bring their texture brightness and contrast and their taper lengths in every unit Clip Studio uses for them; a Fade with only Starting ticked no longer counts as missing, since Clip Studio ignores it.
- Pen → grain (Brush settings → Texture): pen pressure changes how strongly the texture shows, either way round; Clip Studio Paint brushes that do this bring it along.
- Color mixing panel, as in Clip Studio Paint: dab and blend paint on a little scrap of paper under the Color panel, then click to take the mixed colour; it is kept between sessions.
- Expression color, as in Clip Studio Paint: show a layer in Gray or Monochrome (black and white, with a threshold and optional see-through white) without changing its pixels, from the Layers panel or Layer → Expression color….
- Edit → Pick screen color takes the main colour from anywhere on the screen, other programs included.
- Fill gaps (G, after Lasso fill), like Clip Studio Paint's Paint unfilled area: brush over the specks a fill left empty and every spot wholly inside your stroke is filled.
- Select → Reselect (Ctrl+Shift+D) brings back the selection you last deselected.
- Alt+] and Alt+[ select the layer above or below, as in Clip Studio Paint (also in the Layer menu).
- New Distort filters: Twirl, Pinch / bulge (a fish-eye lens), Ripple and Polar coordinates; Wave moved into the same group.
- Count jitter (Brush settings → Variation): each step lays a random number of dabs; imported Photoshop brushes bring it.
- Imported Clip Studio Paint spray brushes keep their spray: particle size, how many land at once, how far they spread and which way they point.
- Imported Clip Studio Paint brushes bring random tip thickness, size and density changing with speed, and Apply texture to each dab.
- Imported Photoshop brushes whose angle follows pen tilt turn with the pen's lean, and settings KoeStudio can't match (Fade, stylus wheel and the like) are listed on the brush.
- Both ways (Brush settings → Variation): turn it off to scatter dabs only sideways across the stroke; imported Photoshop brushes bring it.
- Clip Studio Paint brushes (.sut files) can be imported again, now with their own tip and texture pictures, pen pressure curves, jitter, tapers, colour jitter and colour mixing.
- Spacing can go as low as 0.5%, for brushes whose dabs must sit very close together.
- Squash jitter and Random flip (Brush settings → Tip): each dab is squashed or mirrored at random, so tip pictures such as fur or leaves don't repeat the same way.
- Imported Photoshop brushes bring their Color Dynamics (hue, saturation and brightness jitter), roundness jitter and flip jitter; imported Procreate brushes bring their flip and roundness jitter.
- Taper size and Taper opacity (Brush settings → Stroke): choose how thin the tapered ends of a stroke get and how much they fade.
- Imported Procreate brushes bring their pen taper: its start and end length, size and opacity.
- Imported Procreate brushes bring their colour jitter (hue, saturation, lightness and darkness) and their Apple Pencil tilt settings.

### Fixed
- Clip Studio Paint brush tips drawn on a black-and-white (monochrome) layer import instead of turning into a round tip.
- Imported brushes that all share one name are numbered (Brush 1, Brush 2, ... when the name is just the pack's), and a Photoshop brush bigger than 1000 px says so.
- Imported brushes with very big tip pictures take far less space and load faster: a pack of 16 big Photoshop paint stamps went from 55 MB to 7 MB.
- A combined brush's second brush now shows when the texture uses a Texture mode other than Multiply.
- Imported Clip Studio brushes with a darkened or lightened texture no longer come out twice as dark or light as in Clip Studio.
- Imported Clip Studio Paint brushes taper only where Clip Studio tapers them (most, such as the G-pen and rake brushes, don't), thinning or fading as far as the brush says, and get their spacing right when it is set to Narrow, Normal or Wide.
- Imported Clip Studio Paint blenders and colour-mixing brushes mix the right way round (blenders used to barely mix), and bring their paint density and colour stretch.
- Imported Clip Studio Paint brushes no longer all turn with the stroke; only those set to follow the line's direction do.
- Scattered brushes that turn with the stroke (fur, grass) keep their tips along the stroke instead of pointing every which way.
- The first dab of a brush that turns with the stroke is no longer drawn back to front.
- Imported brushes no longer get the Brush tool's end taper when the brush file has none.
- Imported Photoshop brushes paint at full Flow when the brush file doesn't set one, as they do in Photoshop.
- Imported Photoshop brushes with long, thin tips (rakes) paint solid lines instead of rows of dots: their spacing is now measured as Photoshop does, from the tip's short side.
- Imported Procreate brushes get the size they have in Procreate, using the brush's own minimum and maximum size; most used to come in a few pixels wide.
- A Procreate pack's title cards (a logo or a "free sample" banner shown as a brush) are no longer imported as brushes.
- Combined brushes whose second brush is bigger now fit inside their preview stroke.
- Imported Procreate brushes keep their Flow (Rendering), so brushes set below 100% no longer paint too dense.

## 2026-10-19

### New
- The guide window is bigger, and its back and next buttons stay at the bottom while you scroll a page.
- A new guide page, Special brush settings: notes and tips (Help → Guide), explains Wet edges, Impasto, Runs dry, colour mixing, textures, hair tips, Dual and Combined brushes: good values, and which settings don't go together.
- Runs dry (Brush settings → Paint): the brush gives out its paint along the stroke, so it starts solid and ends in dry, scratchy streaks on the paper grain, like a real loaded brush. Oil paint now uses it, and the Flat brush tip has ragged edges with a few stray hairs.
- The app icon's cow has small, rounded pale pink horns instead of tall golden ones, softer spots, outlined ears and dark hooves that stand out.
- Oil paint is redone: a flat brush tip lays solid paint with fine bristle streaks and square ends, the new Impasto setting makes the ridges and edges catch the light like thick paint, and it picks up the colours it crosses without turning see-through. The old canvas pattern that looked like a net is gone.
- Brush settings → Paint has two new settings: Impasto (thick paint that catches the light) and Paint load (how much paint of its own a mixing brush carries).
- A new Flat brush tip (Brush settings → Tip): a solid row of hairs that leaves fine streaks.
- The Wet blender now mostly moves the colours already there instead of painting its own colour over bare paper.
- Combined brushes (Brush settings → Combined): a second brush paints along the same stroke, with its own tip, size, spacing and scatter, and a Combine mode (Multiply, Darken, Screen and more). Copy a brush… makes any brush the second one, and Procreate combined brushes now import with both halves.
- Brush import: Only complete brushes hides and skips the brushes marked !, which lose a setting KoeStudio does not have. It stays on for the next import.
- Brush import: choose which group the brushes go into (the pack's name, or a group you already have), and Import stays greyed out until you pick a brush.
- Manage brushes (Brush ⋯ menu, or Manage… in the Brushes window): see all your brushes by group with their strokes, pick many at once to delete or move to another group, drag them into order, rename groups and brushes, and hide groups you don't use, built-in ones too.
- Importing a big brush pack is easier: every brush shows its real stroke in a grid, a search box finds brushes by name, Shift+click picks a range, and All and None work on the brushes you searched for. Big packs start with nothing picked.
- Imported brushes get a group of their own per pack in the Brushes window and the Brush row, instead of all going under Your brushes.
- Wet colour mixing (Brush settings → Paint → Color mixing and Color stretch): the brush picks up the colours already on the layer, blends them into its own and drags them along the stroke. New Oil paint and Wet blender brushes use it.
- Imported brushes keep their wet mixing and wet edges: Procreate wet mix, Photoshop wet edges and Krita colour smudge brushes now carry them over instead of leaving them out.
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
- Color mixing picks up a colour as soon as the brush touches it, so a stroke crossing another now really mixes with it; Oil paint drags it along less far.
- Impasto no longer greys the whole stroke: flat paint keeps its colour and only the ridges and edges catch the light, now more strongly.
- Runs dry keeps the stroke solid for almost half the way before it breaks up, and the dry end is streaky instead of an even speckle.
- Brushes whose tip turns with the stroke (Oil paint, Dry brush) no longer leave a small spike at the start of each stroke.
- The Canvas brush texture looks like fine primed linen instead of a regular grid or net, so strokes show the tooth of the canvas rather than a pattern.
- Small strokes with a hairy tip (Dry brush, Bristles, or an imported tip) no longer break up into a chain pattern.
- Watercolour strokes no longer show a pattern of beads along their length.
- Closing an artwork gives back its memory straight away instead of holding a few hundred MB for a while.
- Selection changes in the undo history take a quarter of the memory and no graphics memory (Select all on a big canvas held about 48 MB per step).
- Combined brushes with a Combine mode other than Normal no longer make the app use a gigabyte or more of extra memory while you paint.
- Undo copies of each stroke free their graphics memory as soon as they are stored, instead of whenever the browser gets round to it.
- Procreate brush sets no longer show every brush two or three times (Procreate's reset copies and the halves of combined brushes were read as brushes), and brushes without a name get the set's name and a number instead of a long code. Long brush names no longer spill out of their card.
- An artwork with one damaged layer picture now opens instead of failing: that layer shows empty with a warning, and its saved picture is kept as it was unless you paint on it.
- Resizing the window, hiding the panels (Tab) or the shortcut strip appearing no longer pushes the picture off to one side: a canvas fitted to the window stays fitted, and a zoomed-in view keeps the same spot in the middle.
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
