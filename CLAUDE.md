# KoeStudio

Windows desktop drawing and painting program, aiming to be a full-purpose tool in the spirit of Clip Studio Paint. See README.md for the user-facing feature list and the roadmap below for what comes next.

## Workflow (follow this in every session)

- **Runs straight from this folder.** The Desktop and Start-menu shortcuts (`KoeStudio.lnk`) and `Run KoeStudio.lnk` start `pythonw app.py` from the project folder. There is no installer and no build step for day-to-day use: every saved change is live the next time the app is opened, or straight away after a reload.
- **Reload key:** F5 or Ctrl+R in any screen saves pending work, then reloads the page so edited `web/` files take effect (`reload()` in `js/app.js`; the open screen and artwork are remembered in `sessionStorage`). Changes to `app.py` need the app restarted.
- **The user's data lives outside the project folder.** Artwork: `Pictures\KoeStudio` (`<id>.koe`, `.thumbs/`, `.deleted/`, `Exports/`). Window storage (tool settings, colours) and `error.log`: `%LOCALAPPDATA%\KoeStudio`. Never write user data into the project.
- **Never build installers, executables or releases, and never publish a GitHub release, unless the user asks.** Finish changes in source, run the tests, and commit.
- **Testing must not disturb the user:**
  - **Nothing pops up on the desktop.** Test the UI with `python app.py --browser` in Claude's built-in browser pane, or start the real window with `--hidden` (never shown). Don't launch the visible app while testing.
  - **Sound is muted.** Always start test runs with `KOE_MUTE=1` (or `--muted`). `js/mute.js` then silences every audio entry point (media elements, Web Audio, speech), so it also covers sound code added later. Any new sound must still play through the normal browser APIs so the mute catches it.
  - **Scratch data only.** Point test runs at a scratch folder, never the real `Pictures\KoeStudio`:
    `KOE_ART_DIR=<scratch>/art KOE_APP_DIR=<scratch>/app KOE_MUTE=1 KOE_PORT=8790 python app.py --browser`
  - When the browser pane is hidden it may not paint or fire ResizeObserver, and its viewport can be 0×0. Give the tab a size with `resize_window` (e.g. 1400×900, reset to `desktop` afterwards), reload, drive it with `javascript_tool` (dispatch `PointerEvent`/`KeyboardEvent`; after Ctrl+0 the view is `zoom = min((vw-80)/W, (vh-80)/H)`, centred) and check results through the saved files (`.thumbs/<id>.png`).
- If the folder or Python moves, recreate the shortcuts with `powershell -ExecutionPolicy Bypass -File tools\make_shortcut.ps1` (`-LocalOnly` makes only the one in the project folder).

## Architecture

- **`app.py`**: stdlib `ThreadingHTTPServer` on 127.0.0.1 (port 8770, or the next free one) serving `web/` and a small JSON API, shown in a pywebview (WebView2) window. Flags: `--browser` (serve only), `--hidden` (window never shown), `--muted`. Env: `KOE_ART_DIR`, `KOE_APP_DIR`, `KOE_PORT`, `KOE_MUTE`.
  - `Handler._allowed` refuses requests from other web pages (foreign `Host`, foreign `Origin`, `Sec-Fetch-Site` cross-site/same-site).
  - Static files are sent `Cache-Control: no-cache` (revalidated, so a reload picks up edits); API answers `no-store`.
  - API: `config`, `art` (list), `art/file`, `art/thumb`, `art/save` (new id when none given), `art/delete` (moves to `.deleted/`), `export` (PNG to `Exports/`, never overwrites), `open-folder`.
- **`web/`**: vanilla ES modules, no framework, no build step. Edit and reload.
  - `js/app.js`: start-up (mute, reload key) and switching between gallery and editor.
  - `js/views/gallery.js`: artwork cards, New canvas dialog (`PRESETS`), Open image.
  - `js/views/editor.js`: the drawing screen. Viewport (`render`, `updateComp`), pointer input, tools, layer operations, undo, autosave, menus and shortcuts (`onKey`).
  - `js/views/colorpanel.js`, `js/views/layerpanel.js`: side panels. They change the document only through editor methods.
  - `js/doc.js`: `Doc`/`Layer` (one canvas per layer), `composite()` (paper, blend modes, opacity, clipping groups, the live stroke), save format and `sanitizeDoc`.
  - `js/views/selecttools.js`: selection tools, selection commands, copy/cut/paste and free transform, as methods mixed into `Editor.prototype`.
  - `js/selection.js`: `Selection`, a doc-sized mask canvas with bounds and an outline for the marching ants; `combine(mode, draw)` adds/subtracts/intersects a shape; `clipCanvas(ctx, rect)` cuts a canvas down to it.
  - Pure, tested modules: `transform.js` (free-transform maths: handles, scale about the opposite handle, rotate, hit testing), `brush.js` (pressure, smoothing, stamp spacing), `fill.js` (flood fill, grow), `history.js` (undo stack with step and memory limits), `view.js` (zoom/rotate/mirror maths), `tools.js` (tool list and settings), `color.js`, `rect.js`, `keys.js`.
  - `js/painter.js`: draws dabs (anti-aliased circles for hard brushes, a pre-rendered gradient tip for soft ones).

### How painting works (keep to this when adding tools)

- A stroke is drawn into the shared **stroke canvas** at full strength; `this.live = {layer, canvas, alpha, mode}` makes `composite()` show it on its layer with the tool's opacity while drawing. On pen-up `commitStroke()` merges it into the layer (`source-over`, `destination-out` for erasing, `source-atop` when the layer's alpha is locked) and records an undo patch of just the changed rectangle. Opacity therefore never builds up within one stroke; density (`flow`) does.
- New paint-like tools should fill the stroke canvas, call `this.sel.clipCanvas(this.strokeCtx, rect)` so the selection is respected, then `commitStroke()`; fills, Delete and Alt+Del with a selection all work this way.
- **Selections** are undo steps (`changeSelection(label, fn)` stores before/after mask snapshots). They are not saved with the artwork.
- **Transform** (`this.xf`): `beginTransform()` lifts the selected pixels (or the whole layer) into `xf.src`, keeps the rest in `xf.base`, and redraws the layer live on every change (`renderTransform`). `applyTransform()` records one undo step for the layer and the selection; `cancelTransform()` puts the pixels back. While it is active, clicks on the panels/menus apply it first (`finishTransform`), saving waits, and only `onTransformKey` keys work.
- Every change goes through the history: pixel changes with `pushPatch(layer, rect, before, after)`, structural changes with `structural(label, do, undo)`. Layer visibility is deliberately not an undo step.
- After any change call `changed(rect)` (or `changed(null)` for everything): it recomposites, redraws, refreshes layer thumbnails and schedules the autosave (800 ms after the last change).
- Saving re-encodes only layers whose `version` changed (`Layer.toPng`). Raise `layer.touch()` after changing its pixels.

### Conventions

- **Save format:** add new fields with a default in `sanitizeDoc` so old `.koe` files keep loading. Never break old files; bump `FORMAT_VERSION` and convert if a field changes shape.
- **Escaping:** use `esc()` for anything user-supplied that goes into HTML.
- **Storage:** `store(key, value)` in `ui.js` wraps `localStorage` (`koe.` prefix) and never throws.
- **Shortcuts:** follow Clip Studio Paint where it has a convention (P pen, B brush, E eraser, G fill, M selection, W magic wand, I eyedropper, H hand, Space pan, Alt eyedropper, [ ] size, X swap colours, Ctrl+T transform). Tool keys live in `TOOLS`; the rest in `onKey`.
- **Icons:** add SVG paths to `icons.js`; `tools/make_icon.py` makes the app icon.

## Commands

| Task | Command |
| --- | --- |
| Run (desktop window) | the **KoeStudio** shortcut, or `python app.py` |
| Test run in a browser | `KOE_ART_DIR=<scratch>/art KOE_APP_DIR=<scratch>/app KOE_MUTE=1 KOE_PORT=8790 python app.py --browser` |
| **All tests** | `npm test` (JS logic tests + Python server tests) |
| Syntax-check all JS | `npm run check` |
| Regenerate icon / shortcuts | `python tools/make_icon.py` / `powershell -ExecutionPolicy Bypass -File tools\make_shortcut.ps1` |

Run `npm test` and `npm run check` before calling a change done, and add tests for new pure logic (expected values worked out by hand, not copied from output).

## Gotchas

- Use `127.0.0.1`, not `localhost` (IPv6-first lookup makes every request slower).
- The pywebview window keeps localStorage in `%LOCALAPPDATA%\KoeStudio\webview` (`private_mode=False`); without it tool settings are forgotten each launch.
- `setPointerCapture` throws for pointers the browser no longer tracks; keep it in a `try`.
- Big canvases are memory-heavy: one 4000×4000 layer is 64 MB, and every full-layer undo step holds two copies. `History` drops old steps past 600 MB.

## Roadmap (not built yet)

Selection extras (ellipse, polygon lasso, feather, grow/shrink, selection painting / quick mask), perspective and mesh transform; canvas resize/crop; layer folders, drag-to-reorder and layer masks; vector/line layers; rulers and perspective guides; text; brush textures and custom brush tips; tone/screentone and gradient tools; filters (blur, levels, hue/saturation); two-finger touch gestures; reference window; PSD import/export; per-layer files for faster saves on huge canvases; animation timeline.

## Repo

- Git repo on `main`; remote `origin` is https://github.com/laurmoe7/KoeStudio. Commits use the GitHub noreply email `336682114+laurmoe7@users.noreply.github.com` (the real address is blocked on push). Commit in small steps with messages that say why.
- Git-ignored: `dist/`, `build/`, `*.spec`, `*.lnk`, `node_modules/`.
