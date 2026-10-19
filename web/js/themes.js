// Colour themes for the app's own interface (never the artwork). Each theme sets the base colours in
// app.css's :root; hover, row, checker and soft accent colours are mixed from these in CSS.

export const THEME_KEYS = ['bg', 'panel', 'panel-2', 'line', 'text', 'muted', 'accent', 'accent-2', 'canvas-bg'];

export const THEMES = [
  { id: 'midnight', name: 'Midnight', colors: {
    bg: '#1e1f24', panel: '#26272d', 'panel-2': '#2e2f36', line: '#3a3b43', text: '#e6e6ea', muted: '#9a9ba5',
    accent: '#6ea8ff', 'accent-2': '#3d6fd1', 'canvas-bg': '#34353c' } },
  { id: 'rose', name: 'Dusty rose', colors: {
    bg: '#231c1f', panel: '#2c2327', 'panel-2': '#362b30', line: '#4a3a41', text: '#f1e6e9', muted: '#b39ea5',
    accent: '#e0a9b5', 'accent-2': '#9a5868', 'canvas-bg': '#3a2f34' } },
  { id: 'plum', name: 'Lavender dusk', colors: {
    bg: '#1e1b26', panel: '#262230', 'panel-2': '#2f2a3b', line: '#423b52', text: '#ebe6f4', muted: '#a49cb7',
    accent: '#bba6f2', 'accent-2': '#6f55b8', 'canvas-bg': '#332d40' } },
  { id: 'moss', name: 'Moss', colors: {
    bg: '#1a1f1c', panel: '#212824', 'panel-2': '#29312c', line: '#38433c', text: '#e3ebe5', muted: '#94a399',
    accent: '#93cb9e', 'accent-2': '#457f52', 'canvas-bg': '#2e3731' } },
  { id: 'teal', name: 'Deep sea', colors: {
    bg: '#172024', panel: '#1d272c', 'panel-2': '#243036', line: '#33434b', text: '#e0ecef', muted: '#91a6ad',
    accent: '#72c6cc', 'accent-2': '#2b7c83', 'canvas-bg': '#29363c' } },
  { id: 'cocoa', name: 'Cocoa', colors: {
    bg: '#211d19', panel: '#29241f', 'panel-2': '#322c26', line: '#463d34', text: '#efe6da', muted: '#ae9f8f',
    accent: '#e3b47f', 'accent-2': '#94612f', 'canvas-bg': '#37302a' } },
  { id: 'ink', name: 'Ink black', colors: {
    bg: '#111113', panel: '#17171a', 'panel-2': '#1f1f23', line: '#2c2c32', text: '#e4e4e8', muted: '#8d8d97',
    accent: '#a9b6ff', 'accent-2': '#5560d6', 'canvas-bg': '#1d1d21' } },
];

export const DEFAULT_THEME = 'midnight';

/** The theme with this id, or the default one for an unknown id. */
export function themeById(id) {
  return THEMES.find(t => t.id === id) || THEMES.find(t => t.id === DEFAULT_THEME);
}

/** The CSS custom properties a theme sets, as { '--bg': '#...', ... }. */
export function themeVars(theme) {
  const out = {};
  for (const k of THEME_KEYS) out['--' + k] = theme.colors[k];
  return out;
}

/** WCAG contrast ratio between two #rrggbb colours (1 to 21). */
export function contrast(a, b) {
  const lum = hex => {
    const c = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
      .map(v => v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}
