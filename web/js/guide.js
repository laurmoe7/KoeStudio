// The guidebook (Help → Guide, F1) and the shortcut list (Help → Keyboard shortcuts), as data, plus the search
// used by the Guide window (pure, tested). Topics are short HTML pages: <p>, <ul>, <b>, <kbd>, <h4> only.
// Keep them in step with the features (README.md has the same facts in longer form).

/** [id, title, html] for each page of the guide, in reading order. */
export const GUIDE = [
  ['start', 'Getting started', `
    <p>KoeStudio opens on the <b>gallery</b>: every artwork you have made, newest first. <b>New canvas</b> starts a
    picture (pick a preset such as Full HD or A4, or type any size up to 10,000 px). <b>Open image or project…</b>
    turns a picture file into a new artwork, or opens a <code>.koe</code> project file.</p>
    <p>Your work <b>saves by itself</b> a moment after every change; the top right of the window says when. There is
    no Save button to forget. Click the arrow at the top left to go back to the gallery.</p>
    <h4>The screen</h4>
    <ul>
      <li><b>Tool bar</b> (far left): pick a tool, or press its key (shown in its tooltip).</li>
      <li><b>Tool property</b>: the settings of the tool you hold. Below it, <b>History</b> and <b>Navigator</b>.</li>
      <li><b>Color</b> and <b>Layers</b> on the right.</li>
      <li>Click a panel's heading to fold it away.</li>
    </ul>
    <p>Hover over any button or setting to see what it does. <kbd>F5</kbd> reloads the screen (your work is saved first).</p>`],

  ['drawing', 'Drawing and erasing', `
    <p>Pen <kbd>P</kbd>, Pencil <kbd>N</kbd>, Brush <kbd>B</kbd> and Airbrush <kbd>A</kbd> all paint with the main
    colour; Eraser <kbd>E</kbd> takes paint away (so does the eraser end of a pen).</p>
    <ul>
      <li><b>Size</b>: <kbd>[</kbd> and <kbd>]</kbd> make the brush smaller and bigger.</li>
      <li><b>Opacity</b> caps the whole stroke; <b>Density</b> is how much paint each dab lays down, so it builds up within a stroke.</li>
      <li><b>Hardness</b>: a crisp edge at 100%, softer below.</li>
      <li><b>Stabilization</b> smooths shaky lines; higher values trail further behind the pen.</li>
      <li><b>Shift+click</b> draws a straight line from where your last stroke on that layer ended.</li>
    </ul>
    <p>Each tool remembers its own settings. <b>Smudge</b> <kbd>J</kbd> drags paint along like a wet finger.</p>`],

  ['brushes', 'Brush settings and saved brushes', `
    <p>The tool panel shows only the basics. <b>Brush settings…</b> opens a window with everything else, on pages:</p>
    <ul>
      <li><b>Tip</b>: round, or any picture as the tip; squash it, turn it, turn it at random or with the stroke.</li>
      <li><b>Pen pressure</b>: what pressure changes (size, density) and how much.</li>
      <li><b>Stroke</b>: spacing between dabs, stabilization, and <b>Start / End taper</b> to begin or end strokes thin
      (the tapered end appears when you lift the pen).</li>
      <li><b>Variation</b>: scatter dabs around the stroke, make them randomly smaller or lighter, or vary their hue, saturation and brightness (per dab, or once per stroke).</li>
      <li><b>Texture</b>: a paper grain fixed to the canvas, so overlapping strokes share it.</li>
    </ul>
    <p>You can keep painting with the window open; drag it by its title bar.</p>
    <h4>Saved brushes</h4>
    <p>The <b>Brush</b> row loads a saved brush. Its <b>⋯</b> menu saves your current settings as a brush, updates,
    renames or deletes one, adds tip and texture pictures, and <b>imports Procreate and Photoshop brushes</b>
    (<code>.brush</code>, <code>.brushset</code>, <code>.abr</code>).</p>`],

  ['color', 'Colour', `
    <p>The Color panel has a saturation/brightness square, a hue bar, the <b>main</b> and <b>sub</b> colour squares,
    a hex field and your recent colours.</p>
    <ul>
      <li><kbd>X</kbd> swaps main and sub.</li>
      <li>Hold <kbd>Alt</kbd> with a painting tool to pick a colour from the canvas, or use the Eyedropper <kbd>I</kbd>.</li>
      <li><b>Palette</b>: <b>+</b> keeps the main colour there for good; click a swatch to use it, right-click to remove it.</li>
      <li>The <b>Reference window</b> (View menu) shows pictures beside the canvas: scroll to zoom, drag to move,
      click to pick a colour from it, double-click to fit. <b>+</b> adds pictures (or drop them on it); they stay there
      for every artwork.</li>
    </ul>`],

  ['fill', 'Fill, gradient and lasso fill', `
    <p><kbd>G</kbd> picks the Fill tool; press it again for Gradient, then Lasso fill.</p>
    <ul>
      <li><b>Fill</b>: click an area to fill it. <b>Look at</b> chooses whether the outline comes from everything you
      see, the current layer, or the layers ticked <b>Reference</b> (handy for colouring under line art).
      <b>Margin</b> allows nearby colours, <b>Expand</b> tucks the fill under the lines, and untick
      <b>Connected only</b> to fill every pixel of that colour. <b>Close gaps</b> stops the fill running out through
      small openings in the lines (up to about twice that many pixels wide).</li>
      <li><b>Gradient</b>: drag from where it starts to where it ends (Shift snaps the angle). Straight or circle;
      <b>Repeat</b> and <b>Mirror</b> make stripes and rings.</li>
      <li><b>Lasso fill</b>: draw round an area to fill it with the main colour.</li>
    </ul>
    <p>All of them stay inside the selection, if there is one.</p>`],

  ['shapes', 'Figures and text', `
    <h4>Figure <kbd>U</kbd></h4>
    <p>Drag for a straight line, rectangle or ellipse, outlined with the brush settings or filled. Shift makes a 45°
    line, a square or a circle. <b>Polyline</b> and <b>Polygon</b> are clicked corner by corner: double-click or
    <kbd>Enter</kbd> finishes, a click on the first corner closes a polygon, <kbd>Backspace</kbd> takes back the last
    corner, <kbd>Esc</kbd> drops it.</p>
    <h4>Text <kbd>T</kbd></h4>
    <p>Click to type; click a text again to edit it. Font, size, bold, italic, alignment, line spacing and
    <b>vertical writing</b> (as in manga). Text stays editable on its own layer; to paint on it, use
    Layer → Rasterize text.</p>`],

  ['selection', 'Selections', `
    <p>Selection tools: rectangle <kbd>M</kbd> (again for ellipse), lasso <kbd>L</kbd> (again for polygon) and magic
    wand <kbd>W</kbd>. While dragging, <b>Shift</b> adds, <b>Alt</b> subtracts and <b>Shift+Alt</b> keeps the overlap.</p>
    <p>Painting, fills, filters and <kbd>Del</kbd> stay inside the selection. <kbd>Ctrl+A</kbd> selects all,
    <kbd>Ctrl+D</kbd> deselects, <kbd>Ctrl+Shift+I</kbd> inverts.</p>
    <h4>Select menu</h4>
    <ul>
      <li><b>Color range…</b> selects every pixel close to a colour; click the canvas to pick it, and set how close with Fuzziness.</li>
      <li><b>Expand, shrink, feather</b> (soft edge) and <b>border</b> (a band along the edge).</li>
      <li><b>Quick mask</b> <kbd>Q</kbd>: the selection turns red and every tool paints it. Painting selects,
      erasing deselects, a blur softens it. Press <kbd>Q</kbd> again to get the selection back.</li>
    </ul>`],

  ['transform', 'Moving and transforming', `
    <ul>
      <li><b>Move</b> <kbd>V</kbd>: drag the layer, or only the selected pixels if there is a selection.</li>
      <li><b>Transform</b> <kbd>Ctrl+T</kbd>: drag the handles to scale (Shift keeps proportions), outside the box to
      rotate (Shift snaps to 15°), inside to move. Flip and turn 90° from its panel. <kbd>Enter</kbd> applies,
      <kbd>Esc</kbd> cancels.</li>
      <li><kbd>Ctrl+C</kbd>, <kbd>Ctrl+X</kbd>, <kbd>Ctrl+V</kbd> copy, cut and paste onto a new layer in the same place;
      pictures copied in other programs paste too, and you can drop image files onto the canvas.</li>
    </ul>`],

  ['layers', 'Layers and folders', `
    <p>Each layer is a sheet of its own: paint on one without touching the others. Click a layer to work on it, drag
    it to reorder, drag it onto a folder to put it inside.</p>
    <ul>
      <li>The buttons under the list add a layer or folder, add a mask, duplicate, move, merge down and delete.</li>
      <li><b>Blending mode</b> and <b>opacity</b> for each layer and folder; folders blend as "Through" by default.</li>
      <li><b>Lock alpha</b> paints only where there already is paint. <b>Clip below</b> shows a layer only inside the
      one under it (great for shading).</li>
      <li><b>Lock</b> protects a layer from changes; <b>Reference</b> marks line art for Fill and the wand.</li>
      <li>The coloured dots label layers so you can find them.</li>
      <li><b>Several at once:</b> <kbd>Ctrl</kbd>+click picks more layers, <kbd>Shift</kbd>+click picks a run of
      them. Then drag, the up/down buttons, the eye, delete, duplicate, <kbd>Ctrl+G</kbd> and <kbd>Ctrl+E</kbd> (merge
      them into one), the settings above the list, flips and the Move tool work on all of them.</li>
      <li><b>Vector layers</b> keep lines as lines, for erasing whole lines (see Vector layers).</li>
      <li>Double-click a name (or <kbd>F2</kbd>) to rename. <kbd>Ctrl+G</kbd> puts the layer in a new folder,
      <kbd>Ctrl+E</kbd> merges down.</li>
    </ul>`],

  ['vector', 'Vector layers', `
    <p>A <b>vector layer</b> (Layer → New vector layer) keeps every line you draw as a line, not as pixels. That is
    what makes cleaning up line art quick: the Eraser can remove a line, or cut it back to where it crosses another.</p>
    <ul>
      <li>Draw on it with the Pen, Pencil, Brush and Airbrush, and with the Figure tool (outlines, not filled shapes).
      Each line keeps the brush, colour and opacity it was drawn with.</li>
      <li>The <b>Eraser</b>'s <b>Vector</b> setting chooses how it works on vector layers:
        <b>Touched area</b> cuts away only what the eraser passes over;
        <b>Up to intersection</b> removes the stretch of a line between the lines it crosses, so overshoots
        disappear in one stroke; <b>Whole line</b> removes every line it touches.</li>
      <li>The Move tool moves the lines, <kbd>Del</kbd> clears them all, and undo works as everywhere.</li>
      <li>Tools that need pixels (Fill, filters, Transform, Smudge) ask you to <b>rasterize</b> the layer first
      (Layer → Rasterize vector layer). Flipping, resizing the canvas or merging into it rasterizes it too.</li>
    </ul>`],

  ['masks', 'Masks and screentone', `
    <h4>Layer masks</h4>
    <p>A mask hides part of a layer without erasing it. Add one from the Layers panel (with a selection, everything
    outside it is hidden), then click the mask thumbnail to paint on it: <b>painting hides, erasing shows again</b>.
    "Painting on mask" shows in the top bar; click it to paint on the layer again. View → Show mask area tints the
    hidden part red.</p>
    <h4>Screentone</h4>
    <p>Layer → New screentone makes a layer that turns gray into dots, as in printed manga. Paint in gray: darker
    gives denser dots, erasing removes them. Change the dots with Layer → Screentone settings.</p>`],

  ['filters', 'Filters', `
    <p>The Filter menu changes the current layer (or the mask you are painting on), inside the selection. Drag the
    sliders and the canvas shows the result; <b>OK</b> keeps it, <b>Cancel</b> puts it back.</p>
    <ul>
      <li>Blurs: Gaussian, motion, zoom and spin. Sharpen, mosaic and noise.</li>
      <li>Colour: brightness/contrast, hue/saturation, colour balance, curves, levels, posterize, threshold and invert.</li>
      <li><b>Extract lines</b> keeps only lines darker than their surroundings, as black ink (or their own colour) on a clear layer: use it on a scanned sketch or photo. Duplicate the layer first to keep the original.</li>
      <li><kbd>Ctrl+F</kbd> repeats the last filter with the same settings.</li>
    </ul>`],

  ['rulers', 'Rulers, guides, perspective and symmetry', `
    <ul>
      <li><b>Edge rulers</b> (View menu): drag out of them to add guides; drag a guide back to remove it.</li>
      <li>The <b>Ruler tool</b> (<kbd>U</kbd> twice) adds a 1-, 2- or 3-point perspective ruler and moves its points.</li>
      <li>With <b>snapping</b> on (<kbd>Ctrl+2</kbd>, or the magnet at the bottom) strokes follow the guide or
      perspective line they start along.</li>
      <li><b>Symmetry</b> (View → Symmetry settings…) mirrors what you draw, or repeats it round a centre.</li>
      <li><b>Grid</b> <kbd>Ctrl+'</kbd>, with its spacing in View → Grid settings….</li>
    </ul>`],

  ['canvas', 'Canvas size, cropping and turning', `
    <ul>
      <li>Image → <b>Canvas size</b> adds or removes space around the picture; <b>Image size</b> stretches everything.</li>
      <li>The <b>Crop</b> tool <kbd>C</kbd>: drag the box's edges, then <kbd>Enter</kbd>. Image → Crop to selection and
      Trim to content do it in one step.</li>
      <li>Rotate the canvas by 90° or 180°, or flip it, from the Image menu.</li>
    </ul>`],

  ['view', 'Zoom, view and undo', `
    <ul>
      <li>Scroll to zoom at the cursor; hold <kbd>Space</kbd> and drag (or use the Hand <kbd>H</kbd>) to move around.</li>
      <li><kbd>Shift</kbd>+scroll or <kbd>4</kbd> / <kbd>6</kbd> turns the view, <kbd>5</kbd> straightens it;
      <kbd>Shift+M</kbd> mirrors it to check your drawing.</li>
      <li><kbd>Ctrl+0</kbd> fits the picture in the window, <kbd>Ctrl+1</kbd> shows it at 100%.</li>
      <li>The <b>Navigator</b> shows the whole picture: click or drag in it to jump there.</li>
      <li><kbd>Ctrl+Z</kbd> undoes, <kbd>Ctrl+Y</kbd> redoes. The <b>History</b> panel lists the steps: click one to go
      straight back to it.</li>
    </ul>`],

  ['files', 'Saving, versions and exporting', `
    <ul>
      <li>Artwork is saved automatically in <b>Pictures\\KoeStudio</b>.</li>
      <li><b>Earlier versions</b>: a copy is kept every 10 minutes (the newest five). Open one from File → Earlier
      versions… or a gallery card's ⋯ menu; it opens as a copy, so nothing is overwritten.</li>
      <li>Deleted artwork can be put back with <b>Deleted</b> at the top of the gallery.</li>
      <li><b>File → Export…</b> <kbd>Ctrl+Alt+Shift+S</kbd> saves a PNG, JPEG, WebP, GIF, TGA or BMP, at any size,
      wherever you choose. <kbd>Ctrl+Shift+S</kbd> exports a PNG straight away.</li>
      <li><b>File → Save project file (.koe)…</b> saves the whole layered artwork to share or keep elsewhere.</li>
    </ul>`],
];

/** Shortcuts other than the tool keys (those come from TOOLS): [group, [[keys, what], ...]]. */
export const SHORTCUTS = [
  ['Painting', [['[ / ]', 'Smaller / bigger brush'], ['X', 'Swap main and sub colour'], ['Alt (hold)', 'Pick a colour'],
    ['Shift+click', 'Straight line from the last stroke']]],
  ['Edit', [['Ctrl+Z / Ctrl+Y', 'Undo / redo'], ['Ctrl+C / Ctrl+X / Ctrl+V', 'Copy / cut / paste'], ['Ctrl+T', 'Transform'],
    ['Del', 'Clear the selection or layer'], ['Alt+Del', 'Fill the selection or layer'], ['Ctrl+F', 'Repeat the last filter']]],
  ['Selection', [['Ctrl+A / Ctrl+D', 'Select all / deselect'], ['Ctrl+Shift+I', 'Invert the selection'], ['Q', 'Quick mask'],
    ['Shift / Alt (while dragging)', 'Add to / subtract from the selection']]],
  ['Layers', [['Ctrl+Shift+N', 'New layer'], ['Ctrl+G', 'Put in a new folder'], ['Ctrl+E', 'Merge down (or merge folder)'],
    ['Ctrl+Shift+Alt+E', 'Merge visible to a new layer'], ['F2', 'Rename the layer'],
    ['Ctrl+click / Shift+click', 'Pick several layers']]],
  ['View', [['Space (hold)', 'Move the view'], ['Ctrl+0 / Ctrl+1', 'Fit / 100%'], ['Ctrl+= / Ctrl+-', 'Zoom in / out'],
    ['4 / 6 / 5', 'Turn left / right / straighten'], ['Shift+M', 'Mirror the view'], ["Ctrl+'", 'Show the grid'],
    ['Ctrl+2 / Ctrl+;', 'Snap to rulers / show guides']]],
  ['File and program', [['Ctrl+S', 'Save now'], ['Ctrl+Shift+S', 'Export a PNG'], ['Ctrl+Alt+Shift+S', 'Export…'],
    ['Ctrl+Alt+C / Ctrl+Alt+I', 'Canvas size / image size'], ['F1', 'This guide'], ['F5 / Ctrl+R', 'Reload the screen']]],
];

/** The tool keys from the tool list: [[key, 'Tool / tool'], ...] in key order, tools sharing a key together. */
export function toolShortcuts(tools) {
  const byKey = new Map();
  for (const t of tools) byKey.set(t.key, [...(byKey.get(t.key) || []), t.label]);
  return [...byKey].sort(([a], [b]) => a.localeCompare(b)).map(([k, labels]) =>
    [k.toUpperCase(), labels.length > 1 ? `${labels.join(' / ')} (press again to switch)` : labels[0]]);
}

/** A page's text without its tags, for searching. */
export function plainText(html) {
  return html.replace(/<[^>]+>/g, ' ').replace(/&[a-z]+;/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * The guide pages that contain every word of the query (any case), those with a word in the title first;
 * all of them for an empty query.
 */
export function searchGuide(query, guide = GUIDE) {
  const words = String(query || '').toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return guide.map(([id]) => id);
  const hits = [];
  for (const [id, title, html] of guide) {
    const t = title.toLowerCase(), all = t + ' ' + plainText(html).toLowerCase();
    if (words.every(w => all.includes(w))) hits.push({ id, inTitle: words.some(w => t.includes(w)) });
  }
  return hits.sort((a, b) => b.inTitle - a.inTitle).map(h => h.id);
}
