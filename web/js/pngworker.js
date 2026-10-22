// Encodes pictures as PNG data URLs off the main thread (doc.js canvasToDataUrl): it gets an ImageBitmap of a
// canvas, so the pixels are read back from the GPU here instead of freezing the drawing for 0.1 s on a big layer.
// It also works out the picture's key (SHA-1 of the data URL, app.py pic_key) and hands back the data URL as a Blob
// of its bytes, ready to be sent: hashing and sending a print-size layer's string on the page froze the drawing for
// 60 ms at every autosave.

self.onmessage = async e => {
  const { id, bitmap } = e.data;
  try {
    const c = new OffscreenCanvas(bitmap.width, bitmap.height);
    c.getContext('2d').drawImage(bitmap, 0, 0);
    bitmap.close();
    const blob = await c.convertToBlob({ type: 'image/png' });
    const url = new FileReaderSync().readAsDataURL(blob);
    let key = null, text = null;
    try {
      const bytes = new TextEncoder().encode(url);
      key = [...new Uint8Array(await crypto.subtle.digest('SHA-1', bytes))].map(b => b.toString(16).padStart(2, '0')).join('');
      text = new Blob([bytes]);
    } catch { /* no hashing here: the page does it */ }
    self.postMessage({ id, url, key, text });
  } catch (err) {
    self.postMessage({ id, error: String(err?.message || err) });
  }
};
