// Inline SVG icons (24x24, stroked with currentColor).

const P = {
  pen: '<path d="M4 20l3-1 11-11-2-2L5 17l-1 3z"/><path d="M14 6l2 2"/><path d="M17 3l4 4-2 2-4-4z"/>',
  pencil: '<path d="M4 20l1-4L16 5l3 3L8 19l-4 1z"/><path d="M14 7l3 3"/><path d="M4 20l2-.5"/>',
  brush: '<path d="M20 4c-4 2-8 6-10 9l1.5 1.5c3-2 7-6 8.5-10.5z"/><path d="M9.5 14c-2 0-3.5 1.5-3.5 3.5 0 1-1 2-2 2.5 3 1 7 0 7-4z"/>',
  air: '<path d="M7 9h7l3 3v6H7z"/><path d="M10 9V6h3v3"/><path d="M17 12h2"/><circle cx="20.5" cy="7" r=".5"/><circle cx="18" cy="5" r=".5"/><circle cx="21" cy="10" r=".5"/>',
  eraser: '<path d="M4 16l9-9 6 6-6 6H8z"/><path d="M9 11l6 6"/><path d="M8 19h12"/>',
  fill: '<path d="M5 12l7-7 7 7-7 7z"/><path d="M5 12h14"/><path d="M20 15c0 1.5 1 2.5 1 3.5a1 1 0 01-2 0c0-1 1-2 1-3.5z"/>',
  picker: '<path d="M14 4l6 6-2 2-6-6z"/><path d="M13 9l-8 8v2h2l8-8"/>',
  move: '<path d="M12 3v18M3 12h18"/><path d="M9 6l3-3 3 3M9 18l3 3 3-3M6 9l-3 3 3 3M18 9l3 3-3 3"/>',
  hand: '<path d="M8 13V6a1.5 1.5 0 013 0v5V4.5a1.5 1.5 0 013 0V11V6a1.5 1.5 0 013 0v8c0 4-2.5 7-6 7-3 0-4.5-1.5-6-4l-2-3.5a1.5 1.5 0 012.5-1.5z"/>',
  rectSel: '<path d="M4 7V4h3M10 4h4M17 4h3v3M20 10v4M20 17v3h-3M14 20h-4M7 20H4v-3M4 14v-4"/>',
  lasso: '<path d="M7 17c-3-1.5-4-4-3-6.5C5.5 6 10 4 15 4.5S21 8 20 11s-5 5-9.5 5"/><path d="M7 17c0 2 1.5 3 3 3"/><circle cx="7.5" cy="16" r="1.5"/>',
  wand: '<path d="M4 20L15 9"/><path d="M15 9l2-2"/><path d="M17 2v3M17 9v3M12 4.5l2 1.5M20 4.5l-2 1.5M22 7h-3"/>',
  transform: '<rect x="6" y="6" width="12" height="12"/><rect x="3" y="3" width="4" height="4"/><rect x="17" y="3" width="4" height="4"/><rect x="3" y="17" width="4" height="4"/><rect x="17" y="17" width="4" height="4"/>',
  eye: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  eyeOff: '<path d="M3 3l18 18"/><path d="M10.5 6.2A10 10 0 0112 6c6 0 10 6 10 6a17 17 0 01-3 3.5M6.5 7.5C4 9.3 2 12 2 12s4 7 10 7a9 9 0 004-1"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 00-1-1H5a1 1 0 00-1 1v10a1 1 0 001 1h3"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>',
  up: '<path d="M12 19V5M6 11l6-6 6 6"/>',
  down: '<path d="M12 5v14M6 13l6 6 6-6"/>',
  merge: '<path d="M7 4v5l5 5 5-5V4"/><path d="M12 14v6"/>',
  undo: '<path d="M9 14L4 9l5-5"/><path d="M4 9h11a5 5 0 010 10h-4"/>',
  redo: '<path d="M15 14l5-5-5-5"/><path d="M20 9H9a5 5 0 000 10h4"/>',
  back: '<path d="M15 18l-6-6 6-6"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 018 0v3"/>',
  clip: '<path d="M7 7h10v10"/><path d="M7 3v14h14"/>',
  swap: '<path d="M7 4L4 7l3 3"/><path d="M4 7h11a5 5 0 015 5"/><path d="M17 20l3-3-3-3"/><path d="M20 17H9a5 5 0 01-5-5"/>',
  rotL: '<path d="M4 4v6h6"/><path d="M4.5 10A8 8 0 1112 20"/>',
  rotR: '<path d="M20 4v6h-6"/><path d="M19.5 10A8 8 0 1012 20"/>',
  flip: '<path d="M12 3v18"/><path d="M8 7L3 12l5 5z"/><path d="M16 7l5 5-5 5z"/>',
  fit: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
};

export function icon(name, size = 20) {
  return `<svg class="icon" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[name] || ''}</svg>`;
}
