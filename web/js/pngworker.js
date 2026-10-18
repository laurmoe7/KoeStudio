// Encodes pictures as PNG data URLs off the main thread (doc.js canvasToDataUrl): it gets an ImageBitmap of a
// canvas, so the pixels are read back from the GPU here instead of freezing the drawing for 0.1 s on a big layer.

self.onmessage = async e => {
  const { id, bitmap } = e.data;
  try {
    const c = new OffscreenCanvas(bitmap.width, bitmap.height);
    c.getContext('2d').drawImage(bitmap, 0, 0);
    bitmap.close();
    const blob = await c.convertToBlob({ type: 'image/png' });
    self.postMessage({ id, url: new FileReaderSync().readAsDataURL(blob) });
  } catch (err) {
    self.postMessage({ id, error: String(err?.message || err) });
  }
};
