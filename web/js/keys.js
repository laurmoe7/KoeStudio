// Keyboard shortcut matching (pure, tested).

/** F5 or Ctrl+R (with or without Shift): reload the screen. */
export function isReloadKey(e) {
  return e.key === 'F5' || ((e.ctrlKey || e.metaKey) && !e.altKey && (e.key === 'r' || e.key === 'R'));
}

/** Turns a keydown into a combo string such as 'ctrl+shift+z', '[' or 'space', for looking up in a shortcut table. */
export function comboOf(e) {
  let k = e.key === ' ' ? 'space' : e.key.toLowerCase();
  if (k === '+') k = '=';  // Ctrl+'+' and Ctrl+'=' are the same key
  const mods = [];
  if (e.ctrlKey || e.metaKey) mods.push('ctrl');
  if (e.altKey) mods.push('alt');
  // Shift is part of the combo for letters and named keys; for symbols it already changed the key ('[' -> '{').
  if (e.shiftKey && (k.length > 1 || /^[a-z0-9]$/.test(k))) mods.push('shift');
  return [...mods, k].join('+');
}

/** True when the key is being typed into a text box, so single-letter tool shortcuts should not fire. */
export function isTyping(target) {
  if (!target) return false;
  const tag = target.tagName;
  if (tag === 'TEXTAREA' || target.isContentEditable) return true;
  if (tag !== 'INPUT') return false;
  return !['range', 'checkbox', 'radio', 'button', 'color'].includes(target.type);
}

/** Holding a tool key this long (ms), or using the tool while it is held, makes its release go back to the tool before. */
export const SPRING_MS = 500;

/** Whether letting go of a held tool key returns to the tool used before it (spring-loaded tools, as in Clip Studio Paint). */
export function springBack(heldMs, used) {
  return used || heldMs >= SPRING_MS;
}
