// Which artwork the gallery shows, in what order (pure, tested): a search on the titles and a sort.

export const GALLERY_SORTS = [['modified', 'Last changed'], ['title', 'Name'], ['size', 'Biggest']];

const names = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });  // "Page 2" before "Page 10"

/**
 * The artwork whose title holds every word of the query (any case), sorted: newest change first, by name, or
 * biggest canvas first; ties go to the newest.
 */
export function galleryOrder(list, query = '', sort = 'modified') {
  const words = String(query || '').toLowerCase().split(/\s+/).filter(Boolean);
  const newest = (a, b) => (b.modified || 0) - (a.modified || 0);
  const by = {
    modified: newest,
    title: (a, b) => names.compare(String(a.title || ''), String(b.title || '')) || newest(a, b),
    size: (a, b) => (b.width * b.height || 0) - (a.width * a.height || 0) || newest(a, b),
  };
  return list.filter(a => words.every(w => String(a.title || '').toLowerCase().includes(w))).sort(by[sort] || newest);
}
