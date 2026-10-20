// The guidebook (Help → Guide, F1) and the shortcut list (Help → Keyboard shortcuts), as data, plus the search
// used by the Guide window (pure, tested). Topics are short HTML pages: <p> (class lead / tip), <ul>, <ol>, <b>,
// <kbd>, <code>, <h4>, <figure data-pic="name"> for a picture from guidepics.js (help.js draws it in), and
// <button class="guide-link" data-goto="<page id>"> for a link to another page.
// Keep them in step with the features (README.md has the same facts in longer form).

/** [id, title, html] for each page of the guide, in reading order. */
export const GUIDE = [
  ['start', 'Getting started', `
    <p class="lead">KoeStudio opens on the <b>gallery</b>: all your artwork, newest first.</p>
    <ul>
      <li><b>New canvas</b> starts a picture. Pick a size from the list (screen, illustration, print and social media sizes) or type your own.</li>
      <li><b>Open image or project…</b> turns a picture file into a new artwork, or opens a <code>.koe</code> file.</li>
      <li>Click a card to keep working on it. Its <b>⋯</b> menu renames, copies or deletes it.</li>
      <li>With more than one artwork, the <b>Search</b> box at the top finds them by title, and the list next to it
      orders them by last change, name or size.</li>
    </ul>
    <h4>The drawing screen</h4>
    <figure data-pic="screen"><figcaption>1 Tools · 2 Settings of the tool you hold · 3 History and Navigator ·
    4 Canvas · 5 Colour · 6 Layers</figcaption></figure>
    <ul>
      <li>Click a tool, or press its key. Hover over any button to see what it does and its key.</li>
      <li>Click a panel's heading to fold it away.</li>
      <li>Menu items with <b>›</b> open a smaller menu to the side. With a menu open, point at another menu name to
      switch to it, or use the arrow keys.</li>
      <li>The arrow at the top left takes you back to the gallery.</li>
    </ul>
    <p class="tip">Your work <b>saves by itself</b> a moment after every change; there is no Save button to forget.
    <kbd>Ctrl+Z</kbd> undoes anything.</p>
    <p>New here? Try <button type="button" class="guide-link" data-goto="first">Your first picture, step by step</button>.</p>`],

  ['first', 'Your first picture, step by step', `
    <p class="lead">A simple way to make a finished picture. Each step has its own layer, so you can fix one without
    spoiling the others.</p>
    <figure data-pic="workflow"></figure>
    <ol>
      <li><b>New canvas</b> in the gallery. A4 or Full HD is a good start.</li>
      <li><b>Sketch</b> with the Pencil <kbd>N</kbd>. Rough is fine. Then turn the layer's <b>opacity</b> down to about 30%.</li>
      <li><b>Lines:</b> press <kbd>Ctrl+Shift+N</kbd> for a new layer and draw clean lines over the sketch with the Pen
      <kbd>P</kbd>. Hide the sketch with its eye when you are done.</li>
      <li><b>Colours:</b> add another layer and drag it <b>under</b> the lines. Tick <b>Reference</b> on the line layer,
      take Fill <kbd>G</kbd>, set <b>Look at</b> to <b>Reference layers</b>, and click inside each area.</li>
      <li><b>Shading:</b> add a layer above the colours, tick <b>Clip below</b> and set it to <b>Multiply</b>. Paint
      shadows with the Brush <kbd>B</kbd>; they stay inside the colours.</li>
      <li><b>Export:</b> File → Export… saves a PNG or JPEG to share.</li>
    </ol>
    <p class="tip">Made a mistake? <kbd>Ctrl+Z</kbd> undoes it, and your artwork saves by itself all along.
    More on each step: <button type="button" class="guide-link" data-goto="layers">Layers</button>, <button type="button" class="guide-link" data-goto="fill">Fill</button>, <button type="button" class="guide-link" data-goto="files">Exporting</button>.</p>`],

  ['drawing', 'Drawing and erasing', `
    <p class="lead">Pick a pen, choose a colour, and draw.</p>
    <ul>
      <li><b>Pen</b> <kbd>P</kbd> for clean lines, <b>Pencil</b> <kbd>N</kbd> for sketching, <b>Brush</b> <kbd>B</kbd> for
      soft paint, <b>Airbrush</b> <kbd>A</kbd> for gentle shading.</li>
      <li><b>Eraser</b> <kbd>E</kbd> takes paint away. The eraser end of your pen does too. <b>Hold</b> a tool's key
      instead of tapping it to use that tool for a moment: hold <kbd>E</kbd>, erase, let go, and you are back on
      the pen.</li>
      <li><kbd>[</kbd> and <kbd>]</kbd> make the brush smaller and bigger. Or hold <kbd>Ctrl+Alt</kbd> and drag on
      the canvas: the circle grows as you drag right and shrinks as you drag left, with its size shown above it.</li>
      <li><b>Shift+click</b> draws a straight line from where your last stroke ended.</li>
      <li><b>Hold to straighten</b> (Brush settings → Stroke): draw a line or a loop and keep the pen still for a moment
      before lifting it. The line turns straight, the loop into a neat ellipse; move the pen to stretch it, then lift.</li>
    </ul>
    <h4>The main settings</h4>
    <figure data-pic="strokes"><figcaption>Opacity and density both make paint lighter, but only density builds up
    where the stroke crosses itself.</figcaption></figure>
    <ul>
      <li><b>Opacity</b>: how see-through the whole stroke is. It never gets darker where the stroke overlaps itself.</li>
      <li><b>Density</b>: how much paint each little dab lays down, so it builds up as you go over it.</li>
      <li><b>Hardness</b>: a crisp edge at 100%, softer and softer below.</li>
      <li><b>Stabilization</b> smooths a shaky hand. Higher numbers smooth more, but the line trails a little behind the pen.</li>
    </ul>
    <figure data-pic="stabilize"></figure>
    <h4>Pen pressure</h4>
    <p>Lines too thin unless you press hard, or too thick at a light touch? Settings → <b>Pen pressure…</b> sets
    one curve for every tool. Pick Soft, Normal or Firm, drag the curve, or draw a few strokes on the test pad the way
    you usually draw and press <b>Fit to my strokes</b>.</p>
    <p class="tip">Each tool remembers its own settings, so the pen and the eraser each keep their own size.</p>`],

  ['brushes', 'Brush settings and saved brushes', `
    <p class="lead">The tool panel shows only the basics. <b>Brush settings…</b> opens a window with everything else.</p>
    <p>A preview stroke at the top of that window shows every change straight away. You can keep painting while it is
    open; drag it by its title bar.</p>
    <ul>
      <li><b>Paint</b>: size, opacity, density, hardness. <b>Wet edges</b> lets the paint gather at the edge of the
      stroke and leaves the middle lighter, as watercolour does when it dries (on for Watercolour and Marker).
      <b>Impasto</b> makes the paint look thick: light catches the top-left edge of each stroke and its bristle
      ridges, and the other side is shaded (on for Oil paint).
      <b>Runs dry</b> lets the brush give out its paint along the stroke: it starts solid, then the weaker hairs drop
      out and the end breaks into dry, scratchy streaks; each new stroke starts loaded again. With it on, the brush's
      Texture shows only where the paint runs dry (Oil paint uses Paper), so a short stroke stays solid.
      <b>Color mixing</b> makes the paint wet: the brush picks up the colours already on the layer and blends them
      into its own, and <b>Color stretch</b> sets how far it drags them along. <b>Paint load</b> is how much paint of
      its own the brush carries: turn it down for a blender that moves the colours already there and leaves little on
      bare paper. Try the Oil paint and Wet blender brushes. It mixes with the layer you paint on, so paint on the same layer as the colours to blend.</li>
      <li><b>Tip</b>: round, or any picture as the tip. Squash it, turn it, or let it turn with the stroke. The
      outline under the pointer takes the tip's shape, so you see what a dab will look like.
      <b>Squash jitter</b> and <b>Random flip</b> vary each dab, so a tip picture does not repeat the same way.
      <b>Hard pixels</b> makes every dab whole pixels with no soft edge, for pixel art (size 1 draws single pixels).</li>
      <li><b>Pen pressure</b>: whether pressing harder makes the line thicker, darker, or both.</li>
      <li><b>Stroke</b>: the gap between dabs, stabilization, and tapers (below).</li>
      <li><b>Tilt and speed</b>: tilt the pen to make the brush bigger or lighter (like shading with the side of a
      pencil) or to turn its tip, and make fast strokes thinner, as with an ink pen. Tilt needs a pen that reports it.
      Lines on a vector layer remember the tilt and speed, so they keep their look when you erase or bend them.</li>
      <li><b>Variation</b>: scatter dabs around the line, or vary their size, lightness and colour at random.
      <b>Count</b> lays several dabs at each step (with Scatter: spray, leaves, sparkles), and <b>Count jitter</b> makes
      that number random. Turn off <b>Both ways</b> to scatter dabs only sideways across the stroke.</li>
      <li><b>Texture</b>: a paper grain. It stays fixed to the canvas, so strokes share the same grain like real paper.
      With <b>Grain by pressure</b> (on for the Pencil) a light touch only catches the tops of the grain and a firm one
      fills it in, as with graphite. Keep <b>Density</b> low (the Pencil uses 45%) so light lines stay grey: pressure
      decides how deep the grain fills, Density how dark each pass is. <b>Pen → grain</b> lets pressure change how
      strongly the texture shows: above 0 a firm touch shows more grain, below 0 it shows less. <b>Texture mode</b>
      picks how the texture mixes with the paint, and <b>Texture each dab</b> puts it on every dab on its own.</li>
      <li><b>Tip</b>: Round, or <b>Bristles</b>, a row of hairs; with <b>Turn with the stroke</b> on and the angle at
      90° each hair leaves its own streak, as a dry brush does. <b>Flat brush</b> is a full row of hairs that
      touch, like a flat oil brush, with a few stray hairs at the ends: solid paint with fine streaks along the
      stroke (Oil paint uses it).</li>
      <li><b>Dual brush</b>: a second tip stamped along the stroke (its own size, spacing and scatter); the paint shows
      only where it lands, for chalk, dry bristles or leaves.</li>
      <li><b>Combined</b>: a second brush that paints along the same stroke, as Procreate's combined brushes do. Pick
      its tip (or click <b>Copy a brush…</b> to use any brush you have), then its size, density and spacing.
      <b>Combine</b> sets how its paint goes over the first: Multiply and Darken only darken, Screen and Lighten only
      lighten. Imported Procreate combined brushes come in set up this way.</li>
    </ul>
    <p>What the special settings do, good values, and which ones don't go together:
    <button type="button" class="guide-link" data-goto="brushnotes">Special brush settings: notes and tips</button>.</p>
    <figure data-pic="taper"><figcaption>Start and End taper make a stroke begin and end thin, even with a mouse.
    The thin end appears when you lift the pen.</figcaption></figure>
    <p><b>Taper size</b> sets how thin the ends get (100% comes to a point, 0% stays full width) and <b>Taper
    opacity</b> how much they fade out. Imported Procreate brushes bring their pen taper with them.</p>
    <h4>Ready-made brushes</h4>
    <p>The <b>Brush</b> row at the top of a paint tool's panel lists brushes that come with KoeStudio: inks (G-pen,
    Fineliner, Brush pen), pencils and chalk (HB, 6B, Charcoal, Chalk), paints (Gouache, Watercolour, Dry brush,
    Marker, Soft blend, Spatter) and, for the Eraser, a hard, a soft and a kneaded eraser. Pick one to load its
    settings, then change anything you like. Watercolour washes are see-through with darker edges, so strokes laid
    over each other get deeper; Gouache covers flat and runs dry at a light touch.</p>
    <p class="tip">To keep a changed ready-made brush, choose <b>⋯ → Save as new brush</b>. The ready-made ones
    always stay as they came.</p>
    <h4>Brushes window</h4>
    <p>The strip under the <b>Brush</b> row shows a stroke of your current brush. A <b>*</b> after the brush's name
    means you changed its settings since you picked it.</p>
    <ol>
      <li>Click the strip (or <b>View → Brushes</b>) to open a window with every brush, your saved ones too, each
      with a sample stroke in your current colour.</li>
      <li>Click a brush to use it, or press <kbd>↑</kbd> <kbd>↓</kbd> to step through them. Type in <b>Search</b> to
      find one by name.</li>
      <li>The three bars next to Search make the strokes small, medium or large. Drag the window's corner to make it
      bigger.</li>
      <li>Right-click a brush to save a copy, or to update, rename or delete one of your own.</li>
    </ol>
    <p class="tip">Changed a brush and want it back as it was? Click it again in the Brushes window.</p>
    <h4>Saved brushes</h4>
    <ol>
      <li>Set up a brush you like.</li>
      <li>Click <b>⋯</b> next to the <b>Brush</b> row and choose save.</li>
      <li>Pick it from the Brush row whenever you want it back.</li>
    </ol>
    <p>The same <b>⋯</b> menu updates, renames and deletes brushes, adds your own tip and texture pictures, and
    <b>imports Procreate, Photoshop, Clip Studio Paint, GIMP and Krita brushes</b> (<code>.brush</code>,
    <code>.brushset</code>, <code>.abr</code>, <code>.sut</code>, <code>.gbr</code>, <code>.gih</code>, <code>.vbr</code>, <code>.kpp</code>, <code>.bundle</code>).</p>
    <h4>Importing a brush pack</h4>
    <ol>
      <li>Click <b>⋯</b> next to the Brush row (or <b>Import…</b> in the Brushes window) and choose import.</li>
      <li>Every brush in the file shows its own stroke. Type in the search box to find brushes by name.</li>
      <li>Click the brushes you want. Shift+click picks every brush between two clicks; <b>All</b> and <b>None</b>
      pick the brushes the search shows.</li>
      <li>Click <b>Import</b>.</li>
    </ol>
    <p>A Clip Studio Paint <code>.sut</code> file holds one brush; it comes with its own tip and texture pictures.</p>
    <p>Procreate brushes keep the size they have in Procreate. A pack's title cards (a logo or a "free sample" banner
    shown as a brush) are left out.</p>
    <p class="tip">A brush marked <b>!</b> has a setting KoeStudio does not have: point at the ! to see which. Tick <b>Only
    complete brushes</b> to leave those out (it stays ticked for the next pack). Each pack gets
    its own group in the Brushes window and the Brush row.</p>
    <h4>Tidying up your brushes</h4>
    <ol>
      <li>Click <b>⋯</b> next to the Brush row and choose <b>Manage brushes</b> (or <b>Manage…</b> in the Brushes window).</li>
      <li>Click the brushes you want to change. Shift+click picks a range; <b>All</b> in a group's heading picks the whole group.</li>
      <li><b>Delete</b> removes them, <b>Move to group</b> puts them in another group or a new one.</li>
      <li>Drag brushes to put them in order, or onto another group. Double-click a brush to rename it.</li>
    </ol>
    <p>Each group's heading has buttons to hide it from the Brushes window and the Brush row, move it up or down, rename it or
    delete it with all its brushes. Under <b>Built-in brushes</b>, untick the groups you never use to hide them.</p>
    <p class="tip">Deleting cannot be undone, but brushes you only hide stay ready to show again.</p>`],

  ['brushnotes', 'Special brush settings: notes and tips', `
    <p class="lead">Some brush settings change how paint behaves, not just how big or dark it is. This page says what
    each one is for, which values work, and which settings don't go together.</p>
    <p>All of them are in the <b>Brush settings…</b> window. The preview stroke at the top shows a change straight away, so try a
    value there before you paint.</p>

    <h4>Wet edges (Paint page)</h4>
    <p>The paint gathers at the edge of the stroke and the middle gets lighter, as watercolour does when it dries.</p>
    <ul>
      <li>Good values: 0.2 for a marker, 0.5-0.6 for watercolour.</li>
      <li>It needs an even stroke to find the edge. Keep <b>Density</b> high and lower <b>Opacity</b> instead (Watercolour
      uses 60% density and 55% opacity).</li>
    </ul>

    <h4>Impasto (Paint page)</h4>
    <p>Makes the paint look thick: the top-left edge of each stroke and its bristle ridges catch the light, and the
    other side is shaded.</p>
    <ul>
      <li>Best with the <b>Flat brush</b> or <b>Bristles</b> tip and <b>Turn with the stroke</b> on: the hairs make
      the ridges. On a round tip only the outer edge is lit.</li>
      <li>Good values: 0.3-0.6. Flat paint keeps its colour; only the ridges and edges are lit, so higher values make
      the ridges stand out more.</li>
      <li>The light becomes part of the paint. A mixing brush that passes over it later picks it up, like any colour.</li>
      <li>Not on the Eraser, masks or Hard pixels.</li>
    </ul>

    <h4>Runs dry (Paint page)</h4>
    <p>The brush gives out its paint along the stroke. It starts solid, then the weaker hairs drop out and the end
    breaks into dry, scratchy streaks. Every new stroke starts loaded again.</p>
    <ul>
      <li>Higher runs dry sooner: 1 is dry after about 3 brush widths, 0.3 after about 20 (Oil paint uses 0.3).
      The brush stays fully loaded for almost half of that, so short strokes stay solid. Make long strokes for dry
      tails.</li>
      <li>It needs a tip with parts to drop: <b>Flat brush</b>, <b>Bristles</b> or a tip picture. On the Round tip it
      does nothing.</li>
      <li>With Runs dry on, the <b>Texture</b> shows only where the paint runs dry, so the loaded part stays solid.
      Paper gives the most painterly breakup.</li>
    </ul>
    <p class="tip">Turning Runs dry off makes the texture cover the whole stroke again. For a smooth, fully loaded
    brush, set <b>Texture</b> to None as well.</p>

    <h4>Color mixing, Color stretch and Paint load (Paint page)</h4>
    <p><b>Color mixing</b> picks up the colours already on the layer and mixes them into the brush colour.
    <b>Color stretch</b> is how far it drags them along. <b>Paint load</b> is how much paint of its own the brush
    carries.</p>
    <ul>
      <li>It mixes only with the layer you paint on, as it was when the pen went down. Paint on the same layer as the
      colours you want to blend. It doesn't mix with its own stroke, and does nothing on vector layers.</li>
      <li>The brush picks up a colour as soon as it touches it, and <b>Color stretch</b> decides how long it keeps
      it. For paint that covers but smears a little, use mixing 0.3-0.5 with stretch about 0.5 (Oil paint: 0.35 and
      0.5). Higher mixing makes a dark stroke look see-through over light colours.</li>
      <li>For a blender, use mixing 0.9 or more and <b>Paint load</b> 0.1-0.2: it moves the colours already there and
      leaves little on bare paper (the Wet blender).</li>
    </ul>

    <h4>Texture, Texture mode, Pen → grain and Grain by pressure (Texture page)</h4>
    <ul>
      <li>The grain is fixed to the canvas, so strokes share it, like real paper.</li>
      <li><b>Grain by pressure</b>: a light touch catches only the tops of the grain and a firm one fills it in. Use
      it for pencils and chalk with the Round tip, and keep <b>Density</b> low (Pencil: 45%).</li>
      <li>Don't use Grain by pressure with the <b>Bristles</b> or <b>Flat brush</b> tip: each thin dab is cut on its
      own and the stroke turns into hatching. Use <b>Runs dry</b> instead.</li>
      <li><b>Pen → grain</b>: at 100% a light touch paints smooth and pressing harder brings the grain in; at -100%
      it is the other way round. 50% keeps half the grain at the lightest touch. It works with every tip, and with
      Grain by pressure and Runs dry it scales the grain they show.</li>
      <li><b>Texture mode</b> is how the texture mixes with the paint; they are the modes of Clip Studio Paint and
      give the same result. <b>Multiply</b> (the usual one) leaves out paint in the grooves. <b>Subtract</b> takes the
      grooves out of thin paint first, so light strokes break up and dense ones stay solid (pencils). <b>Compare</b>
      keeps the paint below the texture. <b>Height</b> fills the low parts first and goes solid quickly as the paint
      gets denser: keep Grain and Density low with it (Clip Studio pencils use about 25-40%).
      <b>Normal</b>, <b>Overlay</b>, <b>Color dodge</b>, <b>Color burn</b>, <b>Hard mix</b> and <b>Outline</b>
      push the grain lighter or darker in other ways.</li>
      <li><b>Texture each dab</b> (Clip Studio Paint: Apply by each plot) puts the texture on every dab on its own,
      so overlapping dabs build up on the grain. Off, the texture goes over the stroke as a whole, and a stroke never
      gets darker than one pass. Grain by pressure goes first when both are on.</li>
      <li>The <b>Canvas</b> grain is a weave, so over a whole stroke it reads as cloth. For broken, painterly edges,
      Paper or Chalk look more natural.</li>
    </ul>

    <h4>Hair tips (Tip page)</h4>
    <ul>
      <li><b>Bristles</b>: a sparse row of hairs, for dry-brush streaks with gaps between them.</li>
      <li><b>Flat brush</b>: a full row of touching hairs with a few strays at the ends, for solid paint with fine
      streaks and ragged edges.</li>
      <li>Turn on <b>Turn with the stroke</b> and set the angle to 90° so each hair draws its own streak along the
      stroke. Without it the hairs keep one direction, so a stroke that curves away from it smears sideways.</li>
    </ul>

    <h4>Squash jitter and Random flip (Tip page)</h4>
    <ul>
      <li>For tip pictures such as fur, leaves or rakes: each dab is squashed or mirrored at random, so the
      stroke does not show the same picture over and over.</li>
      <li>Squash jitter 0.2-0.4 is subtle. Higher values make some dabs thin slivers.</li>
      <li>Random flip does nothing on a plain round tip, which looks the same mirrored. Neither works with Hard pixels.</li>
    </ul>

    <h4>Scatter: Both ways (Variation page)</h4>
    <ul>
      <li>On (the usual): each dab moves in any direction, so dabs bunch up and leave gaps along the stroke too.</li>
      <li>Off: dabs move only sideways across the stroke and stay evenly spaced along it. Good for fur and grass
      tips spaced far apart, where every tuft should keep its place. Photoshop calls this Both Axes, and imported
      brushes bring it.</li>
      <li>It does nothing while <b>Scatter</b> is 0.</li>
    </ul>

    <h4>Count jitter (Variation page)</h4>
    <ul>
      <li>Each step lays a random number of dabs, from <b>Count</b> down to fewer. At 100% it can be anywhere from 1 to Count.</li>
      <li>Good for spray, grass and fur: clumps come out thicker in some places and thinner in others.</li>
      <li>It does nothing while Count is 1.</li>
    </ul>

    <h4>Dual brush and Combined (their own pages)</h4>
    <ul>
      <li><b>Dual brush</b> only cuts the stroke: the paint shows where its second tip lands. Use it for broken
      chalk, leaves or dry bristles.</li>
      <li><b>Combined</b> adds paint: a second brush along the same stroke. A <b>Combine</b> mode other than Normal is
      blended over the whole stroke, not dab by dab.</li>
      <li>Texture, Wet edges, Opacity and the selection treat the main and second brush as one stroke. Impasto and
      Runs dry follow only the main brush.</li>
    </ul>

    <h4>Settings that don't go together</h4>
    <ul>
      <li><b>Hard pixels</b> turns off Wet edges, Impasto, Runs dry and Grain by pressure, so pixel art stays crisp.</li>
      <li><b>Grain by pressure</b> with a hair tip: hatching (see above).</li>
      <li><b>Runs dry</b> with the Round tip: no effect.</li>
      <li><b>Color mixing</b> on a vector layer, or over colours on another layer: nothing to mix with.</li>
    </ul>
    <p class="tip">The easiest start is a ready-made brush close to what you want (Oil paint, Watercolour, Dry brush).
    Change it, then keep it with <b>⋯ → Save as new brush</b>.</p>`],

  ['retouch', 'Smudge, blur and retouching', `
    <p class="lead">These tools change paint that is already on the layer, instead of adding new paint.</p>
    <ul>
      <li><b>Smudge</b> <kbd>J</kbd> drags paint along like a wet finger.</li>
      <li><b>Liquify</b> (<kbd>J</kbd> again) bends the picture: <b>Push</b> drags it with the pen; <b>Pinch</b>,
      <b>Bloat</b> and <b>Twirl</b> work where you hold the pen still.</li>
      <li><b>Blur</b> (<kbd>J</kbd> until it shows) softens what you paint over.</li>
      <li><b>Dodge</b> lightens and <b>Burn</b> darkens (<kbd>O</kbd>, press again to switch). Keep the strength low
      and go over it a few times.</li>
    </ul>
    <h4>Clone stamp <kbd>S</kbd></h4>
    <figure data-pic="clone"></figure>
    <ol>
      <li>Hold <kbd>Ctrl</kbd> and click the part you want to copy. A crosshair marks it.</li>
      <li>Paint somewhere else: the copy appears under the brush, and the crosshair moves along with it.</li>
    </ol>
    <p><b>Aligned</b> keeps the same distance for every stroke; turn it off to start from the crosshair each time.
    <b>Look at</b> copies from this layer only, or from everything you see.</p>
    <p class="tip">All of these stay inside the selection, if there is one. Smudge, Liquify, Blur, Dodge and Burn
    follow the symmetry ruler.</p>`],

  ['color', 'Colour', `
    <figure data-pic="color"></figure>
    <ul>
      <li>Pick the colour in the <b>hue bar</b>, then how light and strong it is in the <b>square</b>.</li>
      <li>You paint with the <b>main</b> colour. The <b>sub</b> colour waits behind it; <kbd>X</kbd> swaps them.</li>
      <li>The <b>mixing strip</b> under them shows nine steps from the main to the sub colour, evenly spaced to the eye.
      Click one to paint with it; the strip keeps its two ends while you pick from it, for blending shades.</li>
      <li><b>Sliders</b> under the square: <b>HSV</b> (hue, saturation, brightness) or <b>RGB</b> (red, green, blue).
      Type a number in the box beside a slider for an exact value; <b>Hide</b> folds them away. A colour code such as
      <code>#ff8800</code> goes in the box next to the colour squares.</li>
      <li>The round button next to the hex box swaps the square and hue bar for a <b>colour wheel</b>: drag round the
      ring for the hue, inside the square for how strong and light it is.</li>
      <li>Hold <kbd>Alt</kbd> while painting to pick a colour from the canvas, or use the <b>Eyedropper</b> <kbd>I</kbd>.
      Its settings pick from everything you see or only the selected layer, and can average a small square, so a
      grainy texture does not decide the colour. While you pick, a ring round the pointer shows the new colour on
      top and the one you had below.</li>
      <li>Edit → <b>Pick screen color</b> takes a colour from anywhere on the screen, even another program or a
      photo in your browser: click it (Esc gives up). Give it a key in Settings → Keyboard shortcuts if you use it often.</li>
      <li><b>Recent</b> colours appear by themselves. For colours you want to keep, press <b>+</b> next to
      <b>Palette</b>. Click a swatch to use it, right-click to remove it.</li>
      <li>The palette's <b>⋯</b> button imports palette files (GIMP and Krita <code>.gpl</code>, Photoshop
      <code>.aco</code>, Adobe <code>.ase</code>, Lospec <code>.hex</code>), saves yours as a <code>.gpl</code>, or clears it.</li>
    </ul>
    <h4>Color mixing</h4>
    <p>The <b>Color mixing</b> panel under the Color panel is a little scrap of paper for mixing paint, as in Clip
    Studio Paint. It never touches your artwork.</p>
    <ol>
      <li>Click a paint along its bottom (or choose any main colour) and dab it on with the <b>brush</b>. The brush mixes
      with the paint already there, like wet paint.</li>
      <li>Switch to the <b>blender</b> to push the colours into each other.</li>
      <li>With the <b>eyedropper</b>, click the mix to make that colour your main colour. <kbd>Alt</kbd>+click does the
      same with the brush or blender.</li>
    </ol>
    <p>The slider sets the brush size; the bin clears the paper (the message that follows can undo it).</p>
    <p class="tip">Your mixes stay on the paper between artworks and after closing KoeStudio, so it doubles as a
    scratch palette.</p>
    <h4>Reference window</h4>
    <p>View → Reference window shows pictures beside your canvas while you draw. Press <b>+</b> (or drop pictures on it)
    to add some. Scroll to zoom, drag to move, click to pick a colour, double-click to fit. They stay there for every
    artwork.</p>`],

  ['fill', 'Fill and gradients', `
    <p class="lead"><kbd>G</kbd> picks the Fill tool. Press <kbd>G</kbd> again for Gradient, then Lasso fill and Fill gaps.</p>
    <h4>Fill</h4>
    <p>Click inside an area to fill it with the main colour.</p>
    <figure data-pic="gaps"><figcaption>Lines with small gaps? Raise <b>Close gaps</b> so the fill stays inside.</figcaption></figure>
    <ul>
      <li><b>Look at</b>: where the fill finds its edges. <b>All layers</b> uses everything you see, so you can fill on
      a colour layer under your line art. <b>Reference layers</b> uses only the layers ticked <b>Reference</b>.</li>
      <li><b>Margin</b>: how different a colour can be and still get filled.</li>
      <li><b>Expand</b> grows the fill a little, under the lines, so no white rim is left.</li>
      <li>Untick <b>Connected only</b> to fill every spot of that colour in the picture at once.</li>
    </ul>
    <h4>Gradient</h4>
    <figure data-pic="gradient"></figure>
    <ul>
      <li>Drag from where the gradient starts to where it ends. Hold Shift for a straight angle.</li>
      <li><b>Colors</b>: main to sub, or a ready-made one (rainbow, sunset, sky, fire, night).</li>
      <li><b>Shape</b>: straight, circle, angle (round the start like a clock hand), reflected (both ways from the
      start) or diamond. <b>Repeat</b> and <b>Mirror</b> make stripes and rings.</li>
      <li><b>Dither</b> adds a faint grain so smooth gradients show no bands.</li>
      <li><b>Edit gradient…</b> makes your own: click under the colour strip to add a colour, drag the markers to move
      them, and give each one a colour (or "main colour" / "sub colour", so it follows the colour squares) and an
      opacity. Saved gradients appear in the Colors list, and Gradient map uses them too.</li>
    </ul>
    <h4>Colouring inside line art</h4>
    <p>Tick <b>Reference</b> on your line art layer first. Then:</p>
    <ul>
      <li><b>Stay inside lines</b> (Brush settings… → Paint, for any brush or eraser): the stroke paints only inside the
      shape it starts in, so colour never goes over the lines.</li>
      <li><b>Edit → Colorize…</b> fills all the shapes at once, on a new layer, and shows it before you press
      Colorize. <b>Pick colours for me</b> chooses colours from a scheme (or your palette) so touching shapes differ;
      <b>Shuffle</b> tries others. Or scribble a little of each colour on a layer, keep it selected and choose
      <b>Use the hint colours</b>: closed shapes you left out take the colour round them. The background stays clear.</li>
    </ul>
    <figure data-pic="colorize"></figure>
    <h4>Lasso fill</h4>
    <p>Draw round an area and it fills with the main colour, like colouring in with a marker. Tick <b>Erase</b> to
    clear the area you draw round instead.</p>
    <h4>Fill gaps</h4>
    <p>After filling, little specks and slivers often stay empty next to the line art. Fill gaps (Clip Studio
    Paint's Paint unfilled area) mops them up:</p>
    <ol>
      <li>Pick your colour layer and the same colour as the fill.</li>
      <li>Press <kbd>G</kbd> until Fill gaps shows, and brush over the specks.</li>
      <li>When you lift the pen, every area that lies wholly inside what you brushed over is filled. The big areas
      round it (the fill, the lines, the paper outside) run on past your stroke, so they are left alone.</li>
    </ol>
    <p class="tip">Brush a little wider than the specks. A speck your stroke only half covers is not filled.</p>
    <p class="tip">With a selection, every fill stays inside it. Colouring under line art is shown step by step in <button type="button" class="guide-link" data-goto="first">Your first picture</button>.</p>`],

  ['shapes', 'Shapes and text', `
    <h4>Figure <kbd>U</kbd></h4>
    <p>Drag to draw a <b>line</b>, an <b>arrow</b> (or a double arrow, with a head at both ends), <b>rectangle</b>, <b>ellipse</b>, <b>regular polygon</b> or <b>star</b>. Hold Shift
    for a straight line, a square, a circle or an even shape. Tick <b>Fill the shape</b> for a solid shape;
    <b>Rounding</b> rounds a rectangle's corners, <b>Corners</b> sets how many sides or points, and <b>Star depth</b>
    how deep a star's points are cut.</p>
    <figure data-pic="polygon"></figure>
    <ul>
      <li><b>Polyline</b> and <b>Polygon</b>: click each corner. Double-click or <kbd>Enter</kbd> to finish.</li>
      <li><b>Curve</b> and <b>Closed curve</b>: click points, and a smooth line runs through them.</li>
      <li><kbd>Backspace</kbd> takes back the last point; <kbd>Esc</kbd> drops the shape.</li>
    </ul>
    <h4>Text <kbd>T</kbd></h4>
    <ol>
      <li>Click the canvas and type.</li>
      <li>Click somewhere else, or press <kbd>Esc</kbd>, when you are done.</li>
      <li>Click the text again any time to change it.</li>
    </ol>
    <p>Choose the font, size, bold, italic, alignment and line spacing in the tool panel. <b>Vertical</b> writes top to
    bottom, as in manga. <b>Outline</b> puts a border round the letters.</p>
    <p><b>Style part of the text:</b> select some letters in the text box, then change the font, size, Bold, Italic
    or the main colour: only those letters change. With nothing selected, a change goes to the whole text. Letters
    you type carry on the look of the letter before them.</p>
    <p>Edit → <b>Transform</b> (<kbd>Ctrl</kbd>+<kbd>T</kbd>) turns, sizes and mirrors a text layer and it stays text:
    you can still click it to change the words, and it stays sharp at any size. Flipping, turning or resizing the
    canvas keeps text editable too. Only Distort and Mesh need it rasterized.</p>
    <p class="tip">Text stays editable on its own layer. To paint on it, use Layer → Rasterize → Text first.</p>`],

  ['selection', 'Selections', `
    <p class="lead">A selection fences off part of the picture. Painting, fills, filters and <kbd>Del</kbd> then only
    change what is inside it.</p>
    <ul>
      <li><b>Rectangle</b> <kbd>M</kbd> (press again for <b>Ellipse</b>): drag a box.</li>
      <li><b>Lasso</b> <kbd>L</kbd>: draw round it freehand. Press again for <b>Polygon</b>: click the corners.</li>
      <li><b>Magic wand</b> <kbd>W</kbd>: click an area of one colour.</li>
    </ul>
    <figure data-pic="selmodes"><figcaption>Hold a key while you drag to change the selection you already have.</figcaption></figure>
    <p><kbd>Ctrl+A</kbd> selects everything, <kbd>Ctrl+D</kbd> deselects, <kbd>Ctrl+Shift+I</kbd> swaps inside and outside.
    Deselected by mistake? <kbd>Ctrl+Shift+D</kbd> (Select → <b>Reselect</b>) brings the last selection back.</p>
    <p>A small bar under the selection has the usual next steps: deselect, invert, transform, fill, delete, copy to a
    new layer and crop. Turn it off under View → Selection bar.</p>
    <h4>Select menu</h4>
    <ul>
      <li><b>Color range…</b> selects every pixel close to a colour. Click the canvas to choose it.</li>
      <li><b>Select layer pixels</b> selects what is painted on the current layer. Or <kbd>Ctrl</kbd>+click any
      layer's thumbnail in the Layers panel; add <kbd>Shift</kbd> to add it to the selection, <kbd>Alt</kbd> to take it away.</li>
      <li><b>Expand</b> and <b>Shrink</b> grow or shrink it; <b>Feather</b> gives it a soft edge; <b>Border</b>
      selects a band along its edge.</li>
      <li>Edit → <b>Stroke selection…</b> draws a line along the edge of the selection.</li>
    </ul>
    <h4>Quick mask <kbd>Q</kbd></h4>
    <figure data-pic="quickmask"></figure>
    <p>Paint the selection with any tool: <b>painting</b> takes away from it, <b>erasing</b> adds to it, a blur softens
    its edge. Press <kbd>Q</kbd> again to go back to a normal selection.</p>`],

  ['transform', 'Moving and transforming', `
    <ul>
      <li><b>Move</b> <kbd>V</kbd>: drag the whole layer. With a selection, only the selected part moves.
      <kbd>Ctrl</kbd>+drag first picks the top layer with paint under the pointer, so you can grab a thing without
      looking for its layer. Right-click lists every layer with paint there. The arrow keys move it a pixel at a
      time (ten with <kbd>Shift</kbd>); presses in a row undo as one step.</li>
      <li><b>Transform</b> <kbd>Ctrl+T</kbd>: resize, turn or flip the layer or the selection. Type an exact width,
      height (in %) or angle in the bar at the top and press <kbd>Enter</kbd>.</li>
    </ul>
    <figure data-pic="transform"></figure>
    <ul>
      <li>Hold Shift to keep the proportions while resizing, or to turn in 15° steps. Hold Alt to resize from the
      middle, so the opposite side moves too.</li>
      <li>The tool panel has buttons to flip and turn by 90°.</li>
      <li><b>Distort</b> (or <kbd>Ctrl</kbd>+drag a corner) moves each corner on its own: use it to lay a picture onto a
      wall or a screen in perspective.</li>
      <li><b>Mesh</b> puts a grid of points over it. Drag a point and the picture bends smoothly around it: wrap a
      pattern round a sleeve, or nudge a face into shape. Drag between the points to move the whole thing.</li>
      <li>The arrow keys nudge it by one pixel (with Shift, ten).</li>
    </ul>
    <figure data-pic="mesh"></figure>
    <h4>Copy and paste</h4>
    <p><kbd>Ctrl+C</kbd>, <kbd>Ctrl+X</kbd> and <kbd>Ctrl+V</kbd> copy, cut and paste onto a new layer, in the same
    place. Pictures copied in other programs paste too, and you can drop picture files onto the canvas.</p>`],

  ['layers', 'Layers and folders', `
    <p class="lead">Layers are like clear sheets stacked on top of each other. Paint on one without touching the
    others: keep line art on top and colours underneath, and you can fix either one on its own.</p>
    <figure data-pic="layers"></figure>
    <ul>
      <li>Click a layer to paint on it. Drag it up or down the list to change the order.</li>
      <li>The buttons under the list add a layer, a folder or a mask, copy, move, merge and delete.</li>
      <li>The <b>eye</b> hides a layer. <kbd>Alt</kbd>+click an eye to see only that layer; <kbd>Alt</kbd>+click it
      again to bring the others back as they were. Double-click its name (or press <kbd>F2</kbd>) to rename it.</li>
      <li><b>Opacity</b> makes the whole layer see-through. <b>Blending</b> modes such as Multiply (for shadows) and
      Screen (for light) change how it mixes with what is below.</li>
    </ul>
    <h4>Handy switches</h4>
    <figure data-pic="clip"></figure>
    <ul>
      <li><b>Clip below</b> shows a layer only where the layer under it has paint: shade without going over the edges.</li>
      <li><b>Lock alpha</b> paints only where this layer already has paint.</li>
      <li><b>Lock</b> protects the layer from any change. <b>Reference</b> marks line art for Fill and the wand.</li>
      <li><b>Draft</b> is for sketches: you see the layer while you draw, but exports leave it out, and Fill and the
      Magic wand looking at all layers ignore it, so the sketch lines never stop a fill.</li>
      <li>The coloured dots are labels, to help you find layers. The <b>magnifier</b> under the list finds layers by
      name (inside closed folders too); <kbd>Enter</kbd> selects the first one, <kbd>Esc</kbd> shows all again.</li>
      <li>Which layer is that stray dot on? Layer → <b>Find layer on canvas</b>, then click the dot: its layer gets
      selected. (With the Move tool, <kbd>Ctrl</kbd>+click does the same.)</li>
    </ul>
    <h4>More</h4>
    <ul>
      <li><b>Folders</b> keep layers together; drag a layer onto a folder to put it inside. <kbd>Ctrl+G</kbd> puts the
      layer in a new folder.</li>
      <li><kbd>Ctrl+E</kbd> merges a layer into the one below. <b>Flatten image</b> puts everything on one layer.</li>
      <li><b>Copy to new layer</b> <kbd>Ctrl+J</kbd> and <b>Cut to new layer</b> <kbd>Ctrl+Shift+J</kbd> lift the
      selection onto its own layer.</li>
      <li><b>Several at once:</b> <kbd>Ctrl</kbd>+click or <kbd>Shift</kbd>+click more layers, then move, hide, delete,
      merge or change them together.</li>
    </ul>
    <p>See also: <button type="button" class="guide-link" data-goto="effects">Layer effects</button>, <button type="button" class="guide-link" data-goto="adjust">Correction layers</button>, <button type="button" class="guide-link" data-goto="masks">Masks</button>, <button type="button" class="guide-link" data-goto="vector">Vector layers</button>.</p>`],

  ['effects', 'Layer effects', `
    <p class="lead">Give everything on a layer an outline or a shadow, without changing what you drew.</p>
    <figure data-pic="effects"></figure>
    <ol>
      <li>Select the layer, then open Layer → <b>Layer effects (border, shadow)…</b></li>
      <li>Tick <b>Border</b> and set its width and colour, and/or tick <b>Drop shadow</b> and set how far it falls,
      how soft it is, its colour and opacity. The canvas shows it as you change it.</li>
      <li>Press <b>OK</b>.</li>
    </ol>
    <p>The effects follow along while you keep drawing on the layer. The Layers panel shows "border" or "shadow" under
    the layer's name.</p>
    <p class="tip">Great for stickers, lettering and logos. Layer → Rasterize → <b>Layer effects</b> turns them into
    ordinary paint (merging the layer down does too).</p>
    <h4>Layer color</h4>
    <p>Layer → <b>Layer color…</b> shows everything on a layer in one colour, to try a new hair or shirt colour in a
    second. The paint itself stays as it was: untick it to get the old colours back, or Layer → Rasterize →
    <b>Layer color</b> to keep the new one.</p>
    <h4>Expression color</h4>
    <p>Show a layer in <b>Gray</b> or <b>Monochrome</b> (black and white only), as in Clip Studio Paint. The paint
    itself stays as it was, so you can go back to <b>Color</b> at any time.</p>
    <ol>
      <li>Select the layer and pick Color, Gray or Monochrome in the box next to <b>Draft</b> in the Layers panel.</li>
      <li>For Monochrome, Layer → <b>Expression color…</b> sets the <b>Threshold</b> (darker than it is black,
      the rest white) and whether the white shows or is see-through.</li>
    </ol>
    <p class="tip">Monochrome with the white see-through turns grey or coloured line art into clean black lines for
    print. Layer → Rasterize → <b>Expression color</b> makes it for good.</p>`],

  ['adjust', 'Correction layers', `
    <p class="lead">Change the colours of everything below, and keep changing your mind: a correction layer never
    touches the layers under it.</p>
    <figure data-pic="adjust"></figure>
    <ol>
      <li>Select the top layer of what you want to change (or make a selection first to change only that part).</li>
      <li>Open Layer → New → <b>Correction layer…</b> and pick one: Brightness/Contrast, Levels, Curves,
      Hue/Saturation/Lightness, Color balance, Posterize, Threshold, Invert colors or Gradient map.</li>
      <li>Drag its sliders; the canvas follows. Press <b>OK</b>.</li>
    </ol>
    <ul>
      <li>To change it later, double-click its thumbnail (a half black, half white circle), or use Layer →
      <b>Correction layer settings…</b></li>
      <li>Lower its <b>opacity</b> to make it weaker, or hide it with the eye to compare.</li>
      <li>Paint on its <b>mask</b> to choose where it applies: painting hides the correction there.</li>
      <li>Turn on <b>Clip below</b> to change only the layer right under it. Inside a folder (not set to Through) it
      changes only that folder.</li>
      <li>Merging it down makes the change permanent on the layer below.</li>
    </ul>
    <p class="tip">Try a Gradient map or Hue/Saturation correction on top of a finished picture to test colour
    moods without repainting anything.</p>`],

  ['vector', 'Vector layers', `
    <p class="lead">A <b>vector layer</b> remembers every line as a line, not as pixels. That makes cleaning up line
    art fast.</p>
    <p>Make one with Layer → New → Vector layer, then draw on it with the Pen, Pencil, Brush, Airbrush or Figure tool.</p>
    <figure data-pic="vector"><figcaption>The Eraser's <b>Vector</b> setting: the red circle is where the eraser
    went.</figcaption></figure>
    <ul>
      <li><b>Touched area</b> erases only what the eraser passes over, as on a normal layer.</li>
      <li><b>Up to intersection</b> removes a line back to where it crosses another one: overshoots vanish in one
      stroke.</li>
      <li><b>Whole line</b> removes every line the eraser touches.</li>
    </ul>
    <h4>Line edit <kbd>Y</kbd></h4>
    <p>Click a line to pick it, then drag it to bend it. The tool panel changes its width, opacity or colour,
    <b>Smooth</b> evens out a shaky line, and <kbd>Del</kbd> deletes it.</p>
    <h4>Selecting lines</h4>
    <p>Draw a selection round some lines with any selection tool: a line counts as selected when at least half of
    it is inside. Then <kbd>Del</kbd> removes those lines, and Edit → <b>Transform</b> (<kbd>Ctrl</kbd>+<kbd>T</kbd>)
    or the Move tool moves, turns, sizes or distorts them. They stay lines, and get thicker or thinner as you size
    them. With nothing selected, Transform takes every line.</p>
    <p class="tip">Fill, filters, Mesh and Smudge need pixels: they ask to <b>rasterize</b> the layer first
    (Layer → Rasterize → Vector layer).</p>`],

  ['masks', 'Masks and screentone', `
    <h4>Layer masks</h4>
    <p class="lead">A mask hides part of a layer without erasing it, so you can always bring it back.</p>
    <figure data-pic="mask"></figure>
    <ol>
      <li>Press the mask button under the Layers list. With a selection, everything outside it is hidden at once.</li>
      <li>Click the mask's small picture next to the layer. "Painting on mask" shows in the top bar.</li>
      <li><b>Paint</b> to hide, <b>erase</b> to show again.</li>
      <li>Click the layer's own picture to paint on the layer again.</li>
    </ol>
    <p>View → Show mask area tints the hidden part red while you paint on the mask. Layer → Mask turns a mask off,
    applies it, or deletes it.</p>
    <h4>Screentone</h4>
    <p>Layer → New → <b>Screentone</b> makes a layer that shows gray as dots, like printed manga. Paint in gray: darker
    gives bigger dots, erasing removes them. Layer → Screentone settings changes the dot size, angle and shape.</p>
    <ul>
      <li>Set the dot size in pixels (<b>Spacing</b>) or in <b>Lines per inch</b>, as printed tones are sold: it uses
      the artwork's resolution (Image → Image size). 60 lines per inch at 350 dpi is a common manga tone.</li>
      <li><b>Shift X / Y</b> moves the dots. Shift a second tone layer by half its spacing so its dots fall between the
      first one's instead of on top.</li>
      <li>For a <b>gradient tone</b>, pick a <b>Fade</b> direction in New screentone: the dots fade from the density
      to the Fade to density across the selection (or the whole canvas).</li>
    </ul>`],

  ['filters', 'Filters', `
    <p class="lead">The Filter menu changes the current layer, inside the selection if there is one.</p>
    <ol>
      <li>Pick a filter.</li>
      <li>Move the sliders: the canvas shows the result as you go.</li>
      <li><b>OK</b> keeps it; <b>Cancel</b> puts everything back.</li>
    </ol>
    <ul>
      <li><b>Blurs</b>: Gaussian (soft all over), Motion (a streak in one direction), Zoom and Spin (click the canvas to
      set the centre).</li>
      <li><b>Sharpen</b>, <b>Mosaic</b> (big pixels) and <b>Add noise</b> (grain). <b>Median</b> takes grain away
      again while keeping edges sharp.</li>
      <li><b>Glow</b> lets light spill softly round the bright parts (set how bright with <b>Brighter than</b>);
      <b>Chromatic aberration</b> gives edges red and blue fringes, stronger towards the corners, like a cheap lens.</li>
      <li><b>Offset (wrap around)</b> slides the picture so what leaves one edge comes back at the other. To make a
      seamless pattern: offset by 50% both ways, paint over the seams now in the middle, and offset back.</li>
      <li><b>Colour fixes</b>: Brightness/Contrast, Hue/Saturation, Color balance, Curves, Levels, Posterize,
      Threshold (black and white only) and Invert. To keep changing them later, use a
      <button type="button" class="guide-link" data-goto="adjust">correction layer</button> instead.</li>
      <li><b>Gradient map</b> recolours by lightness, using the Gradient tool's colours: try Sunset or Night.</li>
      <li><b>Grayscale</b> takes the colour out; <b>Auto contrast</b> stretches a dull picture to full black and white.</li>
      <li><b>Reduce to palette colors</b> gives every pixel the nearest colour of your palette (Color panel), for
      pixel art. <b>Dither</b> mixes two colours in a fine pattern instead of hard bands.</li>
      <li><b>Vignette</b> darkens (or lightens) the corners; <b>Emboss</b> turns the picture into a relief;
      <b>Oil paint</b> flattens areas into patches of colour.</li>
      <li><b>Distort</b>: <b>Wave</b> bends the picture along waves, <b>Twirl</b> swirls it round a centre,
      <b>Pinch / bulge</b> swells the middle out like a fish-eye lens (or pulls it in below 0) and <b>Ripple</b> makes
      rings like a stone dropped in water. Click the canvas to put the centre there. <b>Polar coordinates</b> wraps
      the rows of the picture into rings round the middle (stripes become a target, a row of trees a round planet);
      the other one unrolls rings into rows.</li>
      <li><b>Render → Clouds</b> fills with soft clouds from the main to the sub colour, for skies and textures.</li>
    </ul>
    <h4>For line art</h4>
    <ul>
      <li><b>Change color to main color</b> recolours a layer's lines in one step, keeping their soft edges.</li>
      <li><b>Brightness to opacity</b> makes white see-through: a scanned pencil drawing becomes lines on a clear layer.</li>
      <li><b>Extract lines</b> keeps only lines darker than their surroundings, for a photo of a sketch. Set
      <b>Line width</b> to at least your thickest line.</li>
      <li><b>Dust cleaner</b> removes specks smaller than the size you set, such as dust on a scan.</li>
      <li><b>Find edges</b> draws dark lines wherever the picture changes, like a quick outline of a photo.</li>
      <li><b>Main color to transparency</b> takes the main colour out of the layer: set it to the paper colour of a
      scan and the paper becomes see-through, keeping soft edges.</li>
    </ul>
    <figure data-pic="whitealpha"></figure>
    <p class="tip"><kbd>Ctrl+F</kbd> repeats the last filter with the same settings. Filters work on a mask too, while
    you paint on it (blur a mask for a soft edge).</p>`],

  ['rulers', 'Rulers, perspective and symmetry', `
    <p class="lead">Rulers help you draw straight lines, perspective and mirrored drawings by hand.</p>
    <h4>Perspective</h4>
    <figure data-pic="perspective"></figure>
    <ol>
      <li>Choose the <b>Ruler</b> tool (<kbd>U</kbd> twice) and add a 1-, 2- or 3-point perspective ruler.</li>
      <li>Drag its points to match your scene.</li>
      <li>With <b>snapping</b> on (<kbd>Ctrl+2</kbd>, or the magnet at the bottom), each stroke follows the
      perspective line closest to the way you draw.</li>
    </ol>
    <h4>Symmetry</h4>
    <figure data-pic="symmetry"></figure>
    <p>View → Rulers and symmetry → <b>Symmetry settings…</b> mirrors everything you draw (left–right, top–bottom or four ways), or repeats
    it round a centre for flowers and mandalas. Drag the round centre with the Ruler tool.</p>
    <h4>Guides, lines and the grid</h4>
    <ul>
      <li><b>Edge rulers</b> (View menu): drag out of them to add a guide; drag it back to remove it.</li>
      <li>The Ruler tool also makes <b>straight-line</b> rulers, <b>concentric</b> rulers (strokes go round in
      circles or ellipses) and <b>curve</b> rulers: pick Curve in its settings and draw the curve freehand; it is
      smoothed, and strokes started on it follow it. Drag their handles (for a curve: its points, or the round one to
      move it all) to change them; <kbd>Del</kbd> removes one.</li>
      <li><b>Grid</b> <kbd>Ctrl+'</kbd>. In View → Grid settings… tick Snap so lines, shapes and selections follow it.</li>
    </ul>`],

  ['canvas', 'Canvas size, cropping and turning', `
    <figure data-pic="canvassize"></figure>
    <ul>
      <li>Image → <b>Canvas size</b> adds or removes space round the picture without stretching it.</li>
      <li>Image → <b>Image size</b> makes the whole picture bigger or smaller. Its <b>Resolution (dpi)</b> sets how
      big the picture prints, without changing any pixels; exported PNG, JPEG and BMP files carry it. Hover over the
      size at the bottom right to see the print size.</li>
      <li>The <b>Crop</b> tool <kbd>C</kbd>: drag the edges of the box, then press <kbd>Enter</kbd>.</li>
      <li>Image → <b>Crop to selection</b> crops in one step; <b>Trim to content</b> cuts away empty space round your
      drawing.</li>
      <li>The Image menu also turns the canvas by 90° or 180°, and flips it.</li>
    </ul>
    <p class="tip">Guides, rulers and symmetry move along when the canvas changes.</p>`],

  ['view', 'Zoom, view and undo', `
    <ul>
      <li><b>Zoom</b>: scroll the mouse wheel. <kbd>Ctrl+0</kbd> fits the picture in the window, <kbd>Ctrl+1</kbd>
      shows it at 100%, <kbd>Ctrl+Alt+0</kbd> zooms in on the selection. Hold <kbd>Ctrl+Space</kbd> and drag right to zoom in where you started, left to zoom out.</li>
      <li><b>Move around</b>: hold <kbd>Space</kbd> and drag, or use the Hand <kbd>H</kbd>.</li>
      <li><b>Turn</b>: <kbd>Shift</kbd>+scroll, or <kbd>4</kbd> and <kbd>6</kbd>. <kbd>5</kbd> straightens it.
      Hold <kbd>Shift+Space</kbd> and drag round the middle of the window to turn it freely.</li>
      <li><b>Mirror</b> <kbd>Shift+M</kbd>: a quick way to spot mistakes in your drawing.</li>
      <li>On a <b>touch screen</b>: pinch with two fingers to zoom, twist them to turn the canvas and drag them to move
      it. Tap with two fingers to undo, with three to redo. One finger draws; your palm is ignored while the pen draws.</li>
      <li>The <b>shortcut strip</b> next to the canvas is for a pen tablet without a keyboard: undo, redo, smaller and
      bigger brush, swap colours and fit to window. Keep a finger on the eyedropper button to pick colours with the pen,
      or on the hand to move the view with it, just like holding <kbd>Alt</kbd> or <kbd>Space</kbd>. It shows once you
      have used a pen or touch screen; Settings → <b>Shortcut strip</b> hides it, puts it on the left, right or bottom, or folds it up. Choose <b>Floating</b> to drag it by its dotted grip to
      anywhere over the canvas; it stays where you put it
      (also the little arrow at its top).</li>
      <li><b>Tile preview</b> (View menu) repeats the picture all round itself on screen, to check that a pattern joins up
      without seams (Filter → Effects → Offset moves the seams into the middle to paint over them).</li>
      <li><b>Pixel grid</b> (View menu, on at first) draws lines between the pixels from 800% zoom, for pixel art.</li>
      <li><b>Grayscale view</b> (View menu) shows the canvas in grays, to check that light and dark read well. Your
      colours stay; click the "Grayscale view" label at the top to turn it off.</li>
      <li>The <b>Navigator</b> shows the whole picture: click or drag in it to jump there.</li>
      <li><b>Hide panels</b> <kbd>Tab</kbd>: the tool bar and side panels go away so the canvas fills the window.
      Shortcuts still work. Press <kbd>Tab</kbd> again to bring them back.</li>
      <li><b>Theme</b> (Settings menu, also on the start screen) changes the colours of the app itself:
      Midnight, Dusty rose, Lavender dusk, Moss, Deep sea, Cocoa or Ink black. Your artwork does not change.</li>
    </ul>
    <h4>Your own shortcuts</h4>
    <ol>
      <li>Settings → <b>Keyboard shortcuts…</b> (also on the start screen)</li>
      <li>Click <b>Change</b> next to a tool or command (type in the box at the top to find it).</li>
      <li>Press the key or combination you want, then <b>Save</b>.</li>
    </ol>
    <p class="tip">A key you take from another command is removed there, and the menus show your keys. Tools may
    share a key: pressing it again switches between them, as <kbd>G</kbd> does for Fill and Gradient.</p>
    <h4>Undo</h4>
    <p><kbd>Ctrl+Z</kbd> undoes, <kbd>Ctrl+Y</kbd> redoes. The <b>History</b> panel lists every step: click one to
    jump back to it, or click a grayed-out step to redo up to it.</p>`],

  ['actions', 'Auto actions', `
    <p class="lead">Do the same few steps often? Record them once and play them with one click.</p>
    <ol>
      <li>Open View → <b>Auto actions</b>.</li>
      <li>Press <b>New</b>, give the action a name, and recording starts.</li>
      <li>Do the steps: menu items (with the values you type in their dialogs), shortcut commands, and the Layers
      panel (new layer, blending, opacity, clip, labels, Layer color, Expression color).</li>
      <li>Press <b>Stop</b>.</li>
      <li>Press <b>▶</b> next to the action, or double-click its name, to do it all again.</li>
    </ol>
    <ul>
      <li><b>▸</b> shows the steps. <b>✕</b> removes one; tick <b>dialog</b> on a step to see its dialog on playback and
      change the values.</li>
      <li><b>Record</b> adds more steps to the selected action. <b>⋯</b> renames, copies, moves or deletes it.</li>
      <li>Actions come in sets (the list at the top). The <b>Basic</b> set has ready-made ones, such as a clipped
      Multiply shading layer.</li>
    </ul>
    <p class="tip">Painting is not recorded, only commands and settings. If a step cannot run (say there is no layer
    below to merge into), playing stops there and tells you which step.</p>`],

  ['files', 'Saving, versions and exporting', `
    <ul>
      <li>Artwork saves by itself in <b>Pictures\\KoeStudio</b>.</li>
      <li><b>Earlier versions</b>: every 10 minutes a copy is kept (the newest five). Open one from File → Earlier
      versions… or a gallery card's ⋯ menu. It opens as a copy, so nothing is lost.</li>
      <li>Deleted something by mistake? Press <b>Deleted</b> at the top of the gallery to put it back.</li>
    </ul>
    <figure data-pic="versions"></figure>
    <h4>Sharing your picture</h4>
    <ul>
      <li><b>File → Export…</b> <kbd>Ctrl+Alt+Shift+S</kbd>: save as PNG, JPEG, WebP, GIF, TGA or BMP, at any size, in
      any folder.</li>
      <li><kbd>Ctrl+Shift+S</kbd> saves a PNG straight away, in the same folder as last time.</li>
      <li><b>File → Save project file (.koe)…</b> keeps all the layers, to move to another computer or keep as a backup.</li>
    </ul>
    <p>File → <b>Export layers</b> saves every layer (or every top-level layer and folder) as its own transparent PNG,
    each the size of the canvas, for other programs and game engines.</p>
    <h4>Timelapse</h4>
    <ol>
      <li>Turn on File → Timelapse → <b>Record timelapse</b>. Each time the artwork saves, a small picture of it is kept,
      and a red <b>Recording timelapse</b> mark shows at the top (click it to pause).</li>
      <li>Draw as usual. Recording stays on for this artwork until you turn it off.</li>
      <li>File → Timelapse → <b>Export timelapse…</b> makes a WebM video of it. Choose how fast it plays and how long it may be:
      a long recording skips pictures evenly to fit.</li>
    </ol>
    <p class="tip">The video ends by showing the finished picture for two seconds. File → Timelapse → Discard timelapse… throws a
    recording away to start again.</p>`],
];

/** Shortcuts other than the tool keys (those come from TOOLS): [group, [[keys, what], ...]]. */
export const SHORTCUTS = [
  ['Painting', [['Hold a tool key', 'Use that tool until you let go'], ['[ / ]', 'Smaller / bigger brush'], ['Ctrl+Alt+drag', 'Set the brush size on the canvas'], ['X', 'Swap main and sub colour'], ['Alt (hold)', 'Pick a colour'],
    ['Shift+click', 'Straight line from the last stroke']]],
  ['Edit', [['Ctrl+Z / Ctrl+Y', 'Undo / redo'], ['Ctrl+C / Ctrl+X / Ctrl+V', 'Copy / cut / paste'], ['Ctrl+T', 'Transform'],
    ['Del', 'Clear the selection or layer'], ['Alt+Del / Shift+Alt+Del', 'Fill the selection or layer with the main / sub colour'], ['Ctrl+F', 'Repeat the last filter']]],
  ['Selection', [['Ctrl+A / Ctrl+D', 'Select all / deselect'], ['Ctrl+Shift+I', 'Invert the selection'], ['Ctrl+Shift+D', 'Reselect (bring back the last selection)'], ['Q', 'Quick mask'],
    ['Shift / Alt (while dragging)', 'Add to / subtract from the selection'], ['Ctrl+click a layer thumbnail', 'Select its pixels (+Shift add, +Alt subtract)']]],
  ['Layers', [['Ctrl+click (Move tool)', 'Pick the layer under the pointer'], ['Arrows / Shift+arrows (Move tool)', 'Move the layer or selection 1 / 10 px'], ['Ctrl+Shift+N', 'New layer'], ['Ctrl+G', 'Put in a new folder'], ['Ctrl+E', 'Merge down (or merge folder)'],
    ['Ctrl+Shift+Alt+E', 'Merge visible to a new layer'], ['Ctrl+J / Ctrl+Shift+J', 'Copy / cut to a new layer'], ['F2', 'Rename the layer'],
    ['Alt+] / Alt+[', 'Select the layer above / below'],
    ['Ctrl+click / Shift+click', 'Pick several layers'], ['Alt+click an eye', 'Show only that layer (again: the others come back)']]],
  ['Touch screen', [['Two fingers: pinch / twist / drag', 'Zoom / turn / move the view'], ['Two-finger tap', 'Undo'], ['Three-finger tap', 'Redo']]],
  ['View', [['Space (hold)', 'Move the view'], ['Shift+Space+drag', 'Turn the view'], ['Ctrl+Space+drag', 'Zoom in (right) / out (left)'], ['Ctrl+0 / Ctrl+1', 'Fit / 100%'], ['Ctrl+Alt+0', 'Zoom to the selection'], ['Ctrl+= / Ctrl+-', 'Zoom in / out'],
    ['4 / 6 / 5', 'Turn left / right / straighten'], ['Shift+M', 'Mirror the view'], ["Ctrl+'", 'Show the grid'], ['Tab', 'Hide / show the panels'],
    ['Ctrl+2 / Ctrl+;', 'Snap to rulers / show guides']]],
  ['File and program', [['Ctrl+S', 'Save now'], ['Ctrl+Shift+S', 'Export a PNG'], ['Ctrl+Alt+Shift+S', 'Export…'],
    ['Ctrl+Alt+C / Ctrl+Alt+I', 'Canvas size / image size'], ['F1', 'This guide'], ['F5 / Ctrl+R', 'Reload the screen'],
    ['Arrow keys (in a menu)', 'Move through the menus; → opens a smaller menu, Esc closes']]],
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
