// The drawing screen: canvas viewport, tools, tool settings, colour and layer panels, menus and autosave.

import { api } from '../api.js';
import { Smoother, StampPath, stampAt, stampBounds, dabJitter, colorJitter, taperIn, taperOut, releaseHeld, adjustPressure, tiltFrom, dynamicsAt, dynamicsReach, SPEED_FULL } from '../brush.js';
import { tipReach } from '../brushtip.js';
import { hexToRgb, rgbToHex, shiftColor, averageColor } from '../color.js';
import { Doc, Layer, composite, renderFolder, canvasToDataUrl, loadImage, liveSource, docEffectReach, withoutDrafts } from '../doc.js';
import { isFolder } from '../tree.js';
import { floodMask, growMask, closeGapFill, insideLines } from '../fill.js';
import { History } from '../history.js';
import { icon } from '../icons.js';
import { comboOf, isTyping, springBack } from '../keys.js';
import { Painter, textureFor, grainFor, wetFor, impastoFor, heightFor, hasTipImage, tipOutline } from '../painter.js';
import { WetPaint, averageUnder, rgbHex, loadShare } from '../wetmix.js';
import { comboSettings, comboOp } from '../combo.js';
import { union, clip } from '../rect.js';
import { trimmedSnapshot, drawSnapshot, snapBytes } from '../snapshot.js';
import { gradientChoices } from '../gradient.js';
import { mipLevel, mipSize, mipRect } from '../mips.js';
import { Selection } from '../selection.js';
import { TOOLS, TOOL_BY_ID, SETTING_FIELDS, BASIC_PAINT, SETTING_HINTS, sanitizeSettings, nextSize } from '../tools.js';
import { esc, toast, menu, openMenuOwner, modal, promptBox, fileToDataUrl, store, themeMenu, cssVar } from '../ui.js';
import { exportMethods } from './exporttools.js';
import { newView, matrix, toDoc, zoomAt, rotateAt, flipAt, fitView, fitRectView, actualSize, pinchView, resizedView } from '../view.js';
import { ColorPanel } from './colorpanel.js';
import { LayerPanel } from './layerpanel.js';
import { selectionMethods } from './selecttools.js';
import { selectionBarMethods } from './selectionbar.js';
import { timelapseMethods } from './timelapsetools.js';
import { canvasMethods } from './canvasops.js';
import { layerMethods } from './layerops.js';
import { rulerMethods } from './rulertools.js';
import { gradientMethods } from './gradienttool.js';
import { textMethods } from './texttool.js';
import { toneMethods } from './tonetools.js';
import { filterMethods } from './filtertools.js';
import { figureMethods } from './figuretool.js';
import { quickMaskMethods } from './quickmask.js';
import { navMethods } from './navpanels.js';
import { helpMenuItems } from './help.js';
import { keyBindings, toolKeyLabel, shortcutEditor } from './shortcutsdialog.js';
import { toolForCombo, menuKeyLabel } from '../shortcuts.js';
import { vectorMethods } from './vectortools.js';
import { refMethods } from './reftools.js';
import { smudgeMethods } from './smudgetool.js';
import { liquifyMethods } from './liquifytool.js';
import { retouchMethods } from './retouchtool.js';
import { stripMethods } from './striptool.js';
import { directPaintMethods } from './directpaint.js';
import { effectMethods } from './effecttools.js';
import { colorizeMethods } from './colorizetool.js';
import { actionMethods } from './actiontools.js';
import { RECORD_CMDS } from '../autoactions.js';
import { gradientEditMethods } from './gradienteditor.js';
import { pressureMethods } from './pressuretool.js';
import { lineEditMethods } from './lineedittool.js';
import { symmetryMethods } from './symmetrytools.js';
import { adjustMethods } from './adjusttools.js';
import { printLabel } from '../resolution.js';
import { detectShape, shapePoints, adjustShape } from '../quickshape.js';
import { brushMethods, curveSvg } from './brushtools.js';
import { brushManagerMethods } from './brushmanager.js';
import { symmetryStamps } from '../symmetry.js';
import { linePoints } from '../figure.js';

const SAVE_DELAY = 800;
const SAVE_RETRY = 10000;  // after a failed save
const ZOOM_STEPS = [0.05, 0.1, 0.15, 0.25, 0.33, 0.5, 0.67, 0.75, 1, 1.5, 2, 3, 4, 6, 8, 12, 16, 24, 32, 48, 64];
const GRID_TOOLS = new Set(['select', 'ellipse', 'polygon']);  // selection tools whose corners snap to the grid
const TAP_SLOP = 16, TAP_MS = 300;  // two- and three-finger taps: at most this far (px, both fingers) and this long
const TURN_DEAD = 6 * Math.PI / 180;  // a pinch turns the canvas only once the fingers twist further than this
const HOLD_MS = 600, HOLD_PX = 4;  // QuickShape: the pen kept within HOLD_PX screen px for HOLD_MS
const PIXEL_GRID_ZOOM = 8;  // zoom (800%) from which View → Pixel grid shows lines between the pixels

/** Visible layers marked as reference, or inside a reference folder (bottom first). */
function referenceLayers(root) {
  const out = [];
  const walk = (n, ref) => {
    for (const c of n.children) {
      if (!c.visible) continue;
      if (isFolder(c)) walk(c, ref || c.reference);
      else if (ref || c.reference) out.push(c);
    }
  };
  walk(root, false);
  return out;
}

export class Editor {
  constructor(root, { onHome, onOpen }) {
    this.root = root;
    this.onHome = onHome;
    this.onOpen = onOpen;  // opens another artwork in place of this one ({id} or {newDoc})
    this.settings = sanitizeSettings(store('tools'));
    this.initActions();  // Auto actions (actiontools.js): recording wraps some methods
    this.loadPressureCurve();  // Settings → Pen pressure (pressuretool.js)
    this.tool = TOOL_BY_ID[store('tool')] ? store('tool') : 'pen';
    this.history = new History();
    this.history.onChange = () => { this.updateUndoButtons(); this.scheduleHistory(); if (this.tool === 'lineedit') this.renderToolProps(); };
    this.view = newView();
    this.gesture = null;
    this.live = null;
    this.held = { space: false, alt: false };
    this.pointer = null;  // last pointer position over the canvas, in screen px
    this.savedVersion = -1;
    this.picked = new Set();  // layers/folders picked together with Ctrl/Shift+click, doc.active among them (layerops.js multiPicked)
    this.maskEdit = false;  // tools paint on the selected layer's mask instead of the layer (layerops.js)
    this.showRulers = store('edgeRulers') !== false;  // pixel rulers along the view edges (rulertools.js)
    this.rulerMake = ['ellipse', 'curve'].includes(store('rulerMake')) ? store('rulerMake') : 'line';  // what a drag with the Ruler tool makes
    this.rulerPick = -1;  // the picked straight-line or concentric ruler (rulertools.js)
    this.maskOverlay = store('maskOverlay') === true;  // tint what a mask hides while painting on it
    this.pixelGrid = store('pixelGrid') !== false;  // lines between pixels when zoomed in far
    this.selBarOn = store('selBar') !== false;  // the row of buttons under a selection
    this.poly = null;  // polygon selection being drawn (selecttools.js)
    this.figPoly = null;  // polyline/polygon figure being clicked (figuretool.js)
    this.quickMask = null;  // the Mask tools paint on while Quick mask is on (quickmask.js)
    this.onKey = this.onKey.bind(this);
    this.onKeyUp = this.onKeyUp.bind(this);
    this.onShortcuts = () => {  // Settings → Keyboard shortcuts…: the tool bar's tooltips show the new keys
      this.root.querySelectorAll('.tool-btn[data-tool]').forEach(b => {
        const t = TOOL_BY_ID[b.dataset.tool], k = toolKeyLabel(t.id);
        b.title = t.label + (k ? ` (${k})` : '');
      });
      this.stripTitles();
    };
    this.onTheme = () => this.resize();  // Settings → Theme: the area around the paper and the edge rulers take the new colours
    this.onPaste = this.onPaste.bind(this);
  }

  // ---------- setup ----------

  async open(doc, { isNew = false } = {}) {
    this.doc = doc;
    this.savedVersion = isNew ? -1 : doc.version;
    this.build();
    this.comp = document.createElement('canvas');
    this.comp.width = doc.width;
    this.comp.height = doc.height;
    this.compCtx = this.comp.getContext('2d');  // stays on the GPU: it is drawn every frame and read only by the eyedropper, wand and fill
    this.mips = [this.comp];  // the composite at 1/2, 1/4, ... for drawing it zoomed out (updateMips)
    this.mipDirty = null;
    this.stroke = document.createElement('canvas');
    this.stroke.width = doc.width;
    this.stroke.height = doc.height;
    this.strokeCtx = this.stroke.getContext('2d');
    this.sel = new Selection(doc.width, doc.height);
    this.xf = null;  // free transform in progress (selecttools.js)
    this.clipboard = null;
    this.antsTimer = setInterval(() => {
      if (!this.sel.active || this.xf || this.gesture) return;  // still while drawing: redrawing them costs frames
      this.antsPhase = ((this.antsPhase || 0) + 1) % 8;
      this.drawOverlay();
    }, 120);
    this.updateComp(null);
    this.needsFit = true;  // done by resize() once the viewport has a real size
    this.resize();
    this.layerPanel.render();
    this.showDocSize();
    this.selectTool(this.tool);
    this.loadBrushLibrary();
    window.addEventListener('keydown', this.onKey);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('paste', this.onPaste);
    window.addEventListener('blur', this.onKeyUp);
    window.addEventListener('koe-shortcuts', this.onShortcuts);
    window.addEventListener('koe-theme', this.onTheme);
    if (isNew) this.save();
    else this.setStatus('Saved');
    if (doc.unreadable?.length) {
      const names = doc.unreadable.slice(0, 3).map(n => `"${n}"`).join(', ') + (doc.unreadable.length > 3 ? ` and ${doc.unreadable.length - 3} more` : '');
      toast(`The picture of ${names} could not be read, so it shows empty. It is kept as it was unless you paint on it; File → Earlier versions… may have a good copy.`, { error: true, ms: 12000 });
    }
  }

  destroy() {
    this.destroyed = true;
    window.removeEventListener('keydown', this.onKey);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('paste', this.onPaste);
    window.removeEventListener('blur', this.onKeyUp);
    window.removeEventListener('koe-shortcuts', this.onShortcuts);
    window.removeEventListener('koe-theme', this.onTheme);
    this.resizeObs?.disconnect();
    this.refObs?.disconnect();
    clearTimeout(this.saveTimer);
    clearTimeout(this.thumbTimer);
    clearTimeout(this.lapseTimer);
    cancelIdleCallback(this.sampleIdle);
    clearInterval(this.antsTimer);
    cancelAnimationFrame(this.raf);
    cancelAnimationFrame(this.overlayRaf);
    cancelIdleCallback(this.snapIdle);
    this.releaseStripHolds();
    this.root.innerHTML = '';
    this.freeCanvases();
  }

  /**
   * Gives back the GPU memory of a closed artwork (its layers, the composite, the stroke canvases, the selection and
   * undo copies) at once: dropped canvases wait for garbage collection, which a small JS heap runs rarely, so each
   * artwork opened and closed kept its few hundred MB for a while.
   */
  freeCanvases() {
    const free = c => { if (c) c.width = c.height = 0; };
    for (const r of this.doc?.rasters() || []) free(r.canvas);
    for (const c of this.mips || []) free(c);
    for (const s of this.snapQueue || []) free(s.canvas);
    [this.stroke, this.dualCanvas, this.comboCanvas, this.heightCanvas, this.sel?.canvas, this.paperLayer, this.insideClip?.canvas].forEach(free);
    this.snapQueue = [];
    this.history = new History();  // its undo copies go too
    this.compRead = null;
  }

  build() {
    const doc = this.doc;
    this.root.innerHTML = `
      <div class="editor">
        <header class="ed-top">
          <button class="icon-btn" data-act="home" title="Back to the gallery">${icon('back')}</button>
          <button class="menu-btn" data-menu="file">File</button>
          <button class="menu-btn" data-menu="edit">Edit</button>
          <button class="menu-btn" data-menu="image">Image</button>
          <button class="menu-btn" data-menu="select">Select</button>
          <button class="menu-btn" data-menu="layer">Layer</button>
          <button class="menu-btn" data-menu="filter">Filter</button>
          <button class="menu-btn" data-menu="view">View</button>
          <button class="menu-btn" data-menu="settings">Settings</button>
          <button class="menu-btn" data-menu="help">Help</button>
          <button class="ed-title" title="Rename the artwork">${esc(doc.title)}</button>
          <button class="mask-chip" hidden title="Tools paint on the layer mask: painting hides, erasing shows. Click to paint on the layer again.">${icon('mask', 14)} Painting on mask</button>
          <button class="mask-chip tile-chip" hidden title="The canvas is shown repeated round itself, to check a pattern joins up. Click to turn it off.">Tile preview</button>
          <button class="mask-chip panels-chip" hidden title="The tool bar and panels are hidden to give the canvas the room. Click or press Tab to show them again.">Panels hidden</button>
          <button class="mask-chip gray-chip" hidden title="The canvas is shown in grays to check light and dark (your colours are unchanged). Click to show colours again.">Grayscale view</button>
          <button class="mask-chip lapse-chip" hidden title="A timelapse frame is kept each time the artwork saves. Click to pause recording.">● Recording timelapse</button>
          <button class="mask-chip qmask-chip" hidden title="Tools paint the selection: painting selects, erasing deselects. Click (or press Q) to turn it into the selection.">${icon('mask', 14)} Quick mask</button>
          <div class="grow"></div>
          <button class="icon-btn" data-act="undo" title="Undo (Ctrl+Z)">${icon('undo')}</button>
          <button class="icon-btn" data-act="redo" title="Redo (Ctrl+Y)">${icon('redo')}</button>
          <span class="save-state muted small"></span>
        </header>
        <div class="ed-body">
          <nav class="ed-tools" aria-label="Tools">
            ${TOOLS.map((t, i) => (i && TOOLS[i - 1].group !== t.group ? '<span class="tool-sep"></span>' : '') +
              `<button class="tool-btn" data-tool="${t.id}" title="${esc(t.label)}${toolKeyLabel(t.id) ? ` (${esc(toolKeyLabel(t.id))})` : ''}" aria-label="${esc(t.label)}">${icon(t.icon, 22)}</button>`).join('')}
          </nav>
          <aside class="ed-left">
            <section class="panel grow" data-panel="tool"><h3><button class="panel-head" title="Tool property: the settings of the current tool">${icon('chevron', 12)}<span class="tool-title">Tool</span></button></h3><div class="tool-props"></div></section>
            <section class="panel" data-panel="history"><h3><button class="panel-head" title="Every step you can undo: click one to go back to it">${icon('chevron', 12)}<span>History</span></button></h3><div class="history-list"></div></section>
            <section class="panel" data-panel="navigator"><h3><button class="panel-head" title="The whole picture: click or drag to move the view, scroll to zoom">${icon('chevron', 12)}<span>Navigator</span></button></h3><canvas class="nav-canvas"></canvas></section>
          </aside>
          <div class="ed-center">
            <div class="ed-viewport">
              <canvas class="ed-view"></canvas>
              <canvas class="ed-overlay"></canvas>
            </div>
          </div>
          <aside class="ed-side">
            <section class="panel" data-panel="color"><h3><button class="panel-head">${icon('chevron', 12)}<span>Color</span></button></h3><div class="color-panel"></div></section>
            <section class="panel grow" data-panel="layers"><h3><button class="panel-head">${icon('chevron', 12)}<span>Layers</span></button></h3><div class="layer-panel"></div></section>
          </aside>
        </div>
        <footer class="ed-status">
          <div class="st-group" role="group" aria-label="Zoom">
            <button class="icon-btn" data-act="zoomOut" title="Zoom out (Ctrl+-)">${icon('minus', 14)}</button>
            <button class="zoom-label" data-act="actual" title="Zoom. Click for 100% (Ctrl+1)">100%</button>
            <button class="icon-btn" data-act="zoomIn" title="Zoom in (Ctrl+=)">${icon('plus', 14)}</button>
            <button class="icon-btn" data-act="fit" title="Fit to window (Ctrl+0)">${icon('fit', 15)}</button>
          </div>
          <div class="st-group" role="group" aria-label="Rotation">
            <button class="icon-btn" data-act="rotL" title="Rotate view left (4)">${icon('rotL', 15)}</button>
            <button class="rot-label" data-act="rotReset" title="View rotation. Click to straighten (5)">0°</button>
            <button class="icon-btn" data-act="rotR" title="Rotate view right (6)">${icon('rotR', 15)}</button>
            <button class="icon-btn" data-act="flip" title="Mirror the view (Shift+M)">${icon('flip', 15)}</button>
          </div>
          <div class="st-group" role="group" aria-label="Rulers">
            <button class="icon-btn" data-act="rulers" title="Rulers along the edges">${icon('ruler', 15)}</button>
            <button class="icon-btn" data-act="snap" title="Snap strokes to rulers (Ctrl+2)">${icon('magnet', 15)}</button>
          </div>
          <div class="grow"></div>
          <span class="muted small cursor-pos"></span>
          <span class="muted small doc-size"></span>
        </footer>
      </div>`;
    const $ = s => this.root.querySelector(s);
    this.viewport = $('.ed-viewport');
    this.viewCanvas = $('.ed-view');
    this.overlay = $('.ed-overlay');
    this.vctx = this.viewCanvas.getContext('2d');
    this.octx = this.overlay.getContext('2d');
    this.cursorPos = $('.cursor-pos');
    this.zoomLabel = $('.zoom-label');
    this.rotLabel = $('.rot-label');
    this.colors = new ColorPanel($('.color-panel'));
    this.layerPanel = new LayerPanel($('.layer-panel'), this);
    this.colors.onChange = () => { this.textColorChanged(); this.drawBrushPreview(); this.drawBrushList(); this.drawGradientStrip(); };
    this.root.querySelectorAll('[data-tool]').forEach(b => { b.onclick = () => this.selectTool(b.dataset.tool); });
    const acts = {
      home: () => this.goHome(), undo: () => this.undo(), redo: () => this.redo(),
      zoomIn: () => this.zoomStep(1), zoomOut: () => this.zoomStep(-1), actual: () => this.actual(), fit: () => this.fit(),
      rotL: () => this.rotate(-15), rotR: () => this.rotate(15), rotReset: () => this.rotate(null), flip: () => this.flipView(),
      rulers: () => this.toggleEdgeRulers(), snap: () => this.toggleSnap(),
    };
    this.root.querySelectorAll('[data-act]').forEach(b => { b.onclick = () => acts[b.dataset.act](); });
    // the menu bar: once one menu is open, pointing at another opens that one; ← / → move along the bar
    const bar = [...this.root.querySelectorAll('[data-menu]')];
    const openBar = (b, byKey = false) => {
      this.finishTransform();
      menu(b, this.recordable(b.dataset.menu, withKeyLabels(this.menuItems(b.dataset.menu))), { onSide: dir => openBar(bar[(bar.indexOf(b) + dir + bar.length) % bar.length], true) });
      if (byKey) document.querySelector('.menu button:not(:disabled)')?.focus();
    };
    for (const b of bar) {
      b.onclick = () => openBar(b);
      b.onpointerenter = () => { const o = openMenuOwner(); if (o && o !== b && bar.includes(o)) openBar(b); };
    }
    // using the side panels or the tool bar while transforming applies the transform first
    for (const el of this.root.querySelectorAll('.ed-side, .ed-left, .ed-tools, .ed-top')) {
      el.addEventListener('pointerdown', e => {
        if (e.target.closest('[data-act="undo"]')) return;
        this.finishTransform();
        // the tool panel and colour panel change the text being edited, so they leave the edit open
        if (!e.target.closest('.tool-props, .color-panel, [data-panel="tool"], [data-panel="color"]')) this.finishText();
      }, true);
    }
    $('.ed-title').onclick = () => this.rename();
    // side panels fold away by clicking their heading; remembered between launches
    const folded = store('folded') || {};
    this.root.querySelectorAll('[data-panel]').forEach(sec => {
      sec.classList.toggle('folded', !!folded[sec.dataset.panel]);
      sec.querySelector('.panel-head').onclick = () => {
        sec.classList.toggle('folded');
        const f = store('folded') || {};
        f[sec.dataset.panel] = sec.classList.contains('folded');
        store('folded', f);
        if (sec.dataset.panel === 'navigator') { this.navStale = true; this.scheduleNav(); }
      };
    });
    $('.mask-chip:not(.qmask-chip)').onclick = () => this.editMask(false);
    $('.qmask-chip').onclick = () => this.toggleQuickMask();
    $('.gray-chip').onclick = () => this.toggleGrayView();
    $('.panels-chip').onclick = () => this.togglePanels();
    $('.tile-chip').onclick = () => this.toggleTileView();
    $('.lapse-chip').onclick = () => this.toggleTimelapse();
    $('.lapse-chip').hidden = !doc.timelapse;
    this.resizeObs = new ResizeObserver(() => this.resize());
    this.resizeObs.observe(this.viewport);
    this.bindPointer();
    this.applyStrip();  // the shortcut strip beside the canvas (striptool.js)
    this.bindNavigator();
    this.renderHistory();
    this.renderRefWindow();
    this.renderActionWindow();
    this.updateUndoButtons();
    this.updateSnapButton();
    this.root.querySelector('[data-act="rulers"]').classList.toggle('on', this.showRulers);
  }

  menuItems(name) {
    const d = this.doc, multi = !!this.multiPicked();
    return {
      file: [
        { label: 'New canvas…', run: () => this.newCanvas() },
        { label: 'Open image or project…', run: () => this.openOther() },
        '-',
        { label: 'Save now', key: 'Ctrl+S', run: () => this.save() },
        { label: 'Export as PNG', key: 'Ctrl+Shift+S', run: () => this.exportAs('png') },
        { label: 'Export…', key: 'Ctrl+Alt+Shift+S', run: () => this.exportAs() },
        { label: 'Export layers (one PNG each)…', run: () => this.exportLayers() },
        { label: 'Save project file (.koe)…', run: () => this.saveProjectFile() },
        '-',
        { label: 'Import image as layer…', run: () => this.pickImage() },
        { label: 'Earlier versions…', run: () => this.openEarlierVersion(), disabled: !d.id },
        { label: 'Timelapse', sub: [
          { label: 'Record timelapse', checked: !!d.timelapse, run: () => this.toggleTimelapse() },
          { label: 'Export timelapse…', run: () => this.exportTimelapse() },
          { label: 'Discard timelapse…', run: () => this.discardTimelapse() },
        ] },
        { label: 'Open artwork folder', run: () => api.openFolder() },
        '-',
        { label: 'Back to gallery', run: () => this.goHome() },
      ],
      edit: [
        { label: 'Undo', key: 'Ctrl+Z', run: () => this.undo(), disabled: !this.history.canUndo },
        { label: 'Redo', key: 'Ctrl+Y', run: () => this.redo(), disabled: !this.history.canRedo },
        '-',
        { label: 'Cut', key: 'Ctrl+X', run: () => this.copySelection(true) },
        { label: 'Copy', key: 'Ctrl+C', run: () => this.copySelection() },
        { label: 'Paste', key: 'Ctrl+V', run: () => this.pasteInternal(), disabled: !this.clipboard },
        { label: 'Stroke selection…', run: () => this.strokeSelectionDialog(), disabled: !this.sel.active },
        { label: 'Colorize…', run: () => this.colorizeDialog() },
        '-',
        { label: 'Transform…', key: 'Ctrl+T', run: () => this.beginTransform() },
        { label: this.sel.active ? 'Delete selected pixels' : 'Clear layer', rec: 'clear', key: 'Del', run: () => this.clearLayer() },
        { label: this.sel.active ? 'Fill selection with main color' : 'Fill layer with main color', rec: 'fill-main', key: 'Alt+Del', run: () => this.fillLayer() },
        { label: this.sel.active ? 'Fill selection with sub color' : 'Fill layer with sub color', rec: 'fill-sub', key: 'Shift+Alt+Del', run: () => this.fillLayer(true) },
      ],
      image: [
        { label: 'Canvas size…', key: 'Ctrl+Alt+C', run: () => this.canvasSizeDialog() },
        { label: 'Image size…', key: 'Ctrl+Alt+I', run: () => this.imageSizeDialog() },
        { label: 'Crop tool', key: 'C', run: () => this.selectTool('crop') },
        { label: 'Crop to selection', run: () => this.cropToSelection(), disabled: !this.sel.active },
        { label: 'Trim to content', run: () => this.trimToContent() },
        '-',
        { label: 'Rotate canvas 90° right', run: () => this.rotateCanvas(1) },
        { label: 'Rotate canvas 90° left', run: () => this.rotateCanvas(-1) },
        { label: 'Rotate canvas 180°', run: () => this.rotateCanvas(2) },
        { label: 'Flip canvas horizontally', run: () => this.flipPixels(d.rasters(), 'h', 'Flip canvas', true) },
        { label: 'Flip canvas vertically', run: () => this.flipPixels(d.rasters(), 'v', 'Flip canvas', true) },
      ],
      select: [
        { label: 'Select all', key: 'Ctrl+A', run: () => this.selectAll() },
        { label: 'Deselect', key: 'Ctrl+D', run: () => this.deselect(), disabled: !this.sel.active },
        { label: 'Invert selection', key: 'Ctrl+Shift+I', run: () => this.invertSelection() },
        { label: 'Select layer pixels', run: () => this.selectLayerPixels() },
        { label: 'Color range…', run: () => this.colorRangeDialog() },
        '-',
        { label: 'Expand selection…', run: () => this.morphSelection('expand'), disabled: !this.sel.active },
        { label: 'Shrink selection…', run: () => this.morphSelection('shrink'), disabled: !this.sel.active },
        { label: 'Feather selection…', run: () => this.morphSelection('feather'), disabled: !this.sel.active },
        { label: 'Border selection…', run: () => this.morphSelection('border'), disabled: !this.sel.active },
        '-',
        { label: 'Quick mask (paint the selection)', key: 'Q', checked: !!this.quickMask, run: () => this.toggleQuickMask() },
        { label: 'Transform selection…', key: 'Ctrl+T', run: () => this.beginTransform() },
      ],
      filter: this.filterMenuItems(),
      help: helpMenuItems(),
      settings: [
        { label: 'Theme', sub: themeMenu() },
        { label: 'Pen pressure…', run: () => this.pressureDialog() },
        { label: 'Shortcut strip (pen tablets)', sub: this.stripMenu() },
        { label: 'Keyboard shortcuts…', run: () => shortcutEditor() },
      ],
      layer: [
        { label: 'New layer', key: 'Ctrl+Shift+N', run: () => this.layerAdd() },
        { label: 'New', sub: [
          { label: 'Vector layer', run: () => this.newVectorLayer() },
          { label: 'Folder', run: () => this.folderAdd() },
          { label: this.sel.active ? 'Correction layer (in selection)…' : 'Correction layer…', rec: 'correction', run: () => this.newAdjustLayer() },
          { label: this.sel.active ? 'Screentone (in selection)…' : 'Screentone…', rec: 'screentone', run: () => this.newToneLayer() },
        ] },
        { label: multi ? 'Duplicate selected layers' : 'Duplicate layer', rec: 'duplicate', run: () => this.layerDuplicate() },
        { label: 'Copy to new layer', key: 'Ctrl+J', run: () => this.layerViaCopy() },
        { label: 'Cut to new layer', key: 'Ctrl+Shift+J', run: () => this.layerViaCopy(true) },
        { label: 'Rename…', key: 'F2', run: () => this.renameLayer() },
        { label: 'Find layer on canvas', checked: !!this.findPick, run: () => this.findLayerMode() },
        { label: multi ? 'Delete selected layers' : 'Delete layer', rec: 'delete', run: () => this.layerDelete() },
        '-',
        { label: 'Put in new folder', key: 'Ctrl+G', run: () => this.groupIntoFolder() },
        multi ? { label: 'Merge selected layers', rec: 'merge', key: 'Ctrl+E', run: () => this.mergeDown() }
        : isFolder(d.active)
          ? { label: 'Merge folder', rec: 'merge', key: 'Ctrl+E', run: () => this.mergeFolder(d.active) }
          : { label: 'Merge with layer below', rec: 'merge', key: 'Ctrl+E', run: () => this.mergeDown() },
        { label: 'Merge visible to new layer', key: 'Ctrl+Shift+Alt+E', run: () => this.mergeVisible() },
        { label: 'Flatten image', run: () => this.flattenImage() },
        '-',
        { label: 'Mask', sub: [
          d.active.mask
            ? { label: d.active.mask.enabled ? 'Turn mask off' : 'Turn mask on', run: () => this.toggleMask() }
            : { label: this.sel.active ? 'Add mask (hide outside selection)' : 'Add mask', run: () => this.addMask() },
          { label: 'Apply mask to layer', run: () => this.applyMask(), disabled: !d.active.mask || isFolder(d.active) },
          { label: 'Delete mask', run: () => this.deleteMask(), disabled: !d.active.mask },
        ] },
        { label: 'Layer effects (border, shadow)…', run: () => this.layerEffectsDialog(), disabled: isFolder(d.active) || !!d.active.adjust },
        { label: 'Layer color…', checked: !!d.active.layerColor, run: () => this.layerColorDialog(), disabled: isFolder(d.active) || !!d.active.adjust },
        { label: 'Screentone settings…', run: () => this.toneDialog(), disabled: isFolder(d.active) || !!d.active.adjust },
        { label: 'Correction layer settings…', run: () => this.adjustSettings(), disabled: !d.active.adjust },
        { label: 'Rasterize', sub: [
          { label: 'Layer effects', run: () => this.rasterizeEffects(d.active), disabled: !d.active.effects },
          { label: 'Layer color', run: () => this.rasterizeLayerColor(d.active), disabled: !d.active.layerColor },
          { label: 'Screentone', run: () => this.rasterizeTone(d.active), disabled: !d.active.tone },
          { label: 'Text', run: () => this.rasterizeText(d.active), disabled: !d.active.text },
          { label: 'Vector layer', run: () => this.rasterizeVector(d.active), disabled: !d.active.vector },
        ] },
        '-',
        { label: 'Flip layer horizontally', run: () => this.flipPixels(this.layerRasters(), 'h', 'Flip layer') },
        { label: 'Flip layer vertically', run: () => this.flipPixels(this.layerRasters(), 'v', 'Flip layer') },
      ],
      view: [
        { label: 'Zoom in', key: 'Ctrl+=', run: () => this.zoomStep(1) },
        { label: 'Zoom out', key: 'Ctrl+-', run: () => this.zoomStep(-1) },
        { label: 'Actual size (100%)', key: 'Ctrl+1', run: () => this.actual() },
        { label: 'Fit to window', key: 'Ctrl+0', run: () => this.fit() },
        { label: 'Zoom to selection', key: 'Ctrl+Alt+0', run: () => this.zoomToSelection(), disabled: !this.sel.active },
        { label: 'Rotate and mirror', sub: [
          { label: 'Rotate left', key: '4', run: () => this.rotate(-15) },
          { label: 'Rotate right', key: '6', run: () => this.rotate(15) },
          { label: 'Reset rotation', key: '5', run: () => this.rotate(null) },
          { label: 'Mirror view', key: 'Shift+M', run: () => this.flipView() },
        ] },
        { label: 'Hide panels', key: 'Tab', checked: !!this.panelsHidden, run: () => this.togglePanels() },
        '-',
        { label: 'Grid', key: "Ctrl+'", checked: d.rulers.grid.show, run: () => this.toggleGrid() },
        { label: 'Grid settings…', run: () => this.gridDialog() },
        { label: 'Edge rulers', checked: this.showRulers, run: () => this.toggleEdgeRulers() },
        { label: 'Pixel grid (when zoomed in)', checked: this.pixelGrid, run: () => this.togglePixelGrid() },
        { label: 'Rulers and symmetry', sub: [
          { label: 'Show rulers and guides', key: 'Ctrl+;', checked: d.rulers.visible, run: () => this.toggleRulerVisibility() },
          { label: 'Snap to rulers', key: 'Ctrl+2', checked: d.rulers.snap, run: () => this.toggleSnap() },
          { label: 'Ruler tool…', key: 'U', run: () => this.selectTool('ruler') },
          { label: 'Clear guides', run: () => this.clearGuides(), disabled: !d.rulers.guides.length },
          { label: 'Clear line, curve and concentric rulers', run: () => this.clearShapes(), disabled: !d.rulers.shapes.length },
          '-',
          { label: 'Symmetry ruler', checked: d.rulers.symmetry.kind !== 'off', run: () => this.toggleSymmetry() },
          { label: 'Symmetry settings…', run: () => this.symmetryDialog() },
        ] },
        '-',
        { label: 'Show mask area (while painting on a mask)', checked: this.maskOverlay, run: () => this.toggleMaskOverlay() },
        { label: 'Grayscale view (check values)', checked: !!this.grayView, run: () => this.toggleGrayView() },
        { label: 'Tile preview (seamless patterns)', checked: !!this.tileView, run: () => this.toggleTileView() },
        { label: 'Selection bar', checked: this.selBarOn, run: () => this.toggleSelectionBar() },
        '-',
        { label: 'Reference window', checked: this.refState().open, run: () => this.toggleRefWindow() },
        { label: 'Auto actions', checked: this.actState().open, run: () => this.toggleActionWindow() },
        { label: 'Brushes (with stroke previews)', checked: this.brushListState().open, run: () => this.toggleBrushList() },
        '-',
        { label: 'Reload screen', key: 'F5', run: () => window.koeReload?.() },
      ],
    }[name];
  }

  // ---------- rendering ----------

  resize() {
    // a tool bar taller than the window becomes two columns, so no tool is out of sight
    const tools = this.root.querySelector('.ed-tools');
    tools.classList.remove('two-col');
    tools.classList.toggle('two-col', tools.scrollHeight > tools.clientHeight + 1);
    const r = this.viewport.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    // the area changed size (window, panels, shortcut strip): a fitted canvas stays fitted, otherwise the middle stays put
    if (!this.needsFit && this.vw > 0 && this.vh > 0 && r.width > 0 && r.height > 0 && (r.width !== this.vw || r.height !== this.vh)) {
      this.view = resizedView(this.view, this.doc.width, this.doc.height, this.vw, this.vh, r.width, r.height);
    }
    this.vw = r.width; this.vh = r.height; this.dpr = dpr;
    this.placeStrip();  // a floating shortcut strip stays inside the canvas area
    this.bg = cssVar('--canvas-bg', '#34353c');
    this.rulerBg = cssVar('--panel', '#26272d'); this.rulerLine = cssVar('--line', '#3a3b43');
    if (this.needsFit && r.width > 0 && r.height > 0) {
      this.needsFit = false;
      this.view = fitView(this.doc.width, this.doc.height, r.width, r.height);
    }
    for (const c of [this.viewCanvas, this.overlay]) {
      c.width = Math.max(1, Math.round(r.width * dpr));
      c.height = Math.max(1, Math.round(r.height * dpr));
    }
    this.render();
    this.paintOverlay();
  }

  /**
   * Marks a doc region (all of it when r is null) as needing recompositing and as part of the screen to redraw
   * (this.dirty: a rect, or 'all'). The compositing itself waits for flushComp(), which runs once before the
   * composite is drawn or read: a pen sends several moves per frame, and each used to recomposite the layers.
   */
  updateComp(r) {
    const d = this.doc;
    const fx = r ? docEffectReach(d) : 0;  // a layer's border or shadow reaches beyond the pixels that changed
    if (fx) r = { x: r.x - fx, y: r.y - fx, w: r.w + 2 * fx, h: r.h + 2 * fx };
    const area = clip(r || { x: 0, y: 0, w: d.width, h: d.height }, d.width, d.height);
    if (area) this.compQueue = this.compQueue ? union(this.compQueue, area) : area;
    this.dirty = !r || this.dirty === 'all' ? 'all' : union(this.dirty, area);
  }

  /** Brings the composite canvas up to date (see updateComp); call before drawing or reading this.comp. */
  flushComp() {
    const q = this.compQueue, d = this.doc;
    if (!q || this.destroyed) return;
    this.compQueue = null;
    const area = clip(q, d.width, d.height);  // the canvas may have shrunk since
    if (area) {
      // during a stroke (or a dab-by-dab tool's) the other layers stay as they are: screentone and effects are kept
      const g = this.gesture, painting = this.live?.layer || (g?.cache && g.layer);
      composite(this.compCtx, d, area, this.live, painting ? { except: painting } : null);
      this.mipDirty = this.mipDirty ? union(this.mipDirty, area) : area;
      if (this.compRead) this.compRead.dirty = union(this.compRead.dirty, area);  // read again when next needed (compPixels)
    }
  }

  /**
   * The composite at 1 / 2^n, brought up to date: levels 1..n (and any kept from before) redraw only what changed
   * since, each from the level above it, halving with plain bilinear filtering (an exact 2 x 2 average). The
   * browser's own smooth downscaling would rebuild mipmaps of the whole picture on every change instead.
   */
  updateMips(n) {
    this.flushComp();
    const d = this.doc, W = d.width, H = d.height, dirty = this.mipDirty;
    this.mipDirty = null;
    let full = false;  // once a level is redrawn whole, the ones below it must be too
    const top = Math.max(n, this.mips.length - 1);
    for (let k = 1; k <= top; k++) {
      const { w, h } = mipSize(W, H, k), src = this.mips[k - 1];
      let c = this.mips[k];
      if (!c || c.width !== w || c.height !== h) {
        if (!c) c = this.mips[k] = document.createElement('canvas');
        c.width = w; c.height = h;
        full = true;
      }
      const r = full ? { x: 0, y: 0, w, h } : dirty && mipRect(dirty, k, W, H);
      if (!r) continue;
      const ctx = c.getContext('2d');
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'low';
      ctx.clearRect(r.x, r.y, r.w, r.h);
      const sw = Math.min(2 * r.w, src.width - 2 * r.x), sh = Math.min(2 * r.h, src.height - 2 * r.y);
      if (sw > 0 && sh > 0) ctx.drawImage(src, 2 * r.x, 2 * r.y, sw, sh, r.x, r.y, sw / 2, sh / 2);
    }
    return this.mips[n];
  }

  /** Redraws the screen on the next frame, only the dirty region when nothing else changed. */
  requestRender() {
    if (!this.raf) this.raf = requestAnimationFrame(() => { this.raf = 0; this.render(this.dirty || 'all'); });
  }

  /**
   * Draws the composite through the view transform. With a doc rect, only the whole screen pixels it covers are
   * repainted (a stroke redraws just what it touched); 'all' repaints everything. The background, paper shadow,
   * white paper and checker depend only on the view, so they are kept in this.paperLayer (redrawn on full
   * renders) and copied exactly for partial ones; clipping to whole pixels keeps the edges free of blending.
   */
  render(region = 'all') {
    if (this.destroyed) return;  // its canvases are freed (freeCanvases)
    this.flushComp();
    if (this.tileView) region = 'all';  // the copies round the canvas change with every stroke too
    const ctx = this.vctx, d = this.doc, dpr = this.dpr || 1;
    const r = region !== 'all' && region ? clip(region, d.width, d.height) : null;
    this.dirty = null;
    if (region !== 'all' && !r) return;
    const [a, b, c, dd, e, f] = matrix(this.view);
    const m = [a * dpr, b * dpr, c * dpr, dd * dpr, e * dpr, f * dpr];
    let box = { x: 0, y: 0, w: d.width, h: d.height };
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (!r) {
      this.drawPaperLayer(m);
    } else {
      // the screen pixels the doc rect covers, then the doc pixels those screen pixels cover
      const sx = (x, y) => m[0] * x + m[2] * y + m[4], sy = (x, y) => m[1] * x + m[3] * y + m[5];
      const cs = [[r.x, r.y], [r.x + r.w, r.y], [r.x, r.y + r.h], [r.x + r.w, r.y + r.h]];
      const x0 = Math.floor(Math.min(...cs.map(([x, y]) => sx(x, y)))) - 1, y0 = Math.floor(Math.min(...cs.map(([x, y]) => sy(x, y)))) - 1;
      const x1 = Math.ceil(Math.max(...cs.map(([x, y]) => sx(x, y)))) + 1, y1 = Math.ceil(Math.max(...cs.map(([x, y]) => sy(x, y)))) + 1;
      ctx.beginPath();
      ctx.rect(x0, y0, x1 - x0, y1 - y0);
      ctx.clip();
      const ds = [[x0, y0], [x1, y0], [x0, y1], [x1, y1]].map(([x, y]) => toDoc(this.view, x / dpr, y / dpr));
      const bx0 = Math.floor(Math.min(...ds.map(p => p.x))) - 2, by0 = Math.floor(Math.min(...ds.map(p => p.y))) - 2;
      const bx1 = Math.ceil(Math.max(...ds.map(p => p.x))) + 2, by1 = Math.ceil(Math.max(...ds.map(p => p.y))) + 2;
      box = clip({ x: bx0, y: by0, w: bx1 - bx0, h: by1 - by0 }, d.width, d.height);
      if (!box) { ctx.restore(); return; }
    }
    ctx.drawImage(this.paperLayer, 0, 0);
    const scale = this.view.zoom * dpr, n = mipLevel(scale);
    if (this.tileView) this.drawTiles(ctx, m, n);
    ctx.setTransform(...m);
    if (n) {  // zoomed out: from a downscaled copy (see updateMips), never through the browser's mipmaps
      const src = this.updateMips(n), f = 2 ** n, e = 2 * f;  // e: the bilinear edge of the source rect stays outside the clip
      const s = mipRect({ x: box.x - e, y: box.y - e, w: box.w + 2 * e, h: box.h + 2 * e }, n, d.width, d.height);
      ctx.beginPath();
      ctx.rect(0, 0, d.width, d.height);
      ctx.clip();
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'low';
      if (this.grayView) ctx.filter = 'grayscale(1)';
      ctx.drawImage(src, s.x, s.y, s.w, s.h, s.x * f, s.y * f, s.w * f, s.h * f);
    } else {
      ctx.imageSmoothingEnabled = this.view.zoom < 2;
      ctx.imageSmoothingQuality = scale >= 1 ? 'high' : 'low';  // 'high' downscaling would build mipmaps of the whole composite
      if (this.grayView) ctx.filter = 'grayscale(1)';  // View → Grayscale view: only the screen, never the artwork
      ctx.drawImage(this.comp, box.x, box.y, box.w, box.h, box.x, box.y, box.w, box.h);
    }
    ctx.filter = 'none';
    const tint = this.maskTint();
    if (tint) { ctx.globalAlpha = 0.45; ctx.drawImage(tint, box.x, box.y, box.w, box.h, box.x, box.y, box.w, box.h); ctx.globalAlpha = 1; }
    ctx.restore();
    this.scheduleNav();
    if (r) return;
    this.zoomLabel.textContent = Math.round(this.view.zoom * 1000) / 10 + '%';
    const deg = Math.round(((this.view.rot * 180 / Math.PI) % 360 + 540) % 360 - 180);
    this.rotLabel.textContent = deg + '°' + (this.view.flip ? ' ⇋' : '');
  }

  /**
   * View → Tile preview: the picture repeated once all round itself (paper included), to check that a pattern
   * joins up without seams. Only the screen shows it.
   */
  drawTiles(ctx, m, n) {
    const d = this.doc, src = n ? this.updateMips(n) : this.comp, f = 2 ** n;
    for (let ty = -1; ty <= 1; ty++) {
      for (let tx = -1; tx <= 1; tx++) {
        if (!tx && !ty) continue;
        ctx.save();
        ctx.setTransform(...m);
        ctx.translate(tx * d.width, ty * d.height);
        ctx.fillStyle = d.paper || this.checker(ctx);
        ctx.fillRect(0, 0, d.width, d.height);
        ctx.imageSmoothingEnabled = n > 0 || this.view.zoom < 2;
        ctx.imageSmoothingQuality = 'low';
        if (this.grayView) ctx.filter = 'grayscale(1)';
        ctx.drawImage(src, 0, 0, Math.ceil(d.width / f), Math.ceil(d.height / f), 0, 0, Math.ceil(d.width / f) * f, Math.ceil(d.height / f) * f);
        ctx.restore();
      }
    }
  }

  /** View → Tile preview (session only; a chip at the top turns it off). */
  toggleTileView() {
    this.tileView = !this.tileView;
    this.root.querySelector('.tile-chip').hidden = !this.tileView;
    this.render();
  }

  /** View → Pixel grid: lines between the pixels when zoomed in to PIXEL_GRID_ZOOM or more (kept per machine). */
  togglePixelGrid() {
    this.pixelGrid = !this.pixelGrid;
    store('pixelGrid', this.pixelGrid);
    this.drawOverlay();
  }

  drawPixelGrid(ctx) {
    if (!this.pixelGrid || this.view.zoom < PIXEL_GRID_ZOOM) return;
    const d = this.doc, dpr = this.dpr || 1;
    const cs = [[0, 0], [this.vw, 0], [0, this.vh], [this.vw, this.vh]].map(([x, y]) => toDoc(this.view, x, y));
    const x0 = Math.max(0, Math.floor(Math.min(...cs.map(p => p.x)))), x1 = Math.min(d.width, Math.ceil(Math.max(...cs.map(p => p.x))));
    const y0 = Math.max(0, Math.floor(Math.min(...cs.map(p => p.y)))), y1 = Math.min(d.height, Math.ceil(Math.max(...cs.map(p => p.y))));
    if (x1 <= x0 || y1 <= y0) return;
    const [a, b, c, dd, e, f] = matrix(this.view);
    // unturned, each line sits in the middle of one device pixel, so it shows crisp instead of as a blurred pair
    const crisp = !b && !c, at = v => (crisp ? Math.round(v) + 0.5 : v);
    const sp = (x, y) => [at((a * x + c * y + e) * dpr), at((b * x + dd * y + f) * dpr)];
    ctx.save();
    ctx.strokeStyle = 'rgba(128,128,136,0.35)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = x0; x <= x1; x++) { ctx.moveTo(...sp(x, y0)); ctx.lineTo(...sp(x, y1)); }
    for (let y = y0; y <= y1; y++) { ctx.moveTo(...sp(x0, y)); ctx.lineTo(...sp(x1, y)); }
    ctx.stroke();
    ctx.restore();
  }

  /** Background, paper shadow, white paper and (for transparent paper) the checker, for the current view. */
  drawPaperLayer(m) {
    const d = this.doc, dpr = this.dpr || 1, W = this.viewCanvas.width, H = this.viewCanvas.height;
    const c = this.paperLayer || (this.paperLayer = document.createElement('canvas'));
    if (c.width !== W || c.height !== H) { c.width = W; c.height = H; }
    const ctx = c.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = this.bg;
    ctx.fillRect(0, 0, W, H);
    ctx.setTransform(...m);
    ctx.shadowColor = 'rgba(0,0,0,0.45)';
    ctx.shadowBlur = 18 * dpr;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, d.width, d.height);
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
    if (!d.paper) {
      ctx.fillStyle = this.checker(ctx);
      ctx.fillRect(0, 0, d.width, d.height);
    }
  }

  /**
   * In red: the quick mask (the selection being painted), or the hidden part of the mask being painted on
   * (View → Show mask area); null when there is neither.
   */
  maskTint() {
    const m = this.quickMask || (this.maskOverlay && this.maskEdit ? this.doc.active.mask : null);
    if (!m) return null;
    const d = this.doc, live = this.live && this.live.layer === m ? this.live : null;
    const key = `${this.quickMask ? 'q' : 'm'}${m.version}/${live ? this.strokeVersion : 0}/${d.width}x${d.height}`;
    if (this.tintKey === key && this.tintCanvas) return this.tintCanvas;
    const c = this.tintCanvas || (this.tintCanvas = document.createElement('canvas'));
    if (c.width !== d.width || c.height !== d.height) { c.width = d.width; c.height = d.height; }
    const ctx = c.getContext('2d');
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.clearRect(0, 0, d.width, d.height);
    ctx.drawImage(m.canvas, 0, 0);
    if (live) {  // the stroke in progress counts too
      ctx.globalAlpha = live.alpha;
      ctx.globalCompositeOperation = live.mode;
      const r = { x: 0, y: 0, w: d.width, h: d.height };
      ctx.drawImage(...liveSource(live, r), r.w, r.h, 0, 0, r.w, r.h);
      ctx.globalAlpha = 1;
    }
    ctx.globalCompositeOperation = 'source-in';
    ctx.fillStyle = '#ff2a2a';
    ctx.fillRect(0, 0, d.width, d.height);
    this.tintKey = key;
    return c;
  }

  /** The canvas size in the status bar, with its print size on hover. */
  showDocSize() {
    const d = this.doc, el = this.root.querySelector('.doc-size');
    el.textContent = `${d.width} × ${d.height} px`;
    el.title = `${d.dpi} dpi: prints at ${printLabel(d.width, d.height, d.dpi)} (Image → Image size to change)`;
  }

  /** View → Grayscale view: the canvas on screen in grays, to judge light and dark; the artwork keeps its colours. */
  toggleGrayView() {
    this.grayView = !this.grayView;
    this.root.querySelector('.gray-chip').hidden = !this.grayView;
    this.render();
  }

  /** View → Hide panels (Tab): the tool bar and side panels make way for the canvas; floating windows stay. */
  togglePanels() {
    this.panelsHidden = !this.panelsHidden;
    this.root.querySelector('.ed-body').classList.toggle('panels-hidden', this.panelsHidden);
    this.root.querySelector('.panels-chip').hidden = !this.panelsHidden;
    if (!this.panelsHidden) { this.navStale = true; this.scheduleNav(); }  // the Navigator was not drawn while hidden
  }

  toggleMaskOverlay() {
    this.maskOverlay = !this.maskOverlay;
    store('maskOverlay', this.maskOverlay);
    this.render();
  }

  checker(ctx) {
    if (!this.checkerPattern) {
      const c = document.createElement('canvas');
      c.width = c.height = 16;
      const g = c.getContext('2d');
      g.fillStyle = '#ffffff'; g.fillRect(0, 0, 16, 16);
      g.fillStyle = '#d9d9de'; g.fillRect(0, 0, 8, 8); g.fillRect(8, 8, 8, 8);
      this.checkerPattern = ctx.createPattern(c, 'repeat');
    }
    return this.checkerPattern;
  }

  /** Redraws the overlay on the next frame (many pointer moves per frame cost one redraw). */
  drawOverlay() {
    if (!this.overlayRaf) this.overlayRaf = requestAnimationFrame(() => { this.overlayRaf = 0; this.paintOverlay(); });
  }

  /** The overlay canvas: selection, crop box, guides and perspective, brush outline, then the edge rulers. */
  paintOverlay() {
    const ctx = this.octx;
    if (!ctx || this.destroyed) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.overlay.width, this.overlay.height);
    this.drawPixelGrid(ctx);
    this.drawSelectionOverlay(ctx);
    this.drawCropOverlay(ctx);
    this.drawRulerOverlay(ctx);
    this.drawSymmetryOverlay(ctx);
    this.drawGradientOverlay(ctx);
    this.drawFigurePoly(ctx);
    this.drawLineEditOverlay(ctx);
    this.drawCloneOverlay(ctx);
    this.placeTextEditor();
    this.placeSelectionBar();
    const brush = this.updateCursor(), sizing = this.gesture?.type === 'brushsize' ? this.gesture : null;
    if (brush) this.drawBrushOutline(ctx, brush, sizing ? sizing.start : this.pointer, !!sizing);
    if (this.gesture?.type === 'pick' && this.pointer) this.drawPickRing(ctx, this.gesture.before, this.colors.main);
    this.drawEdgeRulers(ctx);
  }

  /** Sets the pointer's cursor; returns the paint tool when the brush outline should be drawn instead. */
  updateCursor() {
    const set = c => { if (c && this.overlay.style.cursor !== c) this.overlay.style.cursor = c; };
    const rc = this.rulerCursor(this.pointer);
    if (rc) return set(rc);
    if (this.xf && !this.xf.moveOnly && !this.held.space && this.gesture?.type !== 'pan') {
      if (this.gesture?.type !== 'xf') set(this.pointer ? this.xfCursor(toDoc(this.view, this.pointer.x, this.pointer.y)) : 'default');
      return null;
    }
    if (this.findPick) { set('crosshair'); return null; }
    const tool = TOOL_BY_ID[this.effectiveTool()] || TOOL_BY_ID.move;
    if (tool.kind === 'crop') { if (!this.gesture) set(this.cropCursor()); return null; }
    set({ paint: 'none', smudge: 'none', liquify: 'none', retouch: 'none', lineedit: 'crosshair', lassofill: 'crosshair', fill: 'crosshair', gradient: 'crosshair', figure: 'crosshair', text: 'text', picker: 'crosshair', move: 'move', select: 'crosshair', ruler: 'default',
      hand: this.gesture?.type === 'pan' ? 'grabbing' : 'grab' }[tool.kind]);
    return this.pointer && (tool.kind === 'paint' || tool.kind === 'smudge' || tool.kind === 'liquify' || tool.kind === 'retouch') ? tool : null;
  }

  /** While picking a colour: a ring round the pointer, the new colour on top and the one before below. */
  drawPickRing(ctx, before, now) {
    const dpr = this.dpr || 1, x = this.pointer.x * dpr, y = this.pointer.y * dpr, r = 44 * dpr, w = 16 * dpr;
    ctx.save();
    ctx.lineWidth = w;
    for (const [color, a0, a1] of [[now, Math.PI, 2 * Math.PI], [before, 0, Math.PI]]) {
      ctx.strokeStyle = color;
      ctx.beginPath(); ctx.arc(x, y, r, a0, a1); ctx.stroke();
    }
    // a light and a dark edge, so the ring shows on any colour (also when the new colour is the canvas's own)
    for (const [color, lw, d] of [['rgba(255,255,255,0.9)', 1.5, 0.75], ['rgba(0,0,0,0.6)', 1, 2]]) {
      ctx.lineWidth = lw * dpr;
      ctx.strokeStyle = color;
      for (const rr of [r - w / 2 - d * dpr, r + w / 2 + d * dpr]) { ctx.beginPath(); ctx.arc(x, y, rr, 0, 2 * Math.PI); ctx.stroke(); }
    }
    ctx.restore();
  }

  drawBrushOutline(ctx, tool, at, label = false) {
    const dpr = this.dpr || 1, size = this.settings[tool.id].size;
    const r = Math.max(1, (size * this.view.zoom) / 2) * dpr;
    const x = at.x * dpr, y = at.y * dpr;
    if (label) {  // Ctrl+Alt+drag: the size, next to the circle
      const text = fmt('size', size);
      ctx.font = `${12 * dpr}px system-ui, sans-serif`;
      ctx.textBaseline = 'middle';
      const w = ctx.measureText(text).width + 10 * dpr, lx = x - w / 2, ly = Math.max(10 * dpr, y - r - 14 * dpr);
      ctx.fillStyle = 'rgba(0,0,0,0.7)';
      ctx.fillRect(lx, ly - 9 * dpr, w, 18 * dpr);
      ctx.fillStyle = '#fff';
      ctx.fillText(text, lx + 5 * dpr, ly);
    }
    // the tip's own shape: squashed and turned as set (in the view's turn and mirror), or an image tip's outline;
    // a tip that turns by itself (with the stroke, at random, with the pen) shows as the circle it stays within
    const s = this.settings[tool.id], turns = s.tipFollow || s.tipRandom > 0 || s.tiltAngle;
    const squash = turns || s.pixel ? 1 : Math.max(0.05, Math.min(1, s.thickness ?? 1));
    const [A, B, C, D] = matrix(this.view), z = this.view.zoom;
    const frame = () => {  // device px at the pointer, doc directions: the view's turn and mirror, then the tip's angle
      ctx.setTransform(A / z, B / z, C / z, D / z, x, y);
      if (!turns) ctx.rotate((s.tipAngle || 0) * Math.PI / 180);
      ctx.scale(1, squash);
    };
    const outline = !turns && !s.pixel && r >= 4 * dpr ? tipOutline(s.tip, 2 * r) : null;
    ctx.save();
    if (outline) {
      frame();
      const { canvas: c, k } = outline;
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(c, -c.width * k / 2, -c.height * k / 2, c.width * k, c.height * k);
    } else {
      ctx.lineWidth = 1 * dpr;
      for (const [color, rr] of [['rgba(0,0,0,0.75)', r + dpr], ['rgba(255,255,255,0.9)', r]]) {
        frame();
        ctx.beginPath(); ctx.ellipse(0, 0, rr, (r * squash + rr - r) / squash, 0, 0, Math.PI * 2);  // the dark ring 1 px outside all round
        ctx.setTransform(1, 0, 0, 1, 0, 0);  // the line itself stays 1 px whatever the squash
        ctx.strokeStyle = color;
        ctx.stroke();
      }
    }
    ctx.restore();
    if (r < 4 * dpr) {  // tiny brush: add a crosshair so the cursor stays visible
      ctx.strokeStyle = 'rgba(0,0,0,0.8)';
      ctx.beginPath();
      ctx.moveTo(x - 7 * dpr, y); ctx.lineTo(x - 3 * dpr, y); ctx.moveTo(x + 3 * dpr, y); ctx.lineTo(x + 7 * dpr, y);
      ctx.moveTo(x, y - 7 * dpr); ctx.lineTo(x, y - 3 * dpr); ctx.moveTo(x, y + 3 * dpr); ctx.lineTo(x, y + 7 * dpr);
      ctx.stroke();
    }
  }

  // ---------- view ----------

  setView(v) { this.view = v; this.render(); this.drawOverlay(); }
  fit() { this.setView(fitView(this.doc.width, this.doc.height, this.vw, this.vh)); }
  /** View → Zoom to selection: the selected part fills the window (keeping the view's turn and mirror). */
  zoomToSelection() { if (this.sel.active) this.setView(fitRectView(this.view, this.sel.bounds, this.vw, this.vh)); }
  actual() { this.setView(actualSize(this.view, this.vw, this.vh)); }
  zoomStep(dir) {
    const z = this.view.zoom;
    const next = dir > 0 ? ZOOM_STEPS.find(s => s > z * 1.001) : [...ZOOM_STEPS].reverse().find(s => s < z / 1.001);
    if (next) this.setView(zoomAt(this.view, next / z, this.vw / 2, this.vh / 2));
  }
  rotate(deg) {
    const rad = deg === null ? -this.view.rot : deg * Math.PI / 180;
    this.setView(rotateAt(this.view, rad, this.vw / 2, this.vh / 2));
  }
  flipView() { this.setView(flipAt(this.view, this.vw / 2, this.vh / 2)); }

  // ---------- tools ----------

  selectTool(id) {
    if (!TOOL_BY_ID[id]) return;
    if (this.tool === 'crop' && id !== 'crop') this.cancelCrop();
    if (id !== 'text') this.finishText();
    this.cancelPolygon();
    this.cancelFigurePoly();
    this.tool = id;
    if (id !== 'fill' && id !== 'wand') {  // their kept copies of the pixels (sampleData); brushes that stay inside lines use refRead
      this.compRead = null;
      if (!this.settings[id]?.refStop) this.refRead = this.insideClip = null;
    }
    else this.prepareSample(id);
    if (id === 'crop' && !this.crop) this.startCrop();
    store('tool', id);
    this.root.querySelectorAll('[data-tool]').forEach(b => b.classList.toggle('active', b.dataset.tool === id));
    this.renderToolProps();
    this.drawOverlay();
  }

  /** The tool in use right now, counting held keys (Space = hand, Alt = eyedropper) and the pen's eraser end. */
  effectiveTool() {
    if (this.gesture?.tool) return this.gesture.tool;
    if (this.held.space) return 'hand';
    const kind = TOOL_BY_ID[this.tool].kind;
    if (this.held.alt && (kind === 'paint' || kind === 'fill')) return 'picker';
    return this.tool;
  }

  renderToolProps() {
    const t = TOOL_BY_ID[this.tool], s = this.settings[t.id];
    this.root.querySelector('.tool-title').textContent = t.label;
    const box = this.root.querySelector('.tool-props');
    this.renderBrushWindow();
    this.renderBrushList();
    const fields = this.visibleFields(s);
    if (t.kind === 'ruler') return this.renderRulerProps(box);
    if (!fields.length) {
      box.innerHTML = `<p class="hint">${t.kind === 'picker' ? 'Click the canvas to pick a color. Hold Alt with a brush to pick quickly.'
        : t.kind === 'move' ? 'Drag to move the current layer, or only the selected pixels when there is a selection. Ctrl+drag picks the layer under the pointer first; right-click lists the layers there.'
        : t.kind === 'crop' ? 'Drag the edges or corners of the box (Shift keeps proportions), drag inside to move it, or drag outside to draw a new box. Enter crops, Esc leaves.' : 'Drag to move the view. Hold Space with any tool to do the same.'}</p>`;
      return;
    }
    if (t.kind === 'paint') {  // paint tools: the saved-brush row and the basics; everything else is in the Brush settings window
      const basic = BASIC_PAINT.map(k => fields.find(f => f[0] === k)).filter(Boolean);
      box.innerHTML = this.presetRowHtml(s) + this.settingsHtml(basic, s) +
        `<div class="btn-row"><button data-brush-win class="${this.brushWin ? 'on' : ''}" title="Tip, pen pressure, stroke, variation and texture settings">${icon('sliders', 14)} Brush settings…</button></div>`;
      this.bindPresetRow(box);
      box.querySelector('[data-brush-win]').onclick = () => this.toggleBrushWindow();
      this.drawBrushPreview();  // the stroke strip under the Brush row
    } else box.innerHTML = this.settingsHtml(fields, s);
    if (t.kind === 'picker') box.insertAdjacentHTML('beforeend', '<p class="hint">Click the canvas to pick a colour. Hold Alt with a brush to pick quickly (with these settings).</p>');
    if (t.kind === 'lineedit') this.renderLineEditProps(box);
    if (t.kind === 'retouch') box.insertAdjacentHTML('beforeend', `<p class="hint">${t.id === 'clone' ? 'Ctrl+click where to copy from, then paint to copy it here.'
      : t.id === 'blur' ? 'Paint over the picture to soften it.' : `Paint over the picture to ${t.id === 'burn' ? 'darken' : 'lighten'} it; low strength builds up gently.`}</p>`);
    if (t.kind === 'select') {
      box.insertAdjacentHTML('beforeend', `<div class="btn-row">
        <button data-sel="all" title="Ctrl+A">All</button><button data-sel="none" title="Ctrl+D">Deselect</button>
        <button data-sel="invert" title="Ctrl+Shift+I">Invert</button><button data-sel="xf" title="Ctrl+T">Transform</button></div>
        <p class="hint">${t.id === 'polygon' ? 'Click each corner; double-click, Enter or a click on the first corner closes the shape. Backspace removes the last corner, Esc drops it. ' : ''}Shift adds to the selection, Alt subtracts, Shift+Alt keeps the overlap.</p>`);
      const acts = { all: () => this.selectAll(), none: () => this.deselect(), invert: () => this.invertSelection(), xf: () => this.beginTransform() };
      box.querySelectorAll('[data-sel]').forEach(b => { b.onclick = () => acts[b.dataset.sel](); });
    }
    if (t.kind === 'gradient') {
      box.insertAdjacentHTML('afterbegin', '<canvas class="grad-strip" title="The colours this gradient will use"></canvas>');
      box.insertAdjacentHTML('beforeend', '<div class="btn-row"><button data-grad-edit title="Make your own gradient from any colours, or change one you made">Edit gradient…</button></div>');
      box.querySelector('[data-grad-edit]').onclick = () => this.gradientEditor();
    }
    this.bindSettings(box);
    this.drawGradientStrip();
  }

  /** The settings of a tool worth showing: the grain settings only with a texture chosen, curves only when set. */
  visibleFields(s) {
    // the Figure tool shows only the settings of the shape it draws
    const shapeOnly = { corner: ['rect'], sides: ['regpoly', 'star'], depth: ['star'] };
    return SETTING_FIELDS.filter(f => f[0] in s && f[2] !== 'id' && !(f[2] === 'curve' && !s[f[0]])
      && !(shapeOnly[f[0]] && 'figure' in s && !shapeOnly[f[0]].includes(s.figure))
      && !(s.texture === 'none' && ['textureAmount', 'textureScale', 'textureInvert'].includes(f[0]))
      && !(s.comboTip === 'none' && f[0].startsWith('combo') && f[0] !== 'comboTip'));  // the second brush's settings once it is on
  }

  /** Rows for some settings: sliders and choices first, the check boxes together under them. */
  settingsHtml(fs, s) {
    const tip = key => (SETTING_HINTS[key] ? ` title="${esc(SETTING_HINTS[key])}"` : '');
    const options = (key, list) => key === 'tip' ? this.tipChoices() : key === 'dualTip' || key === 'comboTip' ? [['none', 'Off'], ...this.tipChoices()] : key === 'texture' ? this.textureChoices() : key === 'colors' ? gradientChoices(this.userGrads()) : list;
    const row = ([key, label, type, min, max, step]) => type === 'curve'
      ? `<div class="slider curve-row"${tip(key)}><span>${esc(label)}</span>${curveSvg(s[key])}<button class="icon-btn" data-clear-curve="${key}" title="Remove the curve (use the Pressure setting instead)">✕</button></div>`
      : type === 'choice'
      ? `<label class="slider"${tip(key)}><span>${esc(label)}</span><select data-k="${key}">${options(key, min).map(([v, l]) => `<option value="${esc(v)}" ${s[key] === v ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></label>`
      : `<label class="slider"${tip(key)}><span>${esc(label)}</span><input type="range" data-k="${key}" min="${key === 'size' ? 0 : min}" max="${key === 'size' ? 1000 : max}" step="${key === 'size' ? 1 : step}" value="${key === 'size' ? sizeToSlider(s.size) : s[key]}"><output>${fmt(key, s[key])}</output></label>`;
    const check = ([key, label]) => `<label class="check"${tip(key)}><input type="checkbox" data-k="${key}" ${s[key] ? 'checked' : ''}> ${esc(label)}</label>`;
    const checks = fs.filter(f => f[2] === 'check');
    return fs.filter(f => f[2] !== 'check').map(row).join('') + (checks.length ? `<div class="checks">${checks.map(check).join('')}</div>` : '');
  }

  /** Makes the setting controls in box change the current tool; the same setting shown elsewhere follows. */
  bindSettings(box) {
    const t = TOOL_BY_ID[this.tool], s = this.settings[t.id];
    box.querySelectorAll('input[data-k], select[data-k]').forEach(inp => {
      inp.addEventListener(inp.tagName === 'SELECT' ? 'change' : 'input', () => {
        const k = inp.dataset.k;
        s[k] = inp.type === 'checkbox' ? inp.checked : inp.tagName === 'SELECT' ? inp.value : k === 'size' ? sliderToSize(+inp.value) : +inp.value;
        const out = inp.parentElement.querySelector('output');
        if (out) out.textContent = fmt(k, s[k]);
        store('tools', this.settings);
        if (t.id === 'text') this.textSettingsChanged(k);
        if (k === 'sample' && (t.id === 'fill' || t.id === 'wand')) this.prepareSample(t.id);  // the other pixels, ready too
        if (k === 'texture' || k === 'figure' || k === 'comboTip') this.renderToolProps();  // which settings show depends on these
        else this.showSetting(k, inp);
        this.drawBrushPreview();
        this.drawGradientStrip();
        this.drawOverlay();
      });
    });
    box.querySelectorAll('[data-clear-curve]').forEach(b => {
      b.onclick = e => {
        e.preventDefault();
        s[b.dataset.clearCurve] = null;
        store('tools', this.settings);
        this.renderToolProps();
      };
    });
  }

  /** Puts a setting's current value into its other controls (the tool panel and the Brush settings window), except `from`. */
  showSetting(k, from = null) {
    const s = this.settings[this.tool];
    for (const box of [this.root.querySelector('.tool-props'), this.brushWin?.querySelector('.bw-body')]) {
      box?.querySelectorAll(`[data-k="${k}"]`).forEach(inp => {
        if (inp === from) return;
        if (inp.type === 'checkbox') inp.checked = !!s[k];
        else inp.value = k === 'size' ? sizeToSlider(s.size) : s[k];
        const out = inp.parentElement.querySelector('output');
        if (out) out.textContent = fmt(k, s[k]);
      });
    }
  }

  setSize(size) {
    const s = this.settings[this.tool];
    if (!('size' in s)) return;
    s.size = size;
    store('tools', this.settings);
    this.renderToolProps();
    this.drawOverlay();
  }

  // ---------- pointer input ----------

  bindPointer() {
    const el = this.overlay;
    const pos = e => {
      const r = this.viewport.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    const pressure = e => e.pointerType === 'mouse' ? 1 : e.pointerType === 'pen' ? adjustPressure(this.pressureCurve, e.pressure || 0.01) : (e.pressure || 1);
    // a point for painting: position, pressure, pen tilt (t, and az: the way it leans, as a doc direction) and speed
    const penPoint = (e, q) => {
      const pt = { ...toDoc(this.view, q.x, q.y), p: pressure(e) };
      const { t, az } = e.pointerType === 'pen' ? tiltFrom(e.tiltX, e.tiltY) : { t: 0, az: null };
      pt.t = t;
      if (az === null) pt.az = null;
      else { const b = toDoc(this.view, q.x + Math.cos(az) * 16, q.y + Math.sin(az) * 16); pt.az = Math.atan2(b.y - pt.y, b.x - pt.x); }
      const tr = this.penTrack, dt = tr ? e.timeStamp - tr.time : 0;
      if (!tr) this.penTrack = { x: q.x, y: q.y, time: e.timeStamp, speed: 0 };
      else if (dt > 0) {  // screen px per ms, evened out over a few events
        tr.speed = tr.speed * 0.6 + (Math.hypot(q.x - tr.x, q.y - tr.y) / dt) * 0.4;
        tr.x = q.x; tr.y = q.y; tr.time = e.timeStamp;
      }
      pt.v = Math.min(1, this.penTrack.speed / SPEED_FULL);
      return pt;
    };
    el.addEventListener('contextmenu', e => e.preventDefault());
    // Fingers (touch screens): one finger uses the tool; a second one turns it into moving the view (pinch to zoom,
    // twist to turn, drag to pan), dropping a stroke the first finger had begun. A quick tap with two fingers
    // undoes, with three redoes. Touches while the pen or mouse is busy are ignored (a resting palm).
    this.touches = new Map();
    const touchView = () => {
      const g = this.gesture;
      if (g?.type === 'touchview') { g.count = Math.max(g.count, this.touches.size); return; }
      if (g && !g.touch) return;
      if (g?.type === 'paint') {  // the first finger's stroke was the start of a pinch
        clearTimeout(g.holdTimer);
        this.gesture = null;
        this.live = null;
        this.resetStroke();
        this.updateComp(g.bounds);
        this.requestRender();
      } else if (g) {
        const r = this.viewport.getBoundingClientRect();
        end({ pointerId: g.id, clientX: r.left + (this.pointer?.x || 0), clientY: r.top + (this.pointer?.y || 0) });
      }
      const [ia, ib] = [...this.touches.keys()];
      this.gesture = { type: 'touchview', ids: [ia, ib], a0: this.touches.get(ia), b0: this.touches.get(ib), view: { ...this.view }, t0: performance.now(), moved: false, count: this.touches.size };
    };
    el.addEventListener('pointerdown', e => {
      if (e.pointerType !== 'mouse') this.notePenUsed();  // the shortcut strip shows from then on
      if (e.pointerType === 'touch') {
        this.touches.set(e.pointerId, pos(e));
        if (this.touches.size >= 2) { touchView(); return; }
      }
      if (this.gesture) return;
      if (this.spring) this.spring.used = true;  // the held tool key's tool was used: back to the other on release
      try { el.setPointerCapture(e.pointerId); } catch { /* pointer already gone */ }
      const p = pos(e);
      this.pointer = p;
      if (e.button === 1) return this.beginPan(p, e.pointerId);
      if (e.button === 2 && !this.xf && this.effectiveTool() === 'move') return this.layerMenuAt(toDoc(this.view, p.x, p.y), e.clientX, e.clientY);
      if (e.button !== 0 && !(e.pointerType === 'pen' && e.button === 5)) return;
      const dp = { ...toDoc(this.view, p.x, p.y), p: pressure(e) };
      if (this.canvasPick) { this.canvasPick(dp); return; }  // a dialog takes canvas clicks (Color range, blur centre)
      if (e.ctrlKey && e.altKey && !this.xf && this.beginBrushSize(p, e.pointerId)) { this.drawOverlay(); return; }
      const band = this.xf ? null : this.rulerBand(p);
      if (band) { if (band !== 'corner') this.beginNewGuide(band, dp, e.pointerId); this.drawOverlay(); return; }
      if (this.xf && !this.held.space) { this.xfPointerDown(dp, e.pointerId, e.ctrlKey); this.drawOverlay(); return; }
      const penEraser = e.pointerType === 'pen' && (e.button === 5 || (e.buttons & 32));
      const toolId = penEraser ? 'eraser' : this.effectiveTool();
      const tool = TOOL_BY_ID[toolId];
      if (tool.kind === 'hand') this.beginPan(p, e.pointerId, e.shiftKey ? 'turn' : e.ctrlKey ? 'zoom' : 'pan');
      else if (tool.kind === 'select') this.beginSelect(toolId, GRID_TOOLS.has(toolId) ? this.gridPoint(dp) : dp, e.pointerId, e);
      else if (tool.kind === 'crop') this.beginCrop(this.gridPoint(dp), e.pointerId);
      else if (tool.kind === 'ruler') this.beginRulerTool(dp, e.pointerId);
      else if (tool.kind === 'move' && e.ctrlKey && !this.quickMask) { if (this.pickLayerAt(dp)) this.beginMove(dp, e.pointerId); }
      else if (tool.kind === 'move' && this.sel.active) {
        // with a selection, the Move tool moves only the selected pixels (a quick transform)
        if (this.beginTransform({ moveOnly: true })) this.gesture = { type: 'xf', tool: 'move', id: e.pointerId, grab: 'move', t0: { ...this.xf.t }, p0: dp };
      }
      else if (tool.kind === 'paint') { this.penTrack = null; this.beginPaint(toolId, penPoint(e, p), e.pointerId, e.shiftKey); }
      else if (tool.kind === 'smudge') this.beginSmudge(dp, e.pointerId);
      else if (tool.kind === 'liquify') this.beginLiquify(dp, e.pointerId);
      else if (tool.kind === 'retouch') this.beginRetouch(toolId, dp, e.pointerId, e.ctrlKey);
      else if (tool.kind === 'lineedit') this.beginLineEdit(dp, e.pointerId);
      else if (tool.kind === 'lassofill') this.beginLassoFill(dp, e.pointerId);
      else if (tool.kind === 'figure') this.beginFigure(this.gridPoint(dp), e.pointerId, e.shiftKey, e.detail >= 2);
      else if (tool.kind === 'fill') this.fillAt(dp);
      else if (tool.kind === 'gradient') this.beginGradient(dp, e.pointerId);
      else if (tool.kind === 'text') { e.preventDefault(); this.textClick(dp); }
      else if (tool.kind === 'picker') { this.gesture = { type: 'pick', tool: toolId, id: e.pointerId, before: this.colors.main }; this.pickAt(dp); }
      else if (tool.kind === 'move') this.beginMove(dp, e.pointerId);
      if (this.gesture && e.pointerType === 'touch') this.gesture.touch = true;
      this.drawOverlay();
    });
    el.addEventListener('pointermove', e => {
      const p = pos(e);
      this.pointer = p;
      this.pointerShift = e.shiftKey;
      const g = this.gesture;
      if (e.pointerType === 'touch' && this.touches.has(e.pointerId)) this.touches.set(e.pointerId, p);
      if (g?.type === 'touchview' && g.ids.includes(e.pointerId)) {
        const a1 = this.touches.get(g.ids[0]), b1 = this.touches.get(g.ids[1]);
        if (a1 && b1) {
          if (Math.hypot(a1.x - g.a0.x, a1.y - g.a0.y) + Math.hypot(b1.x - g.b0.x, b1.y - g.b0.y) > TAP_SLOP) g.moved = true;
          if (g.moved) {
            this.view = pinchView(g.view, g.a0, g.b0, a1, b1, TURN_DEAD);
            this.dirty = 'all';  // a new view: everything redraws, the paper layer too
            this.requestRender();
          }
        }
      } else if (g && g.id === e.pointerId) {
        if (g.type === 'paint' || g.type === 'smudge' || g.type === 'liquify' || g.type === 'retouch') {
          const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
          for (const ev of evs.length ? evs : [e]) {
            const q = pos(ev), pt = g.type === 'paint' ? penPoint(ev, q) : { ...toDoc(this.view, q.x, q.y), p: pressure(ev) };
            if (g.type === 'paint') this.addPoint(pt);
            else if (g.type === 'liquify') this.liquifyPoint(pt);
            else if (g.type === 'retouch') this.retouchPoint(pt);
            else this.smudgePoint(pt);
          }
          this.requestRender();
        } else if (g.type === 'verase') {
          this.vectorEraseTo({ ...toDoc(this.view, p.x, p.y), p: pressure(e) });
        } else if (g.type === 'lassofill') {
          this.lassoFillDrag(toDoc(this.view, p.x, p.y));
        } else if (g.type === 'pan') {
          this.panDrag(p);
        } else if (g.type === 'brushsize') {
          this.brushSizeDrag(p);
        } else if (g.type === 'pick') {
          this.pickAt(toDoc(this.view, p.x, p.y));
        } else if (g.type === 'move') {
          this.moveTo(toDoc(this.view, p.x, p.y));
        } else if (g.type === 'select') {
          const q = toDoc(this.view, p.x, p.y);
          this.selectDrag(GRID_TOOLS.has(g.tool) ? this.gridPoint(q) : q);
        } else if (g.type === 'xf') {
          this.xfDrag(toDoc(this.view, p.x, p.y), e.shiftKey, e.altKey);
        } else if (g.type === 'crop') {
          this.cropDrag(this.gridPoint(toDoc(this.view, p.x, p.y)), e.shiftKey);
        } else if (g.type === 'guide' || g.type === 'vp' || g.type === 'shape') {
          this.rulerDrag(toDoc(this.view, p.x, p.y), e.shiftKey);
        } else if (g.type === 'gradient') {
          this.gradientDrag(toDoc(this.view, p.x, p.y), e.shiftKey);
        } else if (g.type === 'lineedit') {
          this.lineEditDrag(toDoc(this.view, p.x, p.y));
        } else if (g.type === 'figure') {
          this.figureDrag(this.gridPoint(toDoc(this.view, p.x, p.y)), e.shiftKey);
        }
      }
      const dp = toDoc(this.view, p.x, p.y);
      this.cursorPos.textContent = `${Math.floor(dp.x)}, ${Math.floor(dp.y)}`;
      this.drawOverlay();
    });
    const end = e => {
      const g = this.gesture;
      if (!g || g.id !== e.pointerId) return;
      this.pointer = pos(e);
      if (g.type === 'paint') this.endPaint();
      else if (g.type === 'smudge') this.endSmudge();
      else if (g.type === 'liquify') this.endLiquify();
      else if (g.type === 'retouch') this.endRetouch();
      else if (g.type === 'lineedit') this.endLineEdit();
      else if (g.type === 'verase') this.endVectorErase();
      else if (g.type === 'lassofill') this.endLassoFill();
      else if (g.type === 'guide' || g.type === 'vp' || g.type === 'shape') this.rulerEnd(this.pointer);
      else if (g.type === 'gradient') this.endGradient();
      else if (g.type === 'figure') this.endFigure();
      else if (g.type === 'move') this.endMove();
      else if (g.type === 'select') this.endSelect();
      else if (g.type === 'brushsize') this.endBrushSize();
      this.gesture = null;
      if (g.type === 'xf') this.xfEnd();
      if (this.springAfter) { const t = this.springAfter; this.springAfter = null; this.selectTool(t); }
      this.drawOverlay();
    };
    const lift = e => {
      if (e.pointerType === 'touch') this.touches.delete(e.pointerId);
      const g = this.gesture;
      if (g?.type === 'touchview') {
        if (!g.ids.includes(e.pointerId)) return;
        this.gesture = null;  // the other fingers do nothing more until they are lifted too
        if (e.type === 'pointerup' && !g.moved && performance.now() - g.t0 < TAP_MS) g.count >= 3 ? this.redo() : this.undo();
        this.drawOverlay();
        return;
      }
      end(e);
    };
    el.addEventListener('pointerup', lift);
    el.addEventListener('pointercancel', lift);
    el.addEventListener('pointerleave', () => { if (!this.gesture) { this.pointer = null; this.drawOverlay(); } });
    el.addEventListener('wheel', e => {
      e.preventDefault();
      const p = pos(e);
      if (e.shiftKey && !e.ctrlKey) this.setView(rotateAt(this.view, Math.sign(e.deltaY || e.deltaX) * Math.PI / 12, p.x, p.y));
      else this.setView(zoomAt(this.view, Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)), p.x, p.y));
    }, { passive: false });
    // drop image files onto the canvas to add them as layers
    this.viewport.addEventListener('dragover', e => e.preventDefault());
    this.viewport.addEventListener('drop', async e => {
      e.preventDefault();
      for (const f of e.dataTransfer?.files || []) if (f.type.startsWith('image/')) await this.addImageLayer(await fileToDataUrl(f), f.name.replace(/\.[^.]+$/, ''));
    });
  }

  /**
   * Moving the view with the Hand (or Space held): a drag pans; with Shift (Shift+Space) it turns the view round
   * the middle of the window, with Ctrl (Ctrl+Space) it zooms in (right) or out (left) at where it began.
   */
  beginPan(p, id, how = 'pan') {
    this.gesture = { type: 'pan', how, tool: 'hand', id, start: p, view: { ...this.view } };
  }

  panDrag(p) {
    const g = this.gesture, v = g.view;
    if (g.how === 'turn') {
      const cx = this.vw / 2, cy = this.vh / 2;
      const a = Math.atan2(p.y - cy, p.x - cx) - Math.atan2(g.start.y - cy, g.start.x - cx);
      if (Math.hypot(p.x - cx, p.y - cy) < 8) return;  // too close to the middle to tell the angle
      this.view = rotateAt(v, a, cx, cy);
      this.dirty = 'all';
    } else if (g.how === 'zoom') {
      const k = Math.exp((p.x - g.start.x) * 0.01);
      const z = Math.min(64, Math.max(0.02, v.zoom * k));
      this.view = zoomAt(v, z / v.zoom, g.start.x, g.start.y);
      this.dirty = 'all';
    } else this.view = { ...v, panX: v.panX + p.x - g.start.x, panY: v.panY + p.y - g.start.y };
    this.requestRender();
  }

  /**
   * Ctrl+Alt+drag with a brush-like tool sets its size, as in Clip Studio Paint: the circle stays where the drag
   * began and its edge follows the pointer left and right. false when the tool has no size.
   */
  beginBrushSize(p, id) {
    const kind = TOOL_BY_ID[this.tool].kind, s = this.settings[this.tool];
    if (!['paint', 'smudge', 'liquify', 'retouch'].includes(kind) || !('size' in s)) return false;
    this.gesture = { type: 'brushsize', tool: this.tool, id, start: p, size0: s.size };
    return true;
  }

  brushSizeDrag(p) {
    const g = this.gesture, s = this.settings[g.tool];
    const r = g.size0 * this.view.zoom / 2 + (p.x - g.start.x);  // the circle's radius on screen
    s.size = Math.min(1000, Math.max(1, Math.round(2 * r / this.view.zoom * 10) / 10));
    this.showSetting('size');
  }

  endBrushSize() {
    store('tools', this.settings);
    this.drawBrushPreview();
  }

  // ---------- painting ----------

  /** Empties the stroke canvas and resets its drawing state. */
  resetStroke() {
    const c = this.strokeCtx;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.globalAlpha = 1;
    c.globalCompositeOperation = 'source-over';
    c.clearRect(0, 0, this.doc.width, this.doc.height);
  }

  /** Pen down. With Shift, the stroke starts as a straight line from where the last stroke on this layer ended. */
  beginPaint(toolId, pt, id, shift = false) {
    const tool = TOOL_BY_ID[toolId], s = this.settings[toolId];
    const layer = this.target(tool.erase ? 'erase' : 'draw on', { vector: true });
    if (!layer) return;
    if (layer.vector && tool.erase) return this.beginVectorErase(toolId, pt, id, layer);  // erases lines, not pixels
    this.resetStroke();
    const sizeAt = p => stampAt(s, p).size;
    // pen tilt and speed (vector lines keep them per point, so the kept line looks as drawn)
    const dyn = !!(s.tiltSize || s.tiltFlow || s.tiltAngle || s.speedSize || s.speedFlow);
    const reach = tipReach(hasTipImage(s.tip)) * 2 * (dyn ? dynamicsReach(s) : 1);
    const line = shift && this.lastStroke && this.lastStroke.layer === layer ? this.lastStroke.pt : null;
    // colour jitter: erasers and masks keep their black; per stroke the varied colour is picked once here
    const ink = tool.erase ? '#000000' : this.inkFor(layer), varies = !tool.erase && layer.kind !== 'mask' && !!colorJitter(s);
    const color = varies && s.colorJitterStroke ? shiftColor(ink, colorJitter(s)) : ink;
    // Impasto: the dabs are stamped faintly into a height canvas too, which liveSource lights
    const imp = tool.erase || layer.kind === 'mask' ? null : impastoFor(s, this.heightCanvas ||= document.createElement('canvas'));
    this.gesture = {
      type: 'paint', tool: toolId, id, s, sizeAt, reachAt: p => sizeAt(p) * reach, layer, dist: 0, prevStamp: null, held: [], bounds: null, last: pt, erase: !!tool.erase,
      color, dabColors: varies && !s.colorJitterStroke, dyn,
      painter: new Painter(this.strokeCtx, { color, hardness: s.hardness,
        tip: s.tip, thickness: s.thickness, angle: s.tipAngle, random: s.tipRandom, follow: s.tipFollow, pixel: s.pixel,
        grain: grainFor(s), height: imp && heightFor(imp.canvas, this.doc.width, this.doc.height) }),
      smoother: new Smoother(s.smoothing),
      path: new StampPath(sizeAt, s.spacing),
      snap: line ? null : this.snapFor(pt),  // follow a guide or perspective line (rulertools.js)
      raw: s.quickShape && !line ? [] : null,  // QuickShape: the pen's own path, to recognise a line or a loop
      dual: this.dualBrush(s, layer, sizeAt),  // the dual brush's own dabs, which the stroke shows through (or null)
      combo: layer.vector ? null : this.comboBrush(s, color),  // the second brush of a combined brush (or null)
      vec: layer.vector ? [] : null,  // on a vector layer: the smoothed path, kept as a line at pen-up (vectortools.js)
      // Color mixing: each dab picks up the layer's colours as they were at pen-down (read tile by tile, wetmix.js)
      wet: s.mix > 0 && !tool.erase && layer.kind !== 'mask' && !layer.vector ? { cache: this.pixelCache(layer.canvas), copies: [] } : null,
    };
    // vector lines are kept whole, so the selection does not cut them
    this.live = { layer, canvas: this.stroke, alpha: s.opacity, mode: this.strokeMode(layer, tool.erase), texture: textureFor(s), wet: wetFor(s), sel: this.sel.active && !layer.vector ? this.sel : null,
      impasto: imp,
      dual: this.gesture.dual ? this.dualCanvas : null,
      combo: this.gesture.combo?.canvas ? { canvas: this.gesture.combo.canvas, op: this.gesture.combo.op } : null,
      inside: s.refStop && !layer.vector ? this.insideLinesClip(line || pt, s.size / 2) : null };  // stay inside reference lines
    if (line) {
      this.addStampPoint({ ...line, p: pt.p });
      for (const q of linePoints({ ...line, p: pt.p }, pt, 3)) this.addStampPoint(q);
    } else this.addPoint(pt);
    this.requestRender();
  }

  /** A pen point: through ruler snapping (if any), then smoothing and stamping. */
  addPoint(pt) {
    const g = this.gesture;
    if (g.quick) { g.quick.to = pt; this.scheduleQuickShape(); return; }  // a snapped shape: the pen stretches it
    if (g.raw && !g.snap?.line) this.watchHold(pt);
    if (g.snap) { for (const q of this.snapPoint(g.snap, pt)) this.addStampPoint(q); return; }
    this.addStampPoint(pt);
  }

  /** QuickShape: remembers the pen's path and starts the hold timer again whenever the pen moves on. */
  watchHold(pt) {
    const g = this.gesture;
    g.raw.push({ x: pt.x, y: pt.y, p: pt.p });
    const slop = HOLD_PX / this.view.zoom;
    if (g.holdAt && Math.hypot(pt.x - g.holdAt.x, pt.y - g.holdAt.y) <= slop) return;
    g.holdAt = pt;
    clearTimeout(g.holdTimer);
    g.holdTimer = setTimeout(() => this.snapQuickShape(g), HOLD_MS);
  }

  /** The pen was held still: the stroke so far becomes a clean line or ellipse (when it looks like one). */
  snapQuickShape(g) {
    if (this.gesture !== g || g.quick) return;
    const shape = detectShape(g.raw);
    if (!shape) return;
    const ps = g.raw.map(q => q.p).sort((a, b) => a - b);
    g.quick = { base: shape, shape, from: g.raw[g.raw.length - 1], to: g.raw[g.raw.length - 1], p: ps[Math.floor(ps.length / 2)] };
    this.redrawQuickShape();
  }

  scheduleQuickShape() {
    const g = this.gesture;
    if (g.quickRaf) return;
    g.quickRaf = requestAnimationFrame(() => { g.quickRaf = 0; if (this.gesture === g) this.redrawQuickShape(); });
  }

  /** Stamps the snapped shape afresh (stretched to where the pen is now) in place of the stroke. */
  redrawQuickShape() {
    const g = this.gesture, q = g.quick, old = g.bounds;
    q.shape = adjustShape(q.base, q.from, q.to);
    this.resetStroke();
    g.path = new StampPath(g.sizeAt, g.s.spacing);
    if (g.dual) {  // the freehand dual dabs would otherwise still let paint through along the old path
      g.dual.painter.ctx.clearRect(0, 0, this.doc.width, this.doc.height);
      g.dual.path = new StampPath(g.dual.sizeAt, g.s.dualSpacing);
      g.dual.painter.last = [];
    }
    g.smoother = new Smoother(0);
    g.prevStamp = null; g.dist = 0; g.held = []; g.bounds = null;
    if (g.wet) g.wet.copies = [];
    if (g.combo) { g.combo.path = new StampPath(g.combo.sizeAt, g.combo.s.spacing); g.combo.painter.last = []; }
    g.painter.last = [];
    if (g.vec) g.vec = [];
    for (const pt of shapePoints(q.shape, q.p, 1)) this.addStampPoint(pt);
    if (old) this.updateComp(old);
    this.requestRender();
  }

  addStampPoint(pt) {
    const g = this.gesture;
    g.last = pt;
    const sp = g.smoother.add(pt);
    if (g.vec) g.vec.push(g.dyn ? [sp.x, sp.y, sp.p, Math.round((sp.t || 0) * 1000) / 1000, Math.round((sp.v || 0) * 1000) / 1000, sp.az ?? null] : [sp.x, sp.y, sp.p]);
    if (g.dual) this.addDualStamps(sp);
    const steps = g.path.add(sp);
    if (!steps.length) { if (g.combo) this.addComboStamps(sp); return; }
    const count = Math.max(1, Math.round(g.s.count || 1));
    const stamps = count === 1 ? steps : steps.flatMap(st => Array.from({ length: count }, () => ({ ...st })));
    stamps.forEach((st, n) => {  // distance along the stroke (for the taper) and random variation; symmetric copies share it
      if (n % count === 0) {
        if (g.prevStamp) g.dist += Math.hypot(st.x - g.prevStamp.x, st.y - g.prevStamp.y);
        g.prevStamp = { x: st.x, y: st.y };
      }
      const j = dabJitter(g.s, stampAt(g.s, st.p).size);
      st.x += j.dx; st.y += j.dy;
      st.k = j.sizeK * taperIn(g.dist, g.s.taperIn);
      st.f = j.flowK;
      st.d = g.dist;
      if (g.dyn) {  // pen tilt and speed (Brush settings, Tilt and speed page)
        const k = dynamicsAt(g.s, st.t, st.v);
        st.k *= k.sizeK;
        st.f *= k.flowK;
        if (g.s.tiltAngle && st.az != null) st.a = st.az;
      }
      if (g.dabColors) st.c = shiftColor(g.color, colorJitter(g.s));
    });
    if (g.s.taperOut > 0) {  // the end taper holds the last stretch back until the pen lifts
      const r = releaseHeld([...g.held, ...stamps], g.dist, g.s.taperOut);
      g.held = r.held;
      this.drawStamps(r.ready);
    } else this.drawStamps(stamps);
    if (g.combo) this.addComboStamps(sp);  // after the first brush's dabs, so its combine mode goes over them
  }

  /**
   * The second brush of a combined brush (Brush settings → Combined, combo.js): its own path, spacing, jitter and tip
   * along the same smoothed points, in the stroke's colour. In Normal mode it dabs straight into the stroke canvas;
   * other modes dab into this.comboCanvas, which liveSource blends over the stroke with the comboMode operation
   * (a blend mode dab by dab on the big stroke canvas cost gigabytes of GPU memory).
   */
  comboBrush(s, color) {
    const c = comboSettings(s);
    if (!c) return null;
    const sizeAt = p => stampAt(c, p).size, op = comboOp(s.comboMode);
    let canvas = null, ctx = this.strokeCtx;
    if (op !== 'source-over') {
      const d = this.doc;
      canvas = this.comboCanvas ||= document.createElement('canvas');
      if (canvas.width !== d.width || canvas.height !== d.height) { canvas.width = d.width; canvas.height = d.height; }
      ctx = canvas.getContext('2d');
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
      ctx.clearRect(0, 0, d.width, d.height);
    }
    return {
      s: c, sizeAt, op, canvas, path: new StampPath(sizeAt, c.spacing),
      painter: new Painter(ctx, { color, hardness: c.hardness, tip: c.tip, thickness: c.thickness, angle: c.tipAngle,
        random: c.tipRandom, follow: c.tipFollow, pixel: c.pixel }),
      reachAt: p => sizeAt(p) * tipReach(hasTipImage(c.tip)) * 2 * (1 + c.scatter),
    };
  }

  addComboStamps(sp) {
    const g = this.gesture, c = g.combo, stamps = c.path.add(sp);
    if (!stamps.length) return;
    for (const st of stamps) {
      const j = dabJitter(c.s, c.sizeAt(st.p));
      st.x += j.dx; st.y += j.dy; st.k = j.sizeK; st.f = j.flowK;
    }
    const all = symmetryStamps(this.doc.rulers.symmetry, stamps, this.doc.width, this.doc.height);
    const per = all.length / stamps.length;
    all.forEach((st, i) => {
      const { size, flow } = stampAt(c.s, st.p);
      c.painter.dab(st.x, st.y, size * st.k, flow * st.f, i % per);
    });
    const r = stampBounds(all, c.reachAt);
    g.bounds = union(g.bounds, r);
    this.strokeVersion = (this.strokeVersion || 0) + 1;
    this.updateComp(r);
  }

  /**
   * The dual brush for a stroke (Brush settings → Dual brush): its tip dabbed in black along the same path into
   * this.dualCanvas, at its own size, spacing and scatter; liveSource keeps the stroke only where those dabs are.
   * null when it is off. Vector lines keep the dual tip in their brush and redraw it from their seed (vector.js dualStamps).
   */
  /**
   * Where a stroke with Stay inside lines may paint: the shape of the reference layers' line art it starts in
   * (insideLines in fill.js), as a canvas liveSource cuts the stroke to; null (paint anywhere) without reference
   * layers or with only lines round the start. A stroke starting in the same shape again reuses it.
   */
  insideLinesClip(pt, reach) {
    if (!referenceLayers(this.doc.root).length) {
      if (!this.refStopNoted) toast('Stay inside lines needs line art to stop at: tick Reference on your line art layer in the Layers panel.', { ms: 6000 });
      this.refStopNoted = true;
      return null;
    }
    const d = this.doc, W = d.width, H = d.height, data = this.referencePixels();
    if (!data) return null;
    const k = this.insideClip, x = Math.floor(pt.x), y = Math.floor(pt.y);
    if (k && k.data === data && x >= 0 && y >= 0 && x < W && y < H && k.mask[y * W + x]) return k.canvas;
    const res = insideLines(data, W, H, pt.x, pt.y, Math.max(2, reach));
    if (!res) return null;
    const { mask, bounds: b } = res, img = new ImageData(b.w, b.h);
    for (let yy = 0; yy < b.h; yy++) {
      const row = (b.y + yy) * W + b.x;
      for (let xx = 0; xx < b.w; xx++) if (mask[row + xx]) img.data[(yy * b.w + xx) * 4 + 3] = 255;
    }
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    c.getContext('2d').putImageData(img, b.x, b.y);
    this.insideClip = { data, mask, canvas: c };
    return c;
  }

  dualBrush(s, layer, sizeAt) {
    if (!s.dualTip || s.dualTip === 'none') return null;
    const d = this.doc, c = this.dualCanvas ||= document.createElement('canvas');
    if (c.width !== d.width || c.height !== d.height) { c.width = d.width; c.height = d.height; }
    const ctx = c.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.clearRect(0, 0, d.width, d.height);
    const dualSizeAt = p => Math.max(0.5, sizeAt(p) * s.dualSize);
    return {
      sizeAt: dualSizeAt, path: new StampPath(dualSizeAt, s.dualSpacing),
      painter: new Painter(ctx, { color: '#000000', hardness: s.hardness, tip: s.dualTip }),
      reachAt: p => dualSizeAt(p) * tipReach(hasTipImage(s.dualTip)) * 2 * (1 + s.dualScatter),
    };
  }

  /** The dual brush's dabs for a smoothed point (with their symmetric copies); what they uncover is redrawn. */
  addDualStamps(sp) {
    const g = this.gesture, du = g.dual;
    const stamps = du.path.add(sp);
    if (!stamps.length) return;
    for (const st of stamps) {
      const j = dabJitter({ scatter: g.s.dualScatter }, du.sizeAt(st.p));
      st.x += j.dx; st.y += j.dy;
    }
    const all = symmetryStamps(this.doc.rulers.symmetry, stamps, this.doc.width, this.doc.height);
    const per = all.length / stamps.length;
    all.forEach((st, i) => du.painter.dab(st.x, st.y, du.sizeAt(st.p), 1, i % per));
    this.updateComp(stampBounds(all, du.reachAt));
  }

  /** Dabs a stroke's stamps (with their symmetric copies) into the stroke canvas and recomposites them. */
  drawStamps(stamps) {
    const g = this.gesture;
    if (!stamps.length) return;
    const all = symmetryStamps(this.doc.rulers.symmetry, stamps, this.doc.width, this.doc.height);
    const per = all.length / stamps.length;  // copies of each stamp, in order
    all.forEach((st, i) => {
      const { size, flow } = stampAt(g.s, st.p);
      const wet = g.wet ? this.wetColor(g, st, size * st.k, i % per) : null;
      g.painter.dab(st.x, st.y, size * st.k, flow * st.f * (wet ? wet.share : 1), i % per, wet ? wet.color : st.c, st.a ?? null);
    });
    const r = stampBounds(all, g.reachAt);
    g.bounds = union(g.bounds, r);
    this.strokeVersion = (this.strokeVersion || 0) + 1;
    this.updateComp(r);
  }

  /**
   * Color mixing: {color, share} of a dab of diameter size: its brush colour mixed with what it passes over (per
   * symmetric copy k), and the share of its density it keeps (loadShare: Paint load and how much colour it picked up).
   */
  wetColor(g, st, size, k) {
    const [r, gr, b] = hexToRgb(st.c || g.color), cache = g.wet.cache;
    const paint = g.wet.copies[k] ||= new WetPaint(g.s.mix, g.s.mixStretch);
    const color = rgbHex(paint.next(st.x, st.y, size, averageUnder((x, y) => cache.pixel(x, y), st.x, st.y, size), { r, g: gr, b }));
    return { color, share: loadShare(g.s.paintLoad, paint.picked.cover) };
  }

  endPaint() {
    const g = this.gesture;
    clearTimeout(g.holdTimer);
    if (g.quickRaf) { cancelAnimationFrame(g.quickRaf); g.quickRaf = 0; this.redrawQuickShape(); }
    // a short dab never picked a snap line: paint what was held back as it was
    if (g.snap && !g.snap.line) for (const q of g.snap.held) this.addStampPoint(q);
    // stabilization lags behind the pen: catch up to where the pen was lifted
    if (g.s.smoothing && g.last) for (let i = 0; i < 400 && g.smoother.distanceTo(g.last) > 0.5; i++) this.addStampPoint(g.last);
    // the end is known now: the held-back stamps thin out towards it
    for (const st of g.held) st.k *= taperOut(g.dist - st.d, g.s.taperOut);
    this.drawStamps(g.held);
    g.held = [];
    this.lastStroke = { layer: g.layer, pt: g.last };
    if (g.vec) this.commitVectorStroke(g.layer, g.vec, g.s, g.s.opacity, 'Draw line', g.color);
    else this.commitStroke(g.layer, g.bounds, g.erase ? 'Erase' : 'Paint');
    if (!g.erase && g.layer.kind !== 'mask') this.colors.used();
  }

  /** Applies the stroke canvas (this.live) to its layer inside rect r, recording it for undo. */
  commitStroke(layer, r, label) {
    const live = this.live;
    this.live = null;
    r = clip(r, this.doc.width, this.doc.height);
    if (!live || !r) { this.updateComp(r); this.requestRender(); return; }
    // GPU copies, not getImageData: a readback would wait for all the drawing the GPU still has queued
    const before = this.snapshot(layer, r);
    const ctx = layer.ctx;
    ctx.save();
    ctx.globalAlpha = live.alpha;
    ctx.globalCompositeOperation = live.mode;
    ctx.drawImage(...liveSource(live, r), r.w, r.h, r.x, r.y, r.w, r.h);
    ctx.restore();
    const after = this.snapshot(layer, r);
    this.pushPatch(layer, r, before, after, label);
    layer.touch();
    this.changed(r);
  }

  /**
   * A copy of rect r of a layer for undo, taken on the GPU (no waiting): {canvas}. When the editor is idle it is read
   * into memory so undo history does not hold GPU memory (readSnapshots), cut down to its painted part (`box`, in r;
   * null when all clear): a Move on a big, mostly empty layer then keeps megabytes, not hundreds of them.
   */
  snapshot(layer, r) {
    const c = document.createElement('canvas');
    c.width = r.w; c.height = r.h;
    c.getContext('2d').drawImage(layer.canvas, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h);
    const snap = { canvas: c, data: null, box: null, w: r.w, h: r.h };
    (this.snapQueue ||= []).push(snap);
    if (!this.snapIdle) this.snapIdle = requestIdleCallback(dl => this.readSnapshots(dl), { timeout: 4000 });
    return snap;
  }

  /** Turns queued GPU snapshots into (trimmed) ImageData while nothing is being drawn. */
  readSnapshots(deadline) {
    this.snapIdle = 0;
    const q = this.snapQueue || [];
    while (q.length && !this.gesture && (deadline.didTimeout || deadline.timeRemaining() > 4)) {
      const s = q.shift();
      const c = s.canvas;
      if (!c) continue;
      Object.assign(s, trimmedSnapshot(c.getContext('2d').getImageData(0, 0, s.w, s.h)));
      // free its GPU memory now: a dropped canvas waits for garbage collection, which a small JS heap rarely runs
      c.width = c.height = 0;
    }
    if (q.length && !this.destroyed) this.snapIdle = requestIdleCallback(dl => this.readSnapshots(dl), { timeout: 4000 });
  }

  /** Records a pixel change of rect r for undo; before/after are ImageData or snapshots. */
  pushPatch(layer, r, before, after, label) {
    // pixels read already (filters, Smudge) are kept only where painted, as snapshots are once read (readSnapshots)
    if (before instanceof ImageData) before = trimmedSnapshot(before);
    if (after instanceof ImageData) after = trimmedSnapshot(after);
    const put = img => { this.putSnapshot(layer, r, img); this.changed(r); };
    this.history.push({ label, get bytes() { return snapBytes(before) + snapBytes(after); }, undo: () => put(before), redo: () => put(after) });
  }

  /** Puts an ImageData or a snapshot back into rect r of a layer (all of r: what the snapshot lacks is cleared). */
  putSnapshot(layer, r, img) {
    const ctx = layer.ctx;
    if (img instanceof ImageData) ctx.putImageData(img, r.x, r.y);
    else if (img.canvas) {
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'copy';
      ctx.beginPath(); ctx.rect(r.x, r.y, r.w, r.h); ctx.clip();
      ctx.drawImage(img.canvas, r.x, r.y);
      ctx.restore();
    } else {
      ctx.clearRect(r.x, r.y, r.w, r.h);
      drawSnapshot(ctx, img, r.x, r.y);
    }
    layer.touch();
  }

  fillAt(pt) {
    const s = this.settings.fill, d = this.doc, layer = this.target('fill');
    if (!layer) return;
    const data = this.sampleData(s.sample, layer);
    let res = s.gap > 0 && s.contiguous ? closeGapFill(data, d.width, d.height, pt.x, pt.y, s.tolerance, s.gap)
      : floodMask(data, d.width, d.height, pt.x, pt.y, s.tolerance, s.contiguous);
    if (!res) return;
    res = growMask(res.mask, d.width, d.height, s.grow, res.bounds);
    const b = res.bounds;
    const [cr, cg, cb] = hexToRgb(this.inkFor(layer));
    const img = new ImageData(b.w, b.h);
    for (let y = 0; y < b.h; y++) {
      for (let x = 0; x < b.w; x++) {
        if (!res.mask[(b.y + y) * d.width + b.x + x]) continue;
        const i = (y * b.w + x) * 4;
        img.data[i] = cr; img.data[i + 1] = cg; img.data[i + 2] = cb; img.data[i + 3] = 255;
      }
    }
    this.resetStroke();
    this.strokeCtx.putImageData(img, b.x, b.y);
    this.sel.clipCanvas(this.strokeCtx, b);
    this.live = { layer, canvas: this.stroke, alpha: s.opacity, mode: this.strokeMode(layer, false) };
    this.commitStroke(layer, b, 'Fill');
    if (layer.kind !== 'mask') this.colors.used();
  }

  /**
   * The pixels Fill and the wand look at: everything visible ('all'), the target itself ('layer'), or only the
   * visible layers marked as reference ('reference'; with none marked, everything visible).
   */
  sampleData(sample, t) {
    const d = this.doc;
    if (sample === 'layer' && t?.canvas) {  // through a canvas in memory: reading the layer itself click after click got slower each time
      const c = document.createElement('canvas');
      c.width = d.width; c.height = d.height;
      const ctx = c.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(t.canvas, 0, 0);
      return ctx.getImageData(0, 0, d.width, d.height).data;
    }
    if (sample === 'reference') { const data = this.referencePixels(); if (data) return data; }
    return this.compPixels();
  }

  /**
   * The composite's pixels, kept between calls: click after click with Fill or the wand reads again only what was
   * recomposited since (flushComp marks it). They are composited afresh into a small canvas in memory rather than
   * read off this.comp: a readback makes the browser move the composite off the GPU and upload it again for the
   * next frame (a print-size canvas took 150-250 ms per click, this takes about 25). The copy goes when another
   * tool is chosen. Callers must not change the array.
   */
  compPixels() {
    this.flushComp();
    const d = this.doc, W = d.width, H = d.height;
    let c = this.compRead;
    if (!c || c.w !== W || c.h !== H) c = this.compRead = { w: W, h: H, data: new Uint8ClampedArray(W * H * 4), dirty: { x: 0, y: 0, w: W, h: H } };
    const r = clip(c.dirty, W, H);
    c.dirty = null;
    if (r) {
      const sc = document.createElement('canvas');
      sc.width = r.w; sc.height = r.h;
      const sctx = sc.getContext('2d', { willReadFrequently: true });
      sctx.translate(-r.x, -r.y);
      withoutDrafts(() => composite(sctx, d, r));  // Fill and the wand never see draft layers
      const part = sctx.getImageData(0, 0, r.w, r.h).data, row = r.w * 4;
      if (r.w === W) c.data.set(part, r.y * row);
      else for (let y = 0; y < r.h; y++) c.data.set(part.subarray(y * row, (y + 1) * row), ((r.y + y) * W + r.x) * 4);
    }
    return c.data;
  }

  /** Fill or the wand was chosen: their copy of the pixels is made while nothing else happens, not at the first click. */
  prepareSample(id) {
    cancelIdleCallback(this.sampleIdle);
    this.sampleIdle = requestIdleCallback(() => {
      if (this.destroyed || this.tool !== id || this.gesture) return;
      const s = this.settings[id].sample;
      if (s === 'reference' && referenceLayers(this.doc.root).length) this.referencePixels();
      else if (s !== 'layer') this.compPixels();
    }, { timeout: 2000 });
  }

  hasReferenceLayers() { return referenceLayers(this.doc.root).length > 0; }

  /** sampleData's 'reference' pixels, kept while the reference layers are unchanged (filling another layer). */
  referencePixels() {
    const d = this.doc, refs = referenceLayers(d.root), k = this.refRead;
    const same = k && k.w === d.width && k.h === d.height && k.layers.length === refs.length &&
      refs.every((l, i) => k.layers[i] === l && k.versions[i] === l.version && k.opacity[i] === l.opacity);
    if (same) return k.data;
    const c = this.referenceCanvas();
    if (!c) return null;
    this.refRead = { w: d.width, h: d.height, layers: refs, versions: refs.map(l => l.version), opacity: refs.map(l => l.opacity),
      data: c.getContext('2d').getImageData(0, 0, d.width, d.height).data };
    return this.refRead.data;
  }

  /** The visible reference layers on one canvas (null, with a note, when none is marked). */
  referenceCanvas() {
    const d = this.doc, refs = referenceLayers(d.root);
    if (!refs.length) { toast('No layer is marked as reference, so everything visible counts. Tick Reference in the Layers panel.'); return null; }
    const c = document.createElement('canvas');
    c.width = d.width; c.height = d.height;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    for (const l of refs) { ctx.globalAlpha = l.opacity; ctx.drawImage(l.canvas, 0, 0); }
    return c;
  }

  /** As sampleData ('all' or 'reference'), but as a canvas copy, read later only where needed (Clone stamp). */
  sampleCanvas(sample) {
    const ref = sample === 'reference' ? this.referenceCanvas() : null;
    if (ref) return ref;
    this.flushComp();
    const c = document.createElement('canvas');
    c.width = this.comp.width; c.height = this.comp.height;
    c.getContext('2d').drawImage(this.comp, 0, 0);
    return c;
  }


  /** Picks the colour under pt; dragging reads it once per frame (each read waits for the GPU). */
  pickAt(pt) {
    const first = !this.pickPt;
    this.pickPt = pt;
    if (!first) return;
    requestAnimationFrame(() => {
      const q = this.pickPt;
      this.pickPt = null;
      if (this.destroyed) return;
      const d = this.doc, x = Math.floor(q.x), y = Math.floor(q.y);
      if (x < 0 || y < 0 || x >= d.width || y >= d.height) return;
      const s = this.settings.picker, k = Math.floor((+s.average || 1) / 2);
      const r = clip({ x: x - k, y: y - k, w: 2 * k + 1, h: 2 * k + 1 }, d.width, d.height);
      // only the square is drawn, in memory: this layer alone (a folder as it looks) or the picture. Reading
      // this.comp instead would move it off the GPU, and the next frame would upload it again.
      const n = d.active, c = document.createElement('canvas');
      c.width = r.w; c.height = r.h;
      const src = c.getContext('2d', { willReadFrequently: true });
      src.translate(-r.x, -r.y);
      if (s.pickFrom === 'layer') renderFolder(src, { children: [n] }, r);
      else composite(src, d, r);
      src.setTransform(1, 0, 0, 1, 0, 0);
      const p = averageColor(src.getImageData(0, 0, r.w, r.h).data);
      if (!p) return;
      this.colors.set(rgbToHex(p[0], p[1], p[2]));
      if (this.gesture?.type === 'pick') this.drawOverlay();  // the ring shows the new colour
    });
  }

  // ---------- importing images ----------

  async addImageLayer(src, name = 'Image') {
    const d = this.doc;
    let img;
    try { img = await loadImage(src); } catch (e) { return toast(e.message, { error: true }); }
    const layer = new Layer(d.width, d.height, { name: name.slice(0, 60) || 'Image' });
    const s = Math.min(1, d.width / img.width, d.height / img.height);
    const w = img.width * s, h = img.height * s;
    layer.ctx.drawImage(img, Math.round((d.width - w) / 2), Math.round((d.height - h) / 2), w, h);
    this.insertNode(layer, 'Import image');
  }

  pickImage() {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = 'image/*';
    inp.onchange = async () => {
      const f = inp.files[0];
      if (f) await this.addImageLayer(await fileToDataUrl(f), f.name.replace(/\.[^.]+$/, ''));
    };
    inp.click();
  }

  async onPaste(e) {
    if (isTyping(e.target)) return;
    for (const item of e.clipboardData?.items || []) {
      if (item.type.startsWith('image/')) {
        e.preventDefault();
        await this.addImageLayer(await fileToDataUrl(item.getAsFile()), 'Pasted image');
        return;
      }
    }
  }

  // ---------- undo ----------

  undo() {
    if (this.gesture) return;
    this.finishText();  // the undo button while typing undoes the whole text edit
    if (this.figPoly) return this.cancelFigurePoly();
    if (this.xf) return this.cancelTransform();
    if (this.history.undo()) this.layerPanel.render();
  }
  redo() { if (!this.gesture && !this.xf && this.history.redo()) this.layerPanel.render(); }

  /** Applies a transform in progress (before anything else changes the document). */
  finishTransform() {
    if (this.xf && !this.gesture) this.applyTransform();
  }

  updateUndoButtons() {
    const u = this.root.querySelector('[data-act="undo"]'), r = this.root.querySelector('[data-act="redo"]');
    if (u) { u.disabled = !this.history.canUndo; u.title = this.history.canUndo ? `Undo ${this.history.done.at(-1).label} (Ctrl+Z)` : 'Nothing to undo'; }
    if (r) { r.disabled = !this.history.canRedo; r.title = this.history.canRedo ? `Redo ${this.history.undone.at(-1).label} (Ctrl+Y)` : 'Nothing to redo'; }
  }

  // ---------- changes and saving ----------

  /** After any change: recomposite (r, or everything), redraw, refresh layer previews, and save soon. */
  changed(r, { save = true } = {}) {
    this.updateComp(r);
    this.requestRender();
    if (!this.thumbTimer) this.thumbTimer = setTimeout(() => { this.thumbTimer = 0; this.layerPanel.thumbs(); }, 150);
    // Fill and the wand: bring their copy of the pixels up to date while idle, not at the next click
    if ((this.compRead || this.refRead) && (this.tool === 'fill' || this.tool === 'wand')) this.prepareSample(this.tool);
    if (save) {
      this.doc.version++;
      this.scheduleSave();
    }
  }

  setStatus(text, title = '') {
    const el = this.root.querySelector('.save-state');
    if (el) { el.textContent = text; el.title = title; el.classList.toggle('error', text === 'Not saved!'); }
  }

  scheduleSave() {
    this.setStatus('Unsaved changes');
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.save(), SAVE_DELAY);
  }

  async save() {
    clearTimeout(this.saveTimer);
    // never save a half-done edit, nor in the middle of a stroke (reading the layers back would stall the drawing)
    if (this.xf || this.textEdit || this.gesture) { this.saveTimer = setTimeout(() => this.save(), SAVE_DELAY); return; }
    if (this.saving) { this.saveAgain = true; return this.saving; }
    const d = this.doc, v = d.version;
    if (v === this.savedVersion) return;
    this.setStatus('Saving…');
    this.saving = (async () => {
      // only the pictures changed since the last save travel; the server fills in the rest (app.py SAVE_CACHE)
      const thumb = await canvasToDataUrl(this.thumbCanvas(360));
      const send = async have => {
        const delta = { have, keys: new Set() };
        const json = await d.toJSON(delta);
        json.thumb = thumb;
        return { res: await api.save(d.id || '', json), keys: delta.keys };
      };
      const have = this.serverHas && this.serverHas.id === d.id ? await this.serverHas.keys : null;
      let sent;
      try {
        sent = await send(have);
      } catch (e) {
        if (!e.data?.missing) throw e;
        sent = await send(null);  // the server does not have them (restarted, or another window saved): all of it
      }
      const res = sent.res;
      this.serverHas = { id: res.id, keys: sent.keys };
      d.id = res.id;
      store('last', res.id);
      this.savedVersion = v;
    })();
    try {
      await this.saving;
    } catch (e) {
      // keep trying in the background (the disk may be full or busy for a moment); say so once per failing spell
      this.setStatus('Not saved!', `Last attempt failed: ${e.message}. Trying again every ${SAVE_RETRY / 1000} s.`);
      if (!this.saveFailed) toast(`Could not save: ${e.message}. KoeStudio keeps trying.`, { error: true, ms: 8000 });
      this.saveFailed = true;
      this.saveAgain = false;
      this.saveTimer = setTimeout(() => this.save(), SAVE_RETRY);
      return;
    } finally {
      this.saving = null;
    }
    if (this.saveFailed) { this.saveFailed = false; toast('Saved again.'); }
    this.captureTimelapse();
    if (d.version !== this.savedVersion && this.saveAgain) { this.saveAgain = false; return this.save(); }
    if (d.version === this.savedVersion) this.setStatus('Saved', 'Saved at ' + new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
    else this.setStatus('Unsaved changes');
  }

  /**
   * The gallery picture, at most `max` px a side: from the kept halvings of the composite (updateMips), so it is an
   * even average of the picture; shrinking the whole page in one step only picked scattered pixels of the line art.
   */
  thumbCanvas(max) {
    const d = this.doc;
    const big = Math.max(d.width, d.height), k = Math.max(0, Math.floor(Math.log2(big / max)));
    let src = this.comp;
    if (k) src = this.updateMips(k); else this.flushComp();
    const s = Math.min(1, max / big), f = 2 ** k, c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(d.width * s)); c.height = Math.max(1, Math.round(d.height * s));
    const ctx = c.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'low';
    ctx.drawImage(src, 0, 0, d.width / f, d.height / f, 0, 0, c.width, c.height);
    return c;
  }

  /** Saves anything pending; used before reloading or leaving the editor. */
  async flush() {
    this.finishTransform();
    this.finishText();
    if (this.saving) await this.saving.catch(() => {});
    if (this.doc && this.doc.version !== this.savedVersion) await this.save();
  }

  async goHome() {
    await this.flush();
    this.onHome();
  }

  async rename() {
    const t = await promptBox('Rename artwork', 'Title', this.doc.title);
    if (!t) return;
    this.doc.title = t;
    this.root.querySelector('.ed-title').textContent = t;
    this.doc.version++;
    this.scheduleSave();
  }

  // ---------- keyboard ----------

  onKey(e) {
    if (isTyping(e.target) || document.querySelector('.modal-back')) return;
    const c = e.key === 'Alt' ? 'alt' : comboOf(e);
    const hold = e.key === ' ' ? 'space' : c === 'alt' ? 'alt' : null;  // Space with Shift or Ctrl held too (turn, zoom)
    if (hold) {
      e.preventDefault();
      if (!this.held[hold]) { this.held[hold] = true; this.drawOverlay(); }
      return;
    }
    if (this.xf) return this.onTransformKey(e, c);
    if (this.poly && !this.gesture && this.onPolygonKey(c)) { e.preventDefault(); return; }
    if (this.figPoly && !this.gesture && this.onFigurePolyKey(c)) { e.preventDefault(); return; }
    if (this.crop && (c === 'enter' || c === 'escape')) {
      e.preventDefault();
      if (!this.gesture) c === 'enter' ? this.applyCrop() : this.selectTool('pen');
      return;
    }
    if (this.findPick && c === 'escape') { e.preventDefault(); this.stopFindLayer(); return; }
    const { table } = keyBindings();  // the keys in use (Settings → Keyboard shortcuts…)
    const t = toolForCombo(table, c, this.tool);
    if (t) {
      if (e.repeat) return;  // a held key: not one tool after the other (G is Fill, Gradient and Lasso fill)
      const from = this.tool;
      this.selectTool(t);
      this.spring = { key: c, from, at: e.timeStamp, used: false };  // onKeyUp may go back to `from`
      return;
    }
    // Ctrl+V pastes what was copied in KoeStudio (in place), unless the user has been in another program since;
    // then the browser's paste event brings in the image from the system clipboard instead (onPaste)
    if (c === 'ctrl+v' && this.clipboard?.fresh) { e.preventDefault(); if (!this.gesture) this.pasteInternal(); return; }
    const acts = this.commandActs(), id = (table.get(c) || []).find(x => acts[x]);
    let fn = acts[id];
    if (fn && RECORD_CMDS.has(id)) { const run = fn; fn = () => this.recordStep({ kind: 'cmd', id }, run); }  // Auto actions
    if (this.tool === 'move') {  // arrows nudge the layer or the selected pixels (Shift: 10 px)
      const step = e.shiftKey ? 10 : 1, a = { arrowleft: [-step, 0], arrowright: [step, 0], arrowup: [0, -step], arrowdown: [0, step] }[c.replace('shift+', '')];
      if (a) fn = () => this.nudgeLayer(...a);
    }
    if (fn) { e.preventDefault(); if (!this.gesture) fn(); }
  }

  renameLayer() { return this.layerPanel.rename(this.doc.active); }

  /** What each keyboard command (COMMANDS in shortcuts.js) does; Auto actions play recorded commands through it too. */
  commandActs() {
    const s = this.settings[this.tool];
    return {
      sizeDown: () => s.size && this.setSize(nextSize(s.size, -1)),
      sizeUp: () => s.size && this.setSize(nextSize(s.size, 1)),
      swapColors: () => this.colors.swap(),
      quickMask: () => this.toggleQuickMask(),
      mirrorView: () => this.flipView(),
      selectAll: () => this.selectAll(), deselect: () => this.deselect(), invertSelection: () => this.invertSelection(),
      transform: () => this.beginTransform(),
      zoomSelection: () => this.zoomToSelection(), canvasSize: () => this.canvasSizeDialog(), imageSize: () => this.imageSizeDialog(),
      snap: () => this.toggleSnap(), guides: () => this.toggleRulerVisibility(), grid: () => this.toggleGrid(),
      copy: () => this.copySelection(), cut: () => this.copySelection(true),
      layerCopy: () => this.layerViaCopy(), layerCut: () => this.layerViaCopy(true),
      rotateLeft: () => this.rotate(-15), rotateRight: () => this.rotate(15), rotateReset: () => this.rotate(null),
      clear: () => (this.tool === 'lineedit' && this.deleteLine()) || (this.tool === 'ruler' && this.deleteShape()) || this.clearLayer(),
      fillMain: () => this.fillLayer(), fillSub: () => this.fillLayer(true),
      undo: () => this.undo(), redo: () => this.redo(),
      save: () => this.save(), exportPng: () => this.exportAs('png'), export: () => this.exportAs(),
      mergeDown: () => this.mergeDown(), mergeVisible: () => this.mergeVisible(), newLayer: () => this.layerAdd(), groupFolder: () => this.groupIntoFolder(),
      repeatFilter: () => this.repeatFilter(),
      renameLayer: () => this.renameLayer(), findLayer: () => this.findLayerMode(), panels: () => this.togglePanels(),
      fit: () => this.fit(), actual: () => this.actual(), zoomIn: () => this.zoomStep(1), zoomOut: () => this.zoomStep(-1),
    };
  }

  /** While transforming, only Enter, Esc, the arrows, undo and view keys work. */
  onTransformKey(e, c) {
    const step = e.shiftKey ? 10 : 1;
    const arrows = { arrowleft: [-step, 0], arrowright: [step, 0], arrowup: [0, -step], arrowdown: [0, step] };
    const arrow = arrows[c.replace('shift+', '')];
    const map = {
      'enter': () => this.applyTransform(), 'escape': () => this.cancelTransform(), 'ctrl+z': () => this.cancelTransform(),
      'ctrl+0': () => this.fit(), 'ctrl+1': () => this.actual(), 'ctrl+=': () => this.zoomStep(1), 'ctrl+-': () => this.zoomStep(-1),
      '4': () => this.rotate(-15), '6': () => this.rotate(15), '5': () => this.rotate(null), 'shift+m': () => this.flipView(),
    };
    const fn = arrow ? () => this.xfNudge(...arrow) : map[c];
    if (fn) { e.preventDefault(); if (!this.gesture) fn(); }
  }

  onKeyUp(e) {
    const sp = this.spring;
    if (sp && (e?.type === 'blur' || e?.key?.toLowerCase() === sp.key.split('+').pop())) {
      // spring-loaded tools: hold E to erase a moment, let go and the pen is back (a quick tap just switches)
      this.spring = null;
      if (e.type === 'keyup' && springBack(e.timeStamp - sp.at, sp.used) && this.tool !== sp.from) {
        if (this.gesture) this.springAfter = sp.from;  // still drawing: once the stroke ends
        else this.selectTool(sp.from);
      }
      if (e.type === 'keyup') return;
    }
    const key = e?.key === ' ' ? 'space' : e?.key === 'Alt' ? 'alt' : null;
    if (e?.type === 'blur') {
      this.held.space = this.held.alt = false;
      this.releaseStripHolds();
      if (this.clipboard) this.clipboard.fresh = false;  // the user may copy something in another program
    }
    else if (key) { this.held[key] = !!this.stripHolds?.isHeld(key); if (key === 'alt') e.preventDefault(); }
    else return;
    this.drawOverlay();
  }
}

/** Menu items with their key labels following the user's shortcuts (Settings → Keyboard shortcuts…). */
function withKeyLabels(items) {
  const { binds } = keyBindings();
  return items.map(it => (it && typeof it === 'object' ? { ...it, ...(it.key ? { key: menuKeyLabel(it.key, binds) } : {}), ...(it.sub ? { sub: withKeyLabels(it.sub) } : {}) } : it));
}

// The size slider is logarithmic, so small sizes get most of its length.
const LOG_MAX = Math.log(1000);
function sliderToSize(v) { return Math.max(1, Math.round(Math.exp((v / 1000) * LOG_MAX) * 10) / 10); }
function sizeToSlider(size) { return Math.round((Math.log(Math.max(1, size)) / LOG_MAX) * 1000); }

Object.assign(Editor.prototype, brushMethods, brushManagerMethods, selectionMethods, selectionBarMethods, timelapseMethods, canvasMethods, layerMethods, rulerMethods, gradientMethods, textMethods, toneMethods, filterMethods, figureMethods, quickMaskMethods, navMethods, vectorMethods, refMethods, exportMethods, smudgeMethods, liquifyMethods, retouchMethods, directPaintMethods, effectMethods, colorizeMethods, actionMethods, gradientEditMethods, pressureMethods, lineEditMethods, symmetryMethods, adjustMethods, stripMethods);

function fmt(key, v) {
  if (key === 'size') return (v < 10 ? v.toFixed(1) : Math.round(v)) + ' px';
  if (key === 'corner' || key === 'reach') return Math.round(v) + ' px';
  if (key === 'gap') return v ? Math.round(v) + ' px' : 'Off';
  if (key === 'depth') return Math.round(v * 100) + '%';
  if (['opacity', 'flow', 'strength', 'hardness', 'spacing', 'minSize', 'minFlow', 'thickness', 'tipRandom', 'scatter', 'sizeJitter', 'flowJitter', 'hueJitter', 'satJitter', 'valJitter', 'textureAmount', 'textureScale', 'tiltSize', 'tiltFlow', 'speedSize', 'speedFlow', 'dualSize', 'dualSpacing', 'dualScatter', 'wetEdges', 'impasto', 'mix', 'mixStretch', 'paintLoad'].includes(key) || (key.startsWith('combo') && key !== 'comboAngle')) return Math.round(v * 100) + '%';
  if (key === 'tipAngle' || key === 'comboAngle') return Math.round(v) + '°';
  if (key === 'taperIn' || key === 'taperOut') return Math.round(v) + ' px';
  if (key === 'gamma' || key === 'leading') return v.toFixed(2);
  return String(v);
}

export async function openEditor(root, { id, newDoc, onHome, onOpen }) {
  const ed = new Editor(root, { onHome, onOpen });
  try {
    if (newDoc) {
      await ed.open(newDoc, { isNew: true });
    } else {
      const raw = await api.load(id, true);  // the server keeps its pictures, so saves send only what changes
      const doc = await Doc.fromJSON(raw, id);
      await ed.open(doc);
      ed.serverHas = { id, keys: Promise.all(doc.rasters().map(r => r.pngHash())).then(k => new Set(k), () => null) };
    }
  } catch (e) {
    ed.destroy();  // a half-opened editor would keep its key handlers and resize observer on the gallery
    throw e;
  }
  return ed;
}

