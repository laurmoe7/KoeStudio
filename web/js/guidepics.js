// Pictures for the guide (Help → Guide): small SVG diagrams, drawn as data so they need no image files and follow
// the theme (classes styled under `.gp` in app.css). A guide page shows one with <figure data-pic="name">, its
// <figcaption> under it. Keep them simple: a few shapes and short labels, the way you would sketch it for a friend.

const svg = (w, h, body, label) => `<svg class="gp" viewBox="0 0 ${w} ${h}" role="img" aria-label="${label}">${body}</svg>`;
/** A label; a = 'start' | 'middle' | 'end'. */
const t = (x, y, s, a = 'middle', cls = '') => `<text x="${x}" y="${y}" text-anchor="${a}"${cls ? ` class="${cls}"` : ''}>${s}</text>`;
/** A white sheet of paper as a panel background. */
const paper = (x, y, w, h) => `<rect class="paper" x="${x}" y="${y}" width="${w}" height="${h}" rx="4"/>`;
/** An arrow from (x1, y1) to (x2, y2). */
const arrow = (x1, y1, x2, y2, cls = 'arrow') => {
  const a = Math.atan2(y2 - y1, x2 - x1), k = 7;
  const p = (da) => `${x2 - k * Math.cos(a + da)},${y2 - k * Math.sin(a + da)}`;
  return `<path class="${cls}" d="M${x1},${y1} L${x2},${y2} M${p(0.5)} L${x2},${y2} L${p(-0.5)}"/>`;
};
/** A dashed "marching ants" outline. */
const ants = d => `<path class="ants" d="${d}"/>`;

/** A round cat face (head and ears) centred on cx, cy, for the walkthrough. */
const face = (cx, cy) => `M${cx - 24},${cy} a24,24 0 1,0 48,0 a24,24 0 1,0 -48,0 M${cx - 21},${cy - 12} L${cx - 17},${cy - 32} L${cx - 5},${cy - 23} M${cx + 21},${cy - 12} L${cx + 17},${cy - 32} L${cx + 5},${cy - 23}`;
const head = (cx, cy) => `M${cx - 24},${cy} a24,24 0 1,0 48,0 a24,24 0 1,0 -48,0`;
/** A checkerboard (see-through) area. */
const checker = (x, y, w, h) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="4" fill="url(#gp-check)"/>`;

export const PICS = {
  // ---------- Your first picture: the steps ----------
  workflow: svg(460, 124, `
    <defs><clipPath id="gp-wf-clip"><path d="${head(320, 50)}"/></clipPath><clipPath id="gp-wf-clip2"><path d="${head(412, 50)}"/></clipPath></defs>
    ${[0, 1, 2, 3, 4].map(i => paper(4 + i * 92, 4, 80, 88)).join('')}
    <path class="sketch" d="${face(44, 50)}"/><path class="sketch" d="${face(46, 52)}"/>
    <path class="ink thin" d="${face(136, 50)}"/>
    <path class="flat" d="${head(228, 50)}"/><path class="ink thin" d="${face(228, 50)}"/>
    <path class="flat" d="${head(320, 50)}"/><circle cx="334" cy="62" r="26" class="shade" clip-path="url(#gp-wf-clip)"/><path class="ink thin" d="${face(320, 50)}"/>
    <path class="flat" d="${head(412, 50)}"/><circle cx="426" cy="62" r="26" class="shade" clip-path="url(#gp-wf-clip2)"/><path class="ink thin" d="${face(412, 50)}"/>
    <circle cx="404" cy="46" r="2.5" class="dot-dark"/><circle cx="420" cy="46" r="2.5" class="dot-dark"/>
    ${[0, 1, 2, 3].map(i => arrow(86 + i * 92, 48, 94 + i * 92, 48, 'arrow thin')).join('')}
    ${[['1 Sketch', 44], ['2 Lines', 136], ['3 Colours', 228], ['4 Shading', 320], ['5 Export', 412]].map(([l, x]) => t(x, 112, l)).join('')}
  `, 'The steps of a picture: sketch, line art, flat colours, shading, export'),

  // ---------- Getting started: the screen ----------
  screen: svg(460, 214, `
    <rect class="frame" x="1" y="1" width="458" height="212" rx="6"/>
    <rect class="bar" x="1" y="1" width="458" height="20" rx="6"/>
    ${t(12, 15, 'File  Edit  Image  Select  Layer  Filter  View  Help', 'start', 'small')}
    <rect class="panel" x="6" y="26" width="22" height="182" rx="3"/>
    ${[0, 1, 2, 3, 4, 5, 6, 7].map(i => `<rect class="icon" x="11" y="${33 + i * 21}" width="12" height="12" rx="2"/>`).join('')}
    <rect class="panel" x="32" y="26" width="92" height="106" rx="3"/>
    ${[0, 1, 2, 3].map(i => `<rect class="icon" x="38" y="${48 + i * 18}" width="22" height="4" rx="2"/><rect class="slider" x="64" y="${48 + i * 18}" width="54" height="4" rx="2"/>`).join('')}
    <rect class="panel" x="32" y="136" width="92" height="72" rx="3"/>
    <rect class="canvasbg" x="128" y="26" width="208" height="182" rx="3"/>
    ${paper(150, 48, 164, 136)}
    <path class="ink" d="M175,150 C200,90 230,160 260,100 S290,90 295,120"/>
    <rect class="panel" x="340" y="26" width="114" height="92" rx="3"/>
    <rect x="348" y="34" width="70" height="60" rx="2" class="hue"/>
    <rect class="panel" x="340" y="122" width="114" height="86" rx="3"/>
    ${[0, 1, 2].map(i => `<rect class="icon" x="348" y="${132 + i * 22}" width="98" height="17" rx="2"/>`).join('')}
    ${[[17, 120, '1'], [78, 34, '2'], [78, 172, '3'], [232, 196, '4'], [397, 105, '5'], [397, 200, '6']].map(([x, y, n]) =>
      `<circle class="badge" cx="${x}" cy="${y}" r="9"/>${t(x, y + 4, n, 'middle', 'badge-text')}`).join('')}
  `, 'The editor: tool bar, tool settings, history, canvas, colours and layers'),

  // ---------- Drawing: opacity, density, hardness ----------
  strokes: svg(460, 150, `
    ${paper(4, 4, 144, 112)}${paper(158, 4, 144, 112)}${paper(312, 4, 144, 112)}
    <path d="M24,90 C50,20 80,20 76,60 S40,100 128,40" class="wide" stroke-opacity="0.45"/>
    ${Array.from({ length: 18 }, (_, i) => { const x = 180 + i * 6, y = 62 - Math.sin(i / 3) * 26; return `<circle cx="${x}" cy="${y}" r="13" class="dab"/>`; }).join('')}
    <circle cx="350" cy="60" r="28" class="hard"/>
    <circle cx="418" cy="60" r="32" fill="url(#gp-soft)"/>
    <defs><radialGradient id="gp-soft"><stop offset="0" stop-color="#1b1b1f"/><stop offset="0.45" stop-color="#1b1b1f" stop-opacity="0.7"/><stop offset="1" stop-color="#1b1b1f" stop-opacity="0"/></radialGradient></defs>
    ${t(76, 136, 'Opacity: even, never darker')}${t(230, 136, 'Density: builds up')}${t(384, 136, 'Hardness: hard / soft')}
  `, 'Opacity keeps a stroke even; density builds up where dabs overlap; hardness gives a crisp or soft edge'),

  stabilize: svg(460, 120, `
    ${paper(4, 4, 220, 92)}${paper(236, 4, 220, 92)}
    <path class="ink" d="M20,70 l8,-6 l6,4 l7,-9 l6,3 l8,-10 l5,5 l9,-8 l6,2 l8,-9 l7,4 l8,-6 l9,3 l7,-5 l8,4 l9,-4 l7,3 l8,-2 l9,4 l8,-1 l9,5 l8,0 l9,6"/>
    <path class="ink" d="M252,70 C300,30 360,20 440,44"/>
    ${t(114, 114, 'Stabilization 0: every wobble shows')}${t(346, 114, 'Stabilization 8: smooth line')}
  `, 'A shaky line without stabilization and a smooth one with it'),

  taper: svg(460, 120, `
    ${paper(4, 4, 452, 92)}
    <path class="solid" d="M30,60 C120,20 200,22 260,40 S380,70 430,46 C380,74 300,58 255,52 S120,40 30,60 Z"/>
    ${arrow(40, 84, 110, 84)}${arrow(420, 84, 350, 84)}
    ${t(76, 114, 'Start taper')}${t(384, 114, 'End taper')}${t(230, 114, 'full size in the middle')}
  `, 'A stroke that starts and ends thin'),

  // ---------- Colour ----------
  color: svg(460, 150, `
    <defs>
      <linearGradient id="gp-sv-w"><stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>
      <linearGradient id="gp-sv-b" x2="0" y2="1"><stop offset="0" stop-opacity="0"/><stop offset="1" stop-color="#000"/></linearGradient>
      <linearGradient id="gp-hue" x2="0" y2="1">${[0, 60, 120, 180, 240, 300, 360].map((h, i) => `<stop offset="${i / 6}" stop-color="hsl(${h},100%,50%)"/>`).join('')}</linearGradient>
    </defs>
    <rect x="10" y="8" width="110" height="110" fill="hsl(200,100%,50%)" rx="3"/>
    <rect x="10" y="8" width="110" height="110" fill="url(#gp-sv-w)" rx="3"/>
    <rect x="10" y="8" width="110" height="110" fill="url(#gp-sv-b)" rx="3"/>
    <circle cx="88" cy="40" r="6" class="ring"/>
    <rect x="132" y="8" width="12" height="110" fill="url(#gp-hue)" rx="2"/>
    <rect x="130" y="62" width="16" height="4" class="ring"/>
    ${t(65, 138, 'Light and strong')}${t(152, 68, '← Hue', 'start')}
    <rect x="270" y="46" width="40" height="40" class="swatch" fill="#ffffff"/>
    <rect x="250" y="28" width="40" height="40" class="swatch" fill="#1f8fd1"/>
    <path class="leader" d="M250,40 H238 M310,78 H322"/>
    ${t(232, 44, 'Main', 'end')}${t(328, 82, 'Sub', 'start')}
    ${t(280, 112, 'You paint with the main colour')}${t(280, 130, 'X swaps them', 'middle', 'small')}
  `, 'The colour square, the hue bar and the main and sub colours'),

  // ---------- Fill ----------
  gaps: svg(460, 150, `
    ${paper(4, 4, 218, 118)}${paper(238, 4, 218, 118)}
    <rect x="4" y="4" width="218" height="118" rx="4" class="fill-leak"/>
    <path class="ink" d="M154.35,47.95 A44,44 0 1,1 146.71,34.72"/>
    <circle cx="347" cy="63" r="44" class="fill-ok"/>
    <path class="ink" d="M388.35,47.95 A44,44 0 1,1 380.71,34.72"/>
    ${t(113, 142, 'Close gaps 0: the fill leaks out')}${t(347, 142, 'Close gaps on: it stays inside')}
  `, 'A circle with a small gap: without Close gaps the fill runs out, with it the fill stays inside'),

  colorize: svg(460, 140, `
    ${paper(4, 4, 196, 112)}${paper(260, 4, 196, 112)}
    <circle cx="324" cy="60" r="34" fill="#f2c9a0"/><rect x="368" y="28" width="66" height="64" rx="8" fill="#3e8fe0"/>
    <path d="M58,58 q6,-8 12,0 q6,8 12,0" fill="none" stroke="#f2c9a0" stroke-width="6" stroke-linecap="round"/>
    <path d="M128,56 l20,6" fill="none" stroke="#3e8fe0" stroke-width="6" stroke-linecap="round"/>
    <circle cx="68" cy="60" r="34" class="ink"/><rect x="112" y="28" width="66" height="64" rx="8" class="ink"/>
    <circle cx="324" cy="60" r="34" class="ink"/><rect x="368" y="28" width="66" height="64" rx="8" class="ink"/>
    ${arrow(210, 60, 250, 60)}
    ${t(102, 134, 'A few scribbles under the lines')}${t(358, 134, 'Colorize fills each shape')}
  `, 'Two shapes of line art with a scribble of colour in each, and the same shapes filled with those colours'),

  pattern: svg(460, 120, `
    <defs><pattern id="gp-pat-stripes" width="14" height="14" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="7" height="14" fill="#f08c2e"/></pattern>
      <mask id="gp-pat-strokes"><path d="M30,40 C90,10 150,70 210,40 M120,14 L130,84" fill="none" stroke="#fff" stroke-width="22" stroke-linecap="round"/></mask></defs>
    ${paper(4, 4, 220, 92)}${paper(236, 4, 220, 92)}
    <rect x="4" y="4" width="220" height="92" fill="url(#gp-pat-stripes)" mask="url(#gp-pat-strokes)"/>
    <rect x="236" y="4" width="220" height="92" rx="4" fill="url(#gp-pat-stripes)"/>
    ${t(114, 114, 'Pattern brush: strokes line up')}${t(346, 114, 'Fill layer: the whole canvas')}
  `, 'Two crossing pattern brush strokes whose stripes line up, and a fill layer covered with the same stripes'),

  gradient: svg(460, 110, `
    <defs><linearGradient id="gp-grad"><stop offset="0" stop-color="#3e8fe0"/><stop offset="1" stop-color="#ffffff"/></linearGradient>
    <linearGradient id="gp-grad-r" spreadMethod="reflect" x2="0.25"><stop offset="0" stop-color="#e5484d"/><stop offset="1" stop-color="#e6c84a"/></linearGradient></defs>
    <rect x="4" y="4" width="218" height="80" rx="4" fill="url(#gp-grad)"/>
    ${arrow(30, 44, 196, 44, 'arrow dark')}<circle cx="30" cy="44" r="4" class="dot-dark"/>
    <rect x="238" y="4" width="218" height="80" rx="4" fill="url(#gp-grad-r)"/>
    ${t(113, 104, 'Drag from where it starts to where it ends')}${t(347, 104, 'Mirror: back and forth, as stripes')}
  `, 'A gradient follows the line you drag; Mirror repeats it back and forth'),

  // ---------- Figures ----------
  polygon: svg(460, 130, `
    ${paper(4, 4, 452, 100)}
    <path class="ink" d="M60,84 L130,24 L230,40 L260,88 Z"/>
    ${[[60, 84, 1], [130, 24, 2], [230, 40, 3], [260, 88, 4]].map(([x, y, n]) => `<circle cx="${x}" cy="${y}" r="9" class="badge"/>${t(x, y + 4, n, 'middle', 'badge-text')}`).join('')}
    <path class="ink" d="M300,80 C320,20 360,20 380,56 S430,90 440,30"/>
    ${[[300, 80], [348, 28], [392, 66], [440, 30]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="5" class="dot"/>`).join('')}
    ${t(160, 124, 'Polygon: click each corner')}${t(370, 124, 'Curve: runs through your clicks')}
  `, 'A polygon clicked corner by corner, and a curve through the points you click'),

  // ---------- Selections ----------
  selmodes: svg(460, 130, `
    ${paper(4, 4, 144, 100)}${paper(158, 4, 144, 100)}${paper(312, 4, 144, 100)}
    <g class="sel"><rect x="24" y="22" width="64" height="56"/><rect x="62" y="44" width="64" height="48"/></g>
    ${ants('M24,22 H88 V44 H126 V92 H62 V78 H24 Z')}
    <rect x="178" y="22" width="64" height="56" class="sel"/><rect x="216" y="44" width="64" height="48" class="paper-patch"/>
    ${ants('M178,22 H242 V44 H216 V78 H178 Z')}<rect x="216" y="44" width="64" height="48" class="ghost"/>
    <rect x="370" y="44" width="26" height="34" class="sel"/>${ants('M370,44 H396 V78 H370 Z')}
    <rect x="332" y="22" width="64" height="56" class="ghost"/><rect x="370" y="44" width="64" height="48" class="ghost"/>
    ${t(76, 124, 'Shift: add')}${t(230, 124, 'Alt: take away')}${t(384, 124, 'Shift+Alt: keep the overlap')}
  `, 'Holding Shift adds to a selection, Alt takes away, Shift and Alt together keep only the overlap'),

  quickmask: svg(460, 120, `
    ${paper(4, 4, 218, 92)}${paper(238, 4, 218, 92)}
    <ellipse cx="113" cy="50" rx="60" ry="30" class="sel"/>${ants('M53,50 a60,30 0 1,0 120,0 a60,30 0 1,0 -120,0')}
    <rect x="238" y="4" width="218" height="92" rx="4" class="qm"/>
    <ellipse cx="347" cy="50" rx="60" ry="30" class="paper-patch"/>
    ${arrow(226, 50, 234, 50)}
    ${t(113, 114, 'A selection…')}${t(347, 114, '…in Quick mask (Q): paint the red to change it')}
  `, 'Quick mask shows everything outside the selection in red, so you can paint the selection'),

  // ---------- Transform ----------
  transform: svg(460, 170, `
    ${paper(4, 4, 452, 112)}
    <path class="solid" d="M230,30 L246,52 L272,54 L254,72 L260,98 L230,86 L200,98 L206,72 L188,54 L214,52 Z"/>
    <rect x="182" y="24" width="96" height="80" class="box"/>
    ${[[182, 24], [230, 24], [278, 24], [278, 64], [278, 104], [230, 104], [182, 104], [182, 64]].map(([x, y]) => `<rect x="${x - 4}" y="${y - 4}" width="8" height="8" class="handle"/>`).join('')}
    <path class="arrow" d="M312,30 A44,44 0 0,1 322,92"/>${arrow(322, 86, 322, 96)}
    ${arrow(120, 104, 174, 104)}${arrow(230, 128, 230, 92)}${arrow(380, 128, 340, 64)}
    ${t(110, 136, 'Handle: resize')}${t(230, 144, 'Inside: move')}${t(380, 144, 'Outside: turn')}
    ${t(230, 164, 'Enter: done · Esc: cancel', 'middle', 'small')}
  `, 'The transform box: handles resize, inside moves, outside turns'),

  // ---------- Layers ----------
  layers: svg(460, 170, `
    <path class="sheet" d="M40,120 L160,120 L200,96 L80,96 Z"/>
    <path class="sheet" d="M40,90 L160,90 L200,66 L80,66 Z"/><ellipse cx="120" cy="78" rx="26" ry="7" fill="#f08c2e" opacity=".85"/>
    <path class="sheet" d="M40,60 L160,60 L200,36 L80,36 Z"/><ellipse cx="120" cy="48" rx="28" ry="8" class="ink thin"/>
    ${t(210, 52, 'Line art', 'start')}${t(210, 82, 'Colours', 'start')}${t(210, 112, 'Background', 'start')}
    ${arrow(290, 80, 330, 80)}
    ${paper(340, 30, 110, 100)}<circle cx="395" cy="80" r="30" fill="#f08c2e" opacity=".85"/><circle cx="395" cy="80" r="32" class="ink thin"/>
    ${t(395, 150, 'What you see')}${t(120, 150, 'Each layer is its own sheet')}
  `, 'Layers stacked like sheets: line art on top, colours under it, the background at the bottom'),

  clip: svg(460, 130, `
    ${paper(4, 4, 140, 100)}${paper(160, 4, 140, 100)}${paper(316, 4, 140, 100)}
    <circle cx="74" cy="54" r="34" fill="#3e8fe0"/>
    <rect x="164" y="4" width="132" height="100" fill="url(#gp-stripes)"/>
    <defs><pattern id="gp-stripes" width="14" height="14" patternUnits="userSpaceOnUse" patternTransform="rotate(35)"><rect width="7" height="14" fill="#1b1b1f" opacity=".35"/></pattern>
    <clipPath id="gp-clipc"><circle cx="386" cy="54" r="34"/></clipPath></defs>
    <circle cx="386" cy="54" r="34" fill="#3e8fe0"/><rect x="316" y="4" width="140" height="100" fill="url(#gp-stripes)" clip-path="url(#gp-clipc)"/>
    ${t(74, 124, 'Layer below')}${t(230, 124, 'Shading, Clip below on')}${t(386, 124, 'Shading stays inside')}
  `, 'Clip below keeps a layer inside the paint of the layer under it'),

  effects: svg(460, 130, `
    <defs><filter id="gp-blur" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="3"/></filter></defs>
    ${paper(4, 4, 218, 100)}${paper(238, 4, 218, 100)}
    <rect x="4" y="4" width="218" height="100" rx="4" fill="#9bd1ff"/>
    <text x="113" y="72" class="big">KOE</text>
    <rect x="238" y="4" width="218" height="100" rx="4" fill="#9bd1ff"/>
    <text x="353" y="78" class="big shadow" filter="url(#gp-blur)">KOE</text>
    <text x="347" y="72" class="big border">KOE</text>
    <text x="347" y="72" class="big">KOE</text>
    ${t(113, 124, 'A layer as it is')}${t(347, 124, 'With Border and Drop shadow')}
  `, 'Lettering before and after a white border and a drop shadow'),

  // ---------- Text along a path, letter gap, warp ----------
  textshape: svg(460, 130, `
    <defs><path id="gp-tp" d="M18,82 C60,20 110,20 150,60 S200,100 214,50"/><path id="gp-arch" d="M280,76 Q347,-4 414,76"/></defs>
    ${paper(4, 4, 218, 100)}${paper(238, 4, 218, 100)}
    <path class="leader" stroke-dasharray="4 3" d="M18,82 C60,20 110,20 150,60 S200,100 214,50"/>
    <text class="dark" style="font-size:15px"><textPath href="#gp-tp">Text along the line</textPath></text>
    <text class="dark" style="font-size:22px;font-weight:700"><textPath href="#gp-arch" startOffset="50%" text-anchor="middle">ARCH</textPath></text>
    <text x="347" y="92" class="dark" style="font-size:15px;letter-spacing:6px" text-anchor="middle">gap</text>
    ${t(113, 124, 'Drag with the Text tool')}${t(347, 124, 'Warp, and a wider letter gap')}
  `, 'Text following a drawn line; arched text and text with wider letter spacing'),

  // ---------- Radial menu ----------
  radial: svg(460, 150, `
    ${paper(4, 4, 452, 120)}
    <circle cx="230" cy="64" r="58" fill="#3a3b45"/>
    ${[0, 1, 2, 3, 4, 5, 6, 7].map(i => { const a = i * Math.PI / 4, x = 230 + 40 * Math.sin(a), y = 64 - 40 * Math.cos(a);
      return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="13" fill="${i === 2 ? '#3e8fe0' : '#8a8b98'}"/>`; }).join('')}
    <circle cx="230" cy="64" r="12" fill="#1b1b1f" stroke="#fff" stroke-width="2"/>
    ${arrow(236, 70, 262, 66, 'arrow thin')}
    ${t(120, 60, 'Right-click', 'end', 'dark')}${t(120, 76, 'the canvas', 'end', 'dark')}
    ${t(296, 60, 'Move onto one', 'start', 'dark')}${t(296, 76, 'and let go', 'start', 'dark')}
    ${t(230, 144, 'Eight tools or commands round the pointer')}
  `, 'The radial menu: eight round buttons in a ring around the pointer'),

  // ---------- Correction layers ----------
  adjust: svg(460, 140, `
    <defs><clipPath id="gp-adj1"><rect x="4" y="4" width="136" height="100" rx="4"/></clipPath><clipPath id="gp-adj2"><rect x="320" y="4" width="136" height="100" rx="4"/></clipPath></defs>
    <g clip-path="url(#gp-adj1)"><rect x="4" y="4" width="136" height="100" fill="#78b4ea"/><circle cx="108" cy="30" r="13" fill="#ffe11f"/>
      <path d="M4,104 L4,74 Q50,44 96,70 T140,66 L140,104 Z" fill="#46a758"/></g>
    <g clip-path="url(#gp-adj2)"><rect x="320" y="4" width="136" height="100" fill="#f2784b"/><circle cx="424" cy="30" r="13" fill="#fff3b0"/>
      <path d="M320,104 L320,74 Q366,44 412,70 T456,66 L456,104 Z" fill="#7b2c8f"/></g>
    <rect class="panel" x="164" y="18" width="132" height="34" rx="3"/><rect class="panel" x="164" y="56" width="132" height="34" rx="3"/>
    <circle cx="182" cy="35" r="9" fill="#f2f2f2"/><path d="M182,26 A9,9 0 0,0 182,44 Z" fill="#222"/>
    <rect x="173" y="64" width="18" height="18" fill="#78b4ea"/><rect x="173" y="76" width="18" height="6" fill="#46a758"/>
    ${t(198, 39, 'Hue/Saturation', 'start')}${t(198, 77, 'Your picture', 'start')}
    ${arrow(144, 54, 160, 54)}${arrow(300, 54, 316, 54)}
    ${t(72, 124, 'Before')}${t(230, 124, 'A correction layer on top')}${t(388, 124, 'Everything below changes')}
  `, 'A Hue/Saturation correction layer above a picture changes its colours without changing the picture'),

  // ---------- Masks ----------
  mask: svg(460, 130, `
    ${paper(4, 4, 136, 100)}${paper(162, 4, 136, 100)}${paper(320, 4, 136, 100)}
    <rect x="24" y="20" width="96" height="68" fill="#46a758"/>
    <rect x="182" y="20" width="96" height="68" class="ghost"/><circle cx="230" cy="54" r="24" fill="#1b1b1f"/>
    <rect x="340" y="20" width="96" height="68" fill="#46a758"/><circle cx="388" cy="54" r="24" class="paper-patch"/>
    ${t(151, 62, '+', 'middle', 'sym')}${t(309, 62, '=', 'middle', 'sym')}
    ${t(72, 124, 'The layer')}${t(230, 124, 'Paint on the mask: hides')}${t(388, 124, 'Hidden, not erased')}
  `, 'Painting on a mask hides that part of the layer; erasing the mask shows it again'),

  // ---------- Vector layers ----------
  vector: svg(460, 140, `
    ${paper(4, 4, 144, 104)}${paper(158, 4, 144, 104)}${paper(312, 4, 144, 104)}
    <path class="ghostline" d="M20,30 L130,90 M20,90 L130,30"/>
    <path class="ink" d="M20,30 L60,52 M84,65 L130,90 M20,90 L130,30"/>
    <circle cx="72" cy="58" r="12" class="eraser"/>
    <path class="ghostline" d="M174,30 L284,90"/>
    <path class="ink" d="M174,90 L284,30 M229,60 L284,90"/>
    <circle cx="196" cy="42" r="10" class="eraser"/>
    <path class="ghostline" d="M328,30 L438,90"/>
    <path class="ink" d="M328,90 L438,30"/>
    <circle cx="350" cy="42" r="10" class="eraser"/>
    ${t(76, 128, 'Touched area')}${t(230, 128, 'Up to intersection')}${t(384, 128, 'Whole line')}
  `, 'The three ways the eraser works on vector lines'),

  // ---------- Retouching ----------
  clone: svg(460, 130, `
    ${paper(4, 4, 452, 100)}
    ${[0, 72, 144, 216, 288].map(a => `<ellipse cx="110" cy="40" rx="9" ry="20" fill="#e5484d" transform="rotate(${a} 110 58)"/>`).join('')}<circle cx="110" cy="58" r="8" fill="#e6c84a"/>
    <g opacity=".85">${[0, 72, 144, 216, 288].map(a => `<ellipse cx="330" cy="40" rx="9" ry="20" fill="#e5484d" transform="rotate(${a} 330 58)"/>`).join('')}<circle cx="330" cy="58" r="8" fill="#e6c84a"/></g>
    <circle cx="110" cy="58" r="34" class="cross"/><path class="cross" d="M104,58 H116 M110,52 V64"/>
    <circle cx="330" cy="58" r="34" class="brush"/>
    ${arrow(150, 58, 290, 58)}
    ${t(110, 124, 'Ctrl+click: copy from here')}${t(330, 124, 'Paint: the copy appears here')}
  `, 'The clone stamp copies from where you Ctrl+clicked to where you paint'),

  // ---------- Rulers ----------
  perspective: svg(460, 140, `
    ${paper(4, 4, 452, 110)}
    <path class="guide" d="M4,50 H456"/>
    <circle cx="230" cy="50" r="5" class="vp"/>
    ${[[20, 114], [100, 114], [360, 114], [440, 114], [4, 90], [456, 90], [4, 20], [456, 16]].map(([x, y]) => `<path class="ray" d="M230,50 L${x},${y}"/>`).join('')}
    <path class="ink thin" d="M120,104 L120,60 L180,56 L180,94 Z M180,56 L206,53 M180,94 L206,74 M206,53 L206,74"/>
    ${t(230, 30, 'vanishing point', 'middle', 'dark')}
    ${t(230, 134, 'With snapping on, lines follow the perspective')}
  `, 'A one-point perspective ruler: lines run to the vanishing point on the horizon'),

  symmetry: svg(460, 130, `
    ${paper(4, 4, 218, 100)}${paper(238, 4, 218, 100)}
    <path class="guide" d="M113,8 V100"/>
    <path class="ink" d="M108,26 C80,20 60,40 70,60 S100,90 108,84"/>
    <path class="ink" d="M118,26 C146,20 166,40 156,60 S126,90 118,84"/>
    ${[0, 60, 120, 180, 240, 300].map(a => `<path class="ink thin" d="M347,54 q12,-30 0,-44" transform="rotate(${a} 347 54)"/>`).join('')}
    <circle cx="347" cy="54" r="4" class="vp"/>
    ${t(113, 124, 'Left–right: draw one side')}${t(347, 124, 'Radial, 6 lines')}
  `, 'Symmetry mirrors what you draw, or repeats it round a centre'),
  // ---------- Canvas: canvas size vs image size ----------
  canvassize: svg(460, 150, `
    ${[0, 1, 2].map(i => `<rect class="canvasbg" x="${4 + i * 154}" y="4" width="144" height="112" rx="4"/>`).join('')}
    ${paper(51, 40, 50, 40)}<circle cx="76" cy="60" r="12" fill="#3e8fe0"/>
    ${paper(186, 25, 90, 70)}<circle cx="231" cy="60" r="12" fill="#3e8fe0"/>
    ${paper(340, 25, 90, 70)}<circle cx="385" cy="60" r="21" fill="#3e8fe0"/>
    ${t(76, 136, 'Before')}${t(231, 136, 'Canvas size: more room')}${t(385, 136, 'Image size: all bigger')}
  `, 'Canvas size adds room round the picture; Image size makes everything bigger'),

  // ---------- Filters: brightness to opacity ----------
  whitealpha: svg(460, 130, `
    <defs><pattern id="gp-check" width="16" height="16" patternUnits="userSpaceOnUse"><rect width="16" height="16" fill="#fff"/><rect width="8" height="8" fill="#d9d9de"/><rect x="8" y="8" width="8" height="8" fill="#d9d9de"/></pattern></defs>
    <rect x="4" y="4" width="218" height="100" rx="4" fill="#ece6d6"/>
    ${checker(238, 4, 218, 100)}
    <path class="pencil" d="M70,80 C80,30 140,24 156,52 S120,92 100,70 M60,50 l40,-8 M130,84 c10,-6 30,-4 36,4"/>
    <path class="pencil" d="M304,80 C314,30 374,24 390,52 S354,92 334,70 M294,50 l40,-8 M364,84 c10,-6 30,-4 36,4"/>
    ${arrow(226, 54, 234, 54)}
    ${t(113, 124, 'A scanned pencil drawing')}${t(347, 124, 'Brightness to opacity: the paper is gone')}
  `, 'Brightness to opacity turns the white paper of a scan see-through and keeps the lines'),

  // ---------- Files: earlier versions ----------
  versions: svg(460, 110, `
    <path class="leader" d="M20,46 H440"/>
    ${['10:00', '10:10', '10:20', '10:30', '10:40'].map((time, i) => { const x = 50 + i * 90; return `<path class="doc" d="M${x - 14},${30} h20 l8,8 v24 h-28 z"/>${t(x, 84, time, 'middle', 'small')}`; }).join('')}
    ${t(230, 104, 'While you work, a copy is kept every 10 minutes (the newest five)')}
  `, 'A copy of the artwork every ten minutes, the newest five kept'),
  // ---------- Transform: mesh ----------
  mesh: svg(460, 140, `
    ${paper(4, 4, 218, 110)}${paper(238, 4, 218, 110)}
    ${[0, 1, 2, 3].map(k => `<path class="meshline" d="M${44 + k * 46},14 V104 M44,${14 + k * 30} H182"/>`).join('')}
    ${[0, 1, 2, 3].flatMap(j => [0, 1, 2, 3].map(i => `<circle cx="${44 + i * 46}" cy="${14 + j * 30}" r="3.5" class="meshpt"/>`)).join('')}
    <path class="meshline" d="M278,14 V104 M416,14 V104 M278,14 H416 M278,104 H416"/>
    <path class="meshline" d="M324,14 C326,40 340,52 352,58 S372,88 370,104 M370,14 C372,34 384,48 392,56 S402,90 416,104"/>
    <path class="meshline" d="M278,44 C300,46 330,50 352,58 S400,48 416,44 M278,74 C300,76 330,84 352,88 S400,76 416,74"/>
    <circle cx="352" cy="58" r="5" class="meshpt on"/>
    ${arrow(338, 42, 349, 55)}
    ${t(113, 132, 'Mesh: a grid of points')}${t(347, 132, 'Drag one: the picture bends with it')}
  `, 'Mesh transform: dragging a point of the grid bends the picture smoothly around it'),
};
