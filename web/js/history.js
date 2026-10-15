// Undo/redo stack (pure, tested). Each entry is { label, undo(), redo(), bytes }.
// Entries are dropped from the oldest end when there are more than maxSteps or they hold more than maxBytes.

export class History {
  constructor({ maxSteps = 100, maxBytes = 600 * 1024 * 1024 } = {}) {
    this.maxSteps = maxSteps;
    this.maxBytes = maxBytes;
    this.done = [];
    this.undone = [];
    this.onChange = null;
  }
  get bytes() {
    let n = 0;
    for (const e of this.done) n += e.bytes || 0;
    for (const e of this.undone) n += e.bytes || 0;
    return n;
  }
  push(entry) {
    this.done.push(entry);
    this.undone = [];
    while (this.done.length > 1 && (this.done.length > this.maxSteps || this.bytes > this.maxBytes)) this.done.shift();
    this.onChange?.();
  }
  undo() {
    const e = this.done.pop();
    if (!e) return null;
    e.undo();
    this.undone.push(e);
    this.onChange?.();
    return e;
  }
  redo() {
    const e = this.undone.pop();
    if (!e) return null;
    e.redo();
    this.done.push(e);
    this.onChange?.();
    return e;
  }
  /** Undoes or redoes until n steps are done (0 = back to the oldest kept state), for the History panel. */
  goTo(n) {
    const quiet = this.onChange;
    this.onChange = null;  // one notice at the end, not one per step
    try {
      while (this.done.length > n && this.undo());
      while (this.done.length < n && this.redo());
    } finally {
      this.onChange = quiet;
    }
    this.onChange?.();
  }
  /** Every step's label, oldest first, and how many of them are done (the rest are undone, ready to redo). */
  get steps() {
    return { labels: [...this.done.map(e => e.label), ...this.undone.slice().reverse().map(e => e.label)], done: this.done.length };
  }
  get canUndo() { return this.done.length > 0; }
  get canRedo() { return this.undone.length > 0; }
  clear() {
    this.done = [];
    this.undone = [];
    this.onChange?.();
  }
}
