// The drawing screen: canvas viewport, tools, tool settings, colour and layer panels, menus and autosave.

import { api } from '../api.js';
import { Smoother, StampPath, stampAt, stampBounds, dabJitter, colorJitter, taperIn, taperOut, releaseHeld } from '../brush.js';
import { tipReach } from '../brushtip.js';
import { hexToRgb, rgbToHex, shiftColor } from '../color.js';
import { Doc, Layer, composite, canvasToDataUrl, loadImage, liveSource } from '../doc.js';
import { isFolder } from '../tree.js';
import { floodMask, growMask, closeGapFill } from '../fill.js';
import { History } from '../history.js';
import { icon } from '../icons.js';
import { comboOf, isTyping } from '../keys.js';
import { Painter, textureFor, hasTipImage } from '../painter.js';
import { union, clip } from '../rect.js';
import { Selection } from '../selection.js';
import { TOOLS, TOOL_BY_ID, SETTING_FIELDS, BASIC_PAINT, SETTING_HINTS, sanitizeSettings, nextSize, toolForKey } from '../tools.js';
import { esc, toast, menu, modal, promptBox, fileToDataUrl, store } from '../ui.js';
import { exportMethods } from './exporttools.js';
import { newView, matrix, toDoc, zoomAt, rotateAt, flipAt, fitView, actualSize } from '../view.js';
import { ColorPanel } from './colorpanel.js';
import { LayerPanel } from './layerpanel.js';
import { selectionMethods } from './selecttools.js';
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
import { vectorMethods } from './vectortools.js';
import { refMethods } from './reftools.js';
import { smudgeMethods } from './smudgetool.js';
import { liquifyMethods } from './liquifytool.js';
import { lineEditMethods } from './lineedittool.js';
import { symmetryMethods } from './symmetrytools.js';
import { brushMethods, curveSvg } from './brushtools.js';
import { symmetryStamps } from '../symmetry.js';
import { linePoints } from '../figure.js';

const SAVE_DELAY = 800;
const SAVE_RETRY = 10000;  // after a failed save
const ZOOM_STEPS = [0.05, 0.1, 0.15, 0.25, 0.33, 0.5, 0.67, 0.75, 1, 1.5, 2, 3, 4, 6, 8, 12, 16, 24, 32, 48, 64];
const GRID_TOOLS = new Set(['select', 'ellipse', 'polygon']);  // selection tools whose corners snap to the grid

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
    this.rulerMake = store('rulerMake') === 'ellipse' ? 'ellipse' : 'line';  // what a drag with the Ruler tool makes
    this.rulerPick = -1;  // the picked straight-line or concentric ruler (rulertools.js)
    this.maskOverlay = store('maskOverlay') === true;  // tint what a mask hides while painting on it
    this.poly = null;  // polygon selection being drawn (selecttools.js)
    this.figPoly = null;  // polyline/polygon figure being clicked (figuretool.js)
    this.quickMask = null;  // the Mask tools paint on while Quick mask is on (quickmask.js)
    this.onKey = this.onKey.bind(this);
    this.onKeyUp = this.onKeyUp.bind(this);
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
    this.stroke = document.createElement('canvas');
    this.stroke.width = doc.width;
    this.stroke.height = doc.height;
    this.strokeCtx = this.stroke.getContext('2d');
    this.sel = new Selection(doc.width, doc.height);
    this.xf = null;  // free transform in progress (selecttools.js)
    this.clipboard = null;
    this.antsTimer = setInterval(() => {
      if (!this.sel.active || this.xf) return;
      this.antsPhase = ((this.antsPhase || 0) + 1) % 8;
      this.drawOverlay();
    }, 120);
    this.updateComp(null);
    this.needsFit = true;  // done by resize() once the viewport has a real size
    this.resize();
    this.layerPanel.render();
    this.selectTool(this.tool);
    this.loadBrushLibrary();
    window.addEventListener('keydown', this.onKey);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('paste', this.onPaste);
    window.addEventListener('blur', this.onKeyUp);
    if (isNew) this.save();
    else this.setStatus('Saved');
  }

  destroy() {
    this.destroyed = true;
    window.removeEventListener('keydown', this.onKey);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('paste', this.onPaste);
    window.removeEventListener('blur', this.onKeyUp);
    this.resizeObs?.disconnect();
    this.refObs?.disconnect();
    clearTimeout(this.saveTimer);
    clearTimeout(this.thumbTimer);
    clearInterval(this.antsTimer);
    this.root.innerHTML = '';
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
          <button class="menu-btn" data-menu="help">Help</button>
          <button class="ed-title" title="Rename the artwork">${esc(doc.title)}</button>
          <button class="mask-chip" hidden title="Tools paint on the layer mask: painting hides, erasing shows. Click to paint on the layer again.">${icon('mask', 14)} Painting on mask</button>
          <button class="mask-chip qmask-chip" hidden title="Tools paint the selection: painting selects, erasing deselects. Click (or press Q) to turn it into the selection.">${icon('mask', 14)} Quick mask</button>
          <div class="grow"></div>
          <button class="icon-btn" data-act="undo" title="Undo (Ctrl+Z)">${icon('undo')}</button>
          <button class="icon-btn" data-act="redo" title="Redo (Ctrl+Y)">${icon('redo')}</button>
          <span class="save-state muted small"></span>
        </header>
        <div class="ed-body">
          <nav class="ed-tools" aria-label="Tools">
            ${TOOLS.map((t, i) => (i && TOOLS[i - 1].group !== t.group ? '<span class="tool-sep"></span>' : '') +
              `<button class="tool-btn" data-tool="${t.id}" title="${esc(t.label)} (${t.key.toUpperCase()})" aria-label="${esc(t.label)}">${icon(t.icon, 22)}</button>`).join('')}
          </nav>
          <aside class="ed-left">
            <section class="panel grow" data-panel="tool"><h3><button class="panel-head" title="Tool property: the settings of the current tool">${icon('chevron', 12)}<span class="tool-title">Tool</span></button></h3><div class="tool-props"></div></section>
            <section class="panel" data-panel="history"><h3><button class="panel-head" title="Every step you can undo: click one to go back to it">${icon('chevron', 12)}<span>History</span></button></h3><div class="history-list"></div></section>
            <section class="panel" data-panel="navigator"><h3><button class="panel-head" title="The whole picture: click or drag to move the view, scroll to zoom">${icon('chevron', 12)}<span>Navigator</span></button></h3><canvas class="nav-canvas"></canvas></section>
          </aside>
          <div class="ed-viewport">
            <canvas class="ed-view"></canvas>
            <canvas class="ed-overlay"></canvas>
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
          <span class="muted small doc-size">${doc.width} × ${doc.height} px</span>
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
    this.colors.onChange = () => { this.textColorChanged(); this.drawBrushPreview(); this.drawGradientStrip(); };
    this.root.querySelectorAll('[data-tool]').forEach(b => { b.onclick = () => this.selectTool(b.dataset.tool); });
    const acts = {
      home: () => this.goHome(), undo: () => this.undo(), redo: () => this.redo(),
      zoomIn: () => this.zoomStep(1), zoomOut: () => this.zoomStep(-1), actual: () => this.actual(), fit: () => this.fit(),
      rotL: () => this.rotate(-15), rotR: () => this.rotate(15), rotReset: () => this.rotate(null), flip: () => this.flipView(),
      rulers: () => this.toggleEdgeRulers(), snap: () => this.toggleSnap(),
    };
    this.root.querySelectorAll('[data-act]').forEach(b => { b.onclick = () => acts[b.dataset.act](); });
    this.root.querySelectorAll('[data-menu]').forEach(b => { b.onclick = () => { this.finishTransform(); menu(b, this.menuItems(b.dataset.menu)); }; });
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
    this.resizeObs = new ResizeObserver(() => this.resize());
    this.resizeObs.observe(this.viewport);
    this.bindPointer();
    this.bindNavigator();
    this.renderHistory();
    this.renderRefWindow();
    this.updateUndoButtons();
    this.updateSnapButton();
    this.root.querySelector('[data-act="rulers"]').classList.toggle('on', this.showRulers);
  }

  menuItems(name) {
    const d = this.doc, multi = !!this.multiPicked();
    return {
      file: [
        { label: 'Save now', key: 'Ctrl+S', run: () => this.save() },
        { label: 'Export as PNG', key: 'Ctrl+Shift+S', run: () => this.exportAs('png') },
        { label: 'Export…', key: 'Ctrl+Alt+Shift+S', run: () => this.exportAs() },
        { label: 'Save project file (.koe)…', run: () => this.saveProjectFile() },
        '-',
        { label: 'Import image as layer…', run: () => this.pickImage() },
        { label: 'Earlier versions…', run: () => this.openEarlierVersion(), disabled: !d.id },
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
        '-',
        { label: 'Transform…', key: 'Ctrl+T', run: () => this.beginTransform() },
        { label: this.sel.active ? 'Delete selected pixels' : 'Clear layer', key: 'Del', run: () => this.clearLayer() },
        { label: this.sel.active ? 'Fill selection with main color' : 'Fill layer with main color', key: 'Alt+Del', run: () => this.fillLayer() },
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
        { label: 'Flip canvas horizontally', run: () => this.flipPixels(d.rasters(), 'h', 'Flip canvas') },
        { label: 'Flip canvas vertically', run: () => this.flipPixels(d.rasters(), 'v', 'Flip canvas') },
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
      layer: [
        { label: 'New layer', key: 'Ctrl+Shift+N', run: () => this.layerAdd() },
        { label: 'New vector layer', run: () => this.newVectorLayer() },
        { label: 'New folder', run: () => this.folderAdd() },
        { label: multi ? 'Duplicate selected layers' : 'Duplicate layer', run: () => this.layerDuplicate() },
        { label: 'Rename…', key: 'F2', run: () => this.renameLayer() },
        { label: multi ? 'Delete selected layers' : 'Delete layer', run: () => this.layerDelete() },
        '-',
        { label: 'Put in new folder', key: 'Ctrl+G', run: () => this.groupIntoFolder() },
        multi ? { label: 'Merge selected layers', key: 'Ctrl+E', run: () => this.mergeDown() }
        : isFolder(d.active)
          ? { label: 'Merge folder', key: 'Ctrl+E', run: () => this.mergeFolder(d.active) }
          : { label: 'Merge with layer below', key: 'Ctrl+E', run: () => this.mergeDown() },
        { label: 'Merge visible to new layer', key: 'Ctrl+Shift+Alt+E', run: () => this.mergeVisible() },
        '-',
        d.active.mask
          ? { label: d.active.mask.enabled ? 'Turn mask off' : 'Turn mask on', run: () => this.toggleMask() }
          : { label: this.sel.active ? 'Add mask (hide outside selection)' : 'Add mask', run: () => this.addMask() },
        { label: 'Apply mask to layer', run: () => this.applyMask(), disabled: !d.active.mask || isFolder(d.active) },
        { label: 'Delete mask', run: () => this.deleteMask(), disabled: !d.active.mask },
        '-',
        { label: this.sel.active ? 'New screentone (in selection)…' : 'New screentone…', run: () => this.newToneLayer() },
        { label: 'Screentone settings…', run: () => this.toneDialog(), disabled: isFolder(d.active) },
        { label: 'Rasterize screentone', run: () => this.rasterizeTone(d.active), disabled: !d.active.tone },
        '-',
        { label: 'Flip layer horizontally', run: () => this.flipPixels(this.layerRasters(), 'h', 'Flip layer') },
        { label: 'Flip layer vertically', run: () => this.flipPixels(this.layerRasters(), 'v', 'Flip layer') },
        '-',
        { label: 'Rasterize text', run: () => this.rasterizeText(d.active), disabled: !d.active.text },
        { label: 'Rasterize vector layer', run: () => this.rasterizeVector(d.active), disabled: !d.active.vector },
      ],
      view: [
        { label: 'Zoom in', key: 'Ctrl+=', run: () => this.zoomStep(1) },
        { label: 'Zoom out', key: 'Ctrl+-', run: () => this.zoomStep(-1) },
        { label: 'Actual size (100%)', key: 'Ctrl+1', run: () => this.actual() },
        { label: 'Fit to window', key: 'Ctrl+0', run: () => this.fit() },
        '-',
        { label: 'Rotate left', key: '4', run: () => this.rotate(-15) },
        { label: 'Rotate right', key: '6', run: () => this.rotate(15) },
        { label: 'Reset rotation', key: '5', run: () => this.rotate(null) },
        { label: 'Mirror view', key: 'Shift+M', run: () => this.flipView() },
        '-',
        { label: 'Grid', key: "Ctrl+'", checked: d.rulers.grid.show, run: () => this.toggleGrid() },
        { label: 'Grid settings…', run: () => this.gridDialog() },
        { label: 'Edge rulers', checked: this.showRulers, run: () => this.toggleEdgeRulers() },
        '-',
        { label: 'Guides and perspective', key: 'Ctrl+;', checked: d.rulers.visible, run: () => this.toggleRulerVisibility() },
        { label: 'Snap to rulers', key: 'Ctrl+2', checked: d.rulers.snap, run: () => this.toggleSnap() },
        { label: 'Perspective ruler…', key: 'U', run: () => this.selectTool('ruler') },
        { label: 'Clear guides', run: () => this.clearGuides(), disabled: !d.rulers.guides.length },
        '-',
        { label: 'Symmetry ruler', checked: d.rulers.symmetry.kind !== 'off', run: () => this.toggleSymmetry() },
        { label: 'Symmetry settings…', run: () => this.symmetryDialog() },
        '-',
        { label: 'Show mask area (while painting on a mask)', checked: this.maskOverlay, run: () => this.toggleMaskOverlay() },
        { label: 'Reference window', checked: this.refState().open, run: () => this.toggleRefWindow() },
        '-',
        { label: 'Reload screen', key: 'F5', run: () => window.koeReload?.() },
      ],
    }[name];
  }

  // ---------- rendering ----------

  resize() {
    const r = this.viewport.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    this.vw = r.width; this.vh = r.height; this.dpr = dpr;
    this.bg = getComputedStyle(this.viewport).getPropertyValue('--canvas-bg').trim() || '#2a2b31';
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
   * Recomposites a doc region (all of it when r is null) into the composite canvas and remembers it as the part
   * of the screen that needs redrawing (this.dirty: a rect, or 'all').
   */
  updateComp(r) {
    const d = this.doc;
    const area = clip(r || { x: 0, y: 0, w: d.width, h: d.height }, d.width, d.height);
    if (area) composite(this.compCtx, d, area, this.live);
    this.dirty = !r || this.dirty === 'all' ? 'all' : union(this.dirty, area);
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
    ctx.setTransform(...m);
    ctx.imageSmoothingEnabled = this.view.zoom < 2;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(this.comp, box.x, box.y, box.w, box.h, box.x, box.y, box.w, box.h);
    const tint = this.maskTint();
    if (tint) { ctx.globalAlpha = 0.45; ctx.drawImage(tint, box.x, box.y, box.w, box.h, box.x, box.y, box.w, box.h); ctx.globalAlpha = 1; }
    ctx.restore();
    this.scheduleNav();
    if (r) return;
    this.zoomLabel.textContent = Math.round(this.view.zoom * 1000) / 10 + '%';
    const deg = Math.round(((this.view.rot * 180 / Math.PI) % 360 + 540) % 360 - 180);
    this.rotLabel.textContent = deg + '°' + (this.view.flip ? ' ⇋' : '');
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
    if (!ctx) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.overlay.width, this.overlay.height);
    this.drawSelectionOverlay(ctx);
    this.drawCropOverlay(ctx);
    this.drawRulerOverlay(ctx);
    this.drawSymmetryOverlay(ctx);
    this.drawGradientOverlay(ctx);
    this.drawFigurePoly(ctx);
    this.drawLineEditOverlay(ctx);
    this.placeTextEditor();
    const brush = this.updateCursor();
    if (brush) this.drawBrushOutline(ctx, brush);
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
    const tool = TOOL_BY_ID[this.effectiveTool()] || TOOL_BY_ID.move;
    if (tool.kind === 'crop') { if (!this.gesture) set(this.cropCursor()); return null; }
    set({ paint: 'none', smudge: 'none', liquify: 'none', lineedit: 'crosshair', lassofill: 'crosshair', fill: 'crosshair', gradient: 'crosshair', figure: 'crosshair', text: 'text', picker: 'crosshair', move: 'move', select: 'crosshair', ruler: 'default',
      hand: this.gesture?.type === 'pan' ? 'grabbing' : 'grab' }[tool.kind]);
    return this.pointer && (tool.kind === 'paint' || tool.kind === 'smudge' || tool.kind === 'liquify') ? tool : null;
  }

  drawBrushOutline(ctx, tool) {
    const dpr = this.dpr || 1;
    const r = Math.max(1, (this.settings[tool.id].size * this.view.zoom) / 2) * dpr;
    const x = this.pointer.x * dpr, y = this.pointer.y * dpr;
    ctx.lineWidth = 1 * dpr;
    for (const [color, rr] of [['rgba(0,0,0,0.75)', r + dpr], ['rgba(255,255,255,0.9)', r]]) {
      ctx.strokeStyle = color;
      ctx.beginPath(); ctx.arc(x, y, rr, 0, Math.PI * 2); ctx.stroke();
    }
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
    const fields = this.visibleFields(s);
    if (t.kind === 'ruler') return this.renderRulerProps(box);
    if (!fields.length) {
      box.innerHTML = `<p class="hint">${t.kind === 'picker' ? 'Click the canvas to pick a color. Hold Alt with a brush to pick quickly.'
        : t.kind === 'move' ? 'Drag to move the current layer, or only the selected pixels when there is a selection.'
        : t.kind === 'crop' ? 'Drag the edges or corners of the box (Shift keeps proportions), drag inside to move it, or drag outside to draw a new box. Enter crops, Esc leaves.' : 'Drag to move the view. Hold Space with any tool to do the same.'}</p>`;
      return;
    }
    if (t.kind === 'paint') {  // paint tools: the saved-brush row and the basics; everything else is in the Brush settings window
      const basic = BASIC_PAINT.map(k => fields.find(f => f[0] === k)).filter(Boolean);
      box.innerHTML = this.presetRowHtml(s) + this.settingsHtml(basic, s) +
        `<div class="btn-row"><button data-brush-win class="${this.brushWin ? 'on' : ''}" title="Tip, pen pressure, stroke, variation and texture settings">${icon('sliders', 14)} Brush settings…</button></div>`;
      this.bindPresetRow(box);
      box.querySelector('[data-brush-win]').onclick = () => this.toggleBrushWindow();
    } else box.innerHTML = this.settingsHtml(fields, s);
    if (t.kind === 'lineedit') this.renderLineEditProps(box);
    if (t.kind === 'select') {
      box.insertAdjacentHTML('beforeend', `<div class="btn-row">
        <button data-sel="all" title="Ctrl+A">All</button><button data-sel="none" title="Ctrl+D">Deselect</button>
        <button data-sel="invert" title="Ctrl+Shift+I">Invert</button><button data-sel="xf" title="Ctrl+T">Transform</button></div>
        <p class="hint">${t.id === 'polygon' ? 'Click each corner; double-click, Enter or a click on the first corner closes the shape. Backspace removes the last corner, Esc drops it. ' : ''}Shift adds to the selection, Alt subtracts, Shift+Alt keeps the overlap.</p>`);
      const acts = { all: () => this.selectAll(), none: () => this.deselect(), invert: () => this.invertSelection(), xf: () => this.beginTransform() };
      box.querySelectorAll('[data-sel]').forEach(b => { b.onclick = () => acts[b.dataset.sel](); });
    }
    if (t.kind === 'gradient') box.insertAdjacentHTML('afterbegin', '<canvas class="grad-strip" title="The colours this gradient will use"></canvas>');
    this.bindSettings(box);
    this.drawGradientStrip();
  }

  /** The settings of a tool worth showing: the grain settings only with a texture chosen, curves only when set. */
  visibleFields(s) {
    return SETTING_FIELDS.filter(f => f[0] in s && f[2] !== 'id' && !(f[2] === 'curve' && !s[f[0]])
      && !(s.texture === 'none' && ['textureAmount', 'textureScale', 'textureInvert'].includes(f[0])));
  }

  /** Rows for some settings: sliders and choices first, the check boxes together under them. */
  settingsHtml(fs, s) {
    const tip = key => (SETTING_HINTS[key] ? ` title="${esc(SETTING_HINTS[key])}"` : '');
    const options = (key, list) => key === 'tip' ? this.tipChoices() : key === 'texture' ? this.textureChoices() : list;
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
        if (t.id === 'text') this.textSettingsChanged();
        if (k === 'texture') this.renderToolProps();
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
    const pressure = e => e.pointerType === 'mouse' ? 1 : (e.pressure || (e.pointerType === 'touch' ? 1 : 0.01));
    el.addEventListener('contextmenu', e => e.preventDefault());
    el.addEventListener('pointerdown', e => {
      if (this.gesture) return;
      try { el.setPointerCapture(e.pointerId); } catch { /* pointer already gone */ }
      const p = pos(e);
      this.pointer = p;
      if (e.button === 1) return this.beginPan(p, e.pointerId);
      if (e.button !== 0 && !(e.pointerType === 'pen' && e.button === 5)) return;
      const dp = { ...toDoc(this.view, p.x, p.y), p: pressure(e) };
      if (this.canvasPick) { this.canvasPick(dp); return; }  // a dialog takes canvas clicks (Color range, blur centre)
      const band = this.xf ? null : this.rulerBand(p);
      if (band) { if (band !== 'corner') this.beginNewGuide(band, dp, e.pointerId); this.drawOverlay(); return; }
      if (this.xf && !this.held.space) { this.xfPointerDown(dp, e.pointerId); this.drawOverlay(); return; }
      const penEraser = e.pointerType === 'pen' && (e.button === 5 || (e.buttons & 32));
      const toolId = penEraser ? 'eraser' : this.effectiveTool();
      const tool = TOOL_BY_ID[toolId];
      if (tool.kind === 'hand') this.beginPan(p, e.pointerId);
      else if (tool.kind === 'select') this.beginSelect(toolId, GRID_TOOLS.has(toolId) ? this.gridPoint(dp) : dp, e.pointerId, e);
      else if (tool.kind === 'crop') this.beginCrop(this.gridPoint(dp), e.pointerId);
      else if (tool.kind === 'ruler') this.beginRulerTool(dp, e.pointerId);
      else if (tool.kind === 'move' && this.sel.active) {
        // with a selection, the Move tool moves only the selected pixels (a quick transform)
        if (this.beginTransform({ moveOnly: true })) this.gesture = { type: 'xf', tool: 'move', id: e.pointerId, grab: 'move', t0: { ...this.xf.t }, p0: dp };
      }
      else if (tool.kind === 'paint') this.beginPaint(toolId, dp, e.pointerId, e.shiftKey);
      else if (tool.kind === 'smudge') this.beginSmudge(dp, e.pointerId);
      else if (tool.kind === 'liquify') this.beginLiquify(dp, e.pointerId);
      else if (tool.kind === 'lineedit') this.beginLineEdit(dp, e.pointerId);
      else if (tool.kind === 'lassofill') this.beginLassoFill(dp, e.pointerId);
      else if (tool.kind === 'figure') this.beginFigure(this.gridPoint(dp), e.pointerId, e.shiftKey, e.detail >= 2);
      else if (tool.kind === 'fill') this.fillAt(dp);
      else if (tool.kind === 'gradient') this.beginGradient(dp, e.pointerId);
      else if (tool.kind === 'text') { e.preventDefault(); this.textClick(dp); }
      else if (tool.kind === 'picker') { this.gesture = { type: 'pick', tool: toolId, id: e.pointerId }; this.pickAt(dp); }
      else if (tool.kind === 'move') this.beginMove(dp, e.pointerId);
      this.drawOverlay();
    });
    el.addEventListener('pointermove', e => {
      const p = pos(e);
      this.pointer = p;
      this.pointerShift = e.shiftKey;
      const g = this.gesture;
      if (g && g.id === e.pointerId) {
        if (g.type === 'paint' || g.type === 'smudge' || g.type === 'liquify') {
          const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
          for (const ev of evs.length ? evs : [e]) {
            const q = pos(ev), pt = { ...toDoc(this.view, q.x, q.y), p: pressure(ev) };
            if (g.type === 'paint') this.addPoint(pt);
            else if (g.type === 'liquify') this.liquifyPoint(pt);
            else this.smudgePoint(pt);
          }
          this.requestRender();
        } else if (g.type === 'verase') {
          this.vectorEraseTo({ ...toDoc(this.view, p.x, p.y), p: pressure(e) });
        } else if (g.type === 'lassofill') {
          this.lassoFillDrag(toDoc(this.view, p.x, p.y));
        } else if (g.type === 'pan') {
          this.view = { ...this.view, panX: g.view.panX + p.x - g.start.x, panY: g.view.panY + p.y - g.start.y };
          this.requestRender();
        } else if (g.type === 'pick') {
          this.pickAt(toDoc(this.view, p.x, p.y));
        } else if (g.type === 'move') {
          this.moveTo(toDoc(this.view, p.x, p.y));
        } else if (g.type === 'select') {
          const q = toDoc(this.view, p.x, p.y);
          this.selectDrag(GRID_TOOLS.has(g.tool) ? this.gridPoint(q) : q);
        } else if (g.type === 'xf') {
          this.xfDrag(toDoc(this.view, p.x, p.y), e.shiftKey);
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
      else if (g.type === 'lineedit') this.endLineEdit();
      else if (g.type === 'verase') this.endVectorErase();
      else if (g.type === 'lassofill') this.endLassoFill();
      else if (g.type === 'guide' || g.type === 'vp' || g.type === 'shape') this.rulerEnd(this.pointer);
      else if (g.type === 'gradient') this.endGradient();
      else if (g.type === 'figure') this.endFigure();
      else if (g.type === 'move') this.endMove();
      else if (g.type === 'select') this.endSelect();
      this.gesture = null;
      if (g.type === 'xf') this.xfEnd();
      this.drawOverlay();
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
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

  beginPan(p, id) {
    this.gesture = { type: 'pan', tool: 'hand', id, start: p, view: { ...this.view } };
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
    const reach = tipReach(hasTipImage(s.tip)) * 2;
    const line = shift && this.lastStroke && this.lastStroke.layer === layer ? this.lastStroke.pt : null;
    // colour jitter: erasers and masks keep their black; per stroke the varied colour is picked once here
    const ink = tool.erase ? '#000000' : this.inkFor(layer), varies = !tool.erase && layer.kind !== 'mask' && !!colorJitter(s);
    const color = varies && s.colorJitterStroke ? shiftColor(ink, colorJitter(s)) : ink;
    this.gesture = {
      type: 'paint', tool: toolId, id, s, sizeAt, reachAt: p => sizeAt(p) * reach, layer, dist: 0, prevStamp: null, held: [], bounds: null, last: pt, erase: !!tool.erase,
      color, dabColors: varies && !s.colorJitterStroke,
      painter: new Painter(this.strokeCtx, { color, hardness: s.hardness,
        tip: s.tip, thickness: s.thickness, angle: s.tipAngle, random: s.tipRandom, follow: s.tipFollow }),
      smoother: new Smoother(s.smoothing),
      path: new StampPath(sizeAt, s.spacing),
      snap: line ? null : this.snapFor(pt),  // follow a guide or perspective line (rulertools.js)
      vec: layer.vector ? [] : null,  // on a vector layer: the smoothed path, kept as a line at pen-up (vectortools.js)
    };
    // vector lines are kept whole, so the selection does not cut them
    this.live = { layer, canvas: this.stroke, alpha: s.opacity, mode: this.strokeMode(layer, tool.erase), texture: textureFor(s), sel: this.sel.active && !layer.vector ? this.sel : null };
    if (line) {
      this.addStampPoint({ ...line, p: pt.p });
      for (const q of linePoints({ ...line, p: pt.p }, pt, 3)) this.addStampPoint(q);
    } else this.addPoint(pt);
    this.requestRender();
  }

  /** A pen point: through ruler snapping (if any), then smoothing and stamping. */
  addPoint(pt) {
    const g = this.gesture;
    if (g.snap) { for (const q of this.snapPoint(g.snap, pt)) this.addStampPoint(q); return; }
    this.addStampPoint(pt);
  }

  addStampPoint(pt) {
    const g = this.gesture;
    g.last = pt;
    const sp = g.smoother.add(pt);
    if (g.vec) g.vec.push([sp.x, sp.y, sp.p]);
    const stamps = g.path.add(sp);
    if (!stamps.length) return;
    for (const st of stamps) {  // distance along the stroke (for the taper) and random variation; symmetric copies share it
      if (g.prevStamp) g.dist += Math.hypot(st.x - g.prevStamp.x, st.y - g.prevStamp.y);
      g.prevStamp = { x: st.x, y: st.y };
      const j = dabJitter(g.s, stampAt(g.s, st.p).size);
      st.x += j.dx; st.y += j.dy;
      st.k = j.sizeK * taperIn(g.dist, g.s.taperIn);
      st.f = j.flowK;
      st.d = g.dist;
      if (g.dabColors) st.c = shiftColor(g.color, colorJitter(g.s));
    }
    if (g.s.taperOut > 0) {  // the end taper holds the last stretch back until the pen lifts
      const r = releaseHeld([...g.held, ...stamps], g.dist, g.s.taperOut);
      g.held = r.held;
      this.drawStamps(r.ready);
    } else this.drawStamps(stamps);
  }

  /** Dabs a stroke's stamps (with their symmetric copies) into the stroke canvas and recomposites them. */
  drawStamps(stamps) {
    const g = this.gesture;
    if (!stamps.length) return;
    const all = symmetryStamps(this.doc.rulers.symmetry, stamps, this.doc.width, this.doc.height);
    const per = all.length / stamps.length;  // copies of each stamp, in order
    all.forEach((st, i) => {
      const { size, flow } = stampAt(g.s, st.p);
      g.painter.dab(st.x, st.y, size * st.k, flow * st.f, i % per, st.c);
    });
    const r = stampBounds(all, g.reachAt);
    g.bounds = union(g.bounds, r);
    this.strokeVersion = (this.strokeVersion || 0) + 1;
    this.updateComp(r);
  }

  endPaint() {
    const g = this.gesture;
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
    const before = layer.ctx.getImageData(r.x, r.y, r.w, r.h);
    const ctx = layer.ctx;
    ctx.save();
    ctx.globalAlpha = live.alpha;
    ctx.globalCompositeOperation = live.mode;
    ctx.drawImage(...liveSource(live, r), r.w, r.h, r.x, r.y, r.w, r.h);
    ctx.restore();
    const after = layer.ctx.getImageData(r.x, r.y, r.w, r.h);
    this.pushPatch(layer, r, before, after, label);
    layer.touch();
    this.changed(r);
  }

  pushPatch(layer, r, before, after, label) {
    const put = img => { layer.ctx.putImageData(img, r.x, r.y); layer.touch(); this.changed(r); };
    this.history.push({ label, bytes: r.w * r.h * 8, undo: () => put(before), redo: () => put(after) });
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
    if (sample === 'layer' && t?.ctx) return t.ctx.getImageData(0, 0, d.width, d.height).data;
    if (sample === 'reference') {
      const refs = referenceLayers(d.root);
      if (refs.length) {
        const c = document.createElement('canvas');
        c.width = d.width; c.height = d.height;
        const ctx = c.getContext('2d', { willReadFrequently: true });
        for (const l of refs) { ctx.globalAlpha = l.opacity; ctx.drawImage(l.canvas, 0, 0); }
        return ctx.getImageData(0, 0, d.width, d.height).data;
      }
      toast('No layer is marked as reference, so everything visible counts. Tick Reference in the Layers panel.');
    }
    return this.compCtx.getImageData(0, 0, d.width, d.height).data;
  }

  pickAt(pt) {
    const x = Math.floor(pt.x), y = Math.floor(pt.y);
    if (x < 0 || y < 0 || x >= this.doc.width || y >= this.doc.height) return;
    const p = this.compCtx.getImageData(x, y, 1, 1).data;
    if (p[3] === 0) return;
    this.colors.set(rgbToHex(p[0], p[1], p[2]));
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
    if (this.xf || this.textEdit) { this.saveTimer = setTimeout(() => this.save(), SAVE_DELAY); return; }  // never save a half-done edit
    if (this.saving) { this.saveAgain = true; return this.saving; }
    const d = this.doc, v = d.version;
    if (v === this.savedVersion) return;
    this.setStatus('Saving…');
    this.saving = (async () => {
      const json = await d.toJSON();
      json.thumb = await canvasToDataUrl(d.flatten(360));
      const res = await api.save(d.id || '', json);
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
    if (d.version !== this.savedVersion && this.saveAgain) { this.saveAgain = false; return this.save(); }
    if (d.version === this.savedVersion) this.setStatus('Saved', 'Saved at ' + new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
    else this.setStatus('Unsaved changes');
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
    if (c === 'space' || c === 'alt') {
      e.preventDefault();
      if (!this.held[c]) { this.held[c] = true; this.drawOverlay(); }
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
    const t = toolForKey(c, this.tool);
    if (t) { this.selectTool(t); return; }
    const s = this.settings[this.tool];
    const map = {
      '[': () => s.size && this.setSize(nextSize(s.size, -1)),
      ']': () => s.size && this.setSize(nextSize(s.size, 1)),
      'x': () => this.colors.swap(),
      'q': () => this.toggleQuickMask(),
      'shift+m': () => this.flipView(),
      'ctrl+a': () => this.selectAll(), 'ctrl+d': () => this.deselect(), 'ctrl+shift+i': () => this.invertSelection(),
      'ctrl+t': () => this.beginTransform(),
      'ctrl+alt+c': () => this.canvasSizeDialog(), 'ctrl+alt+i': () => this.imageSizeDialog(),
      'ctrl+2': () => this.toggleSnap(), 'ctrl+;': () => this.toggleRulerVisibility(), "ctrl+'": () => this.toggleGrid(),
      'ctrl+c': () => this.copySelection(), 'ctrl+x': () => this.copySelection(true),
      '4': () => this.rotate(-15), '6': () => this.rotate(15), '5': () => this.rotate(null),
      'delete': () => (this.tool === 'lineedit' && this.deleteLine()) || (this.tool === 'ruler' && this.deleteShape()) || this.clearLayer(),
      'backspace': () => (this.tool === 'lineedit' && this.deleteLine()) || (this.tool === 'ruler' && this.deleteShape()) || this.clearLayer(),
      'alt+delete': () => this.fillLayer(), 'alt+backspace': () => this.fillLayer(),
      'ctrl+z': () => this.undo(), 'ctrl+y': () => this.redo(), 'ctrl+shift+z': () => this.redo(),
      'ctrl+s': () => this.save(), 'ctrl+shift+s': () => this.exportAs('png'), 'ctrl+alt+shift+s': () => this.exportAs(),
      'ctrl+e': () => this.mergeDown(), 'ctrl+alt+shift+e': () => this.mergeVisible(), 'ctrl+shift+n': () => this.layerAdd(), 'ctrl+g': () => this.groupIntoFolder(),
      'ctrl+f': () => this.repeatFilter(),
      'f2': () => this.renameLayer(),
      'ctrl+0': () => this.fit(), 'ctrl+1': () => this.actual(),
      'ctrl+=': () => this.zoomStep(1), 'ctrl+-': () => this.zoomStep(-1),
    };
    // Ctrl+V pastes what was copied in KoeStudio (in place), unless the user has been in another program since;
    // then the browser's paste event brings in the image from the system clipboard instead (onPaste)
    if (c === 'ctrl+v' && this.clipboard?.fresh) { e.preventDefault(); if (!this.gesture) this.pasteInternal(); return; }
    const fn = map[c];
    if (fn) { e.preventDefault(); if (!this.gesture) fn(); }
  }

  renameLayer() { this.layerPanel.rename(this.doc.active); }

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
    const key = e?.key === ' ' ? 'space' : e?.key === 'Alt' ? 'alt' : null;
    if (e?.type === 'blur') {
      this.held.space = this.held.alt = false;
      if (this.clipboard) this.clipboard.fresh = false;  // the user may copy something in another program
    }
    else if (key) { this.held[key] = false; if (key === 'alt') e.preventDefault(); }
    else return;
    this.drawOverlay();
  }
}

// The size slider is logarithmic, so small sizes get most of its length.
const LOG_MAX = Math.log(1000);
function sliderToSize(v) { return Math.max(1, Math.round(Math.exp((v / 1000) * LOG_MAX) * 10) / 10); }
function sizeToSlider(size) { return Math.round((Math.log(Math.max(1, size)) / LOG_MAX) * 1000); }

Object.assign(Editor.prototype, brushMethods, selectionMethods, canvasMethods, layerMethods, rulerMethods, gradientMethods, textMethods, toneMethods, filterMethods, figureMethods, quickMaskMethods, navMethods, vectorMethods, refMethods, exportMethods, smudgeMethods, liquifyMethods, lineEditMethods, symmetryMethods);

function fmt(key, v) {
  if (key === 'size') return (v < 10 ? v.toFixed(1) : Math.round(v)) + ' px';
  if (key === 'corner' || key === 'reach') return Math.round(v) + ' px';
  if (key === 'gap') return v ? Math.round(v) + ' px' : 'Off';
  if (['opacity', 'flow', 'strength', 'hardness', 'spacing', 'minSize', 'minFlow', 'thickness', 'tipRandom', 'scatter', 'sizeJitter', 'flowJitter', 'hueJitter', 'satJitter', 'valJitter', 'textureAmount', 'textureScale'].includes(key)) return Math.round(v * 100) + '%';
  if (key === 'tipAngle') return Math.round(v) + '°';
  if (key === 'taperIn' || key === 'taperOut') return Math.round(v) + ' px';
  if (key === 'gamma' || key === 'leading') return v.toFixed(2);
  return String(v);
}

export async function openEditor(root, { id, newDoc, onHome, onOpen }) {
  const ed = new Editor(root, { onHome, onOpen });
  if (newDoc) {
    await ed.open(newDoc, { isNew: true });
  } else {
    const raw = await api.load(id);
    await ed.open(await Doc.fromJSON(raw, id));
  }
  return ed;
}

