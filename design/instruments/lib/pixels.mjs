// Pixels, with no image library: a PNG goes into a throwaway canvas inside the same browser, and what comes back is the
// luminance spread behind each rectangle. Screenshots are taken at device scale 1, so a CSS pixel is an image pixel.

/**
 * Luminance percentiles (linear light, 0–1) behind each rectangle of a screenshot.
 * @param {import('playwright').Page} helper a blank page, kept for the run @param {Buffer} png @param {{ x: number, y: number, w: number, h: number }[]} rects
 */
export async function lumaBehind(helper, png, rects) {
  return helper.evaluate(async ({ b64, rects: rs }) => {
    const img = new Image();
    img.src = 'data:image/png;base64,' + b64;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.naturalWidth; c.height = img.naturalHeight;
    const g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(img, 0, 0);
    const lin = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return rs.map((r) => {
      const x = Math.max(0, Math.floor(r.x)), y = Math.max(0, Math.floor(r.y));
      const w = Math.min(c.width - x, Math.ceil(r.w)), h = Math.min(c.height - y, Math.ceil(r.h));
      if (w < 1 || h < 1) return null;
      const d = g.getImageData(x, y, w, h).data;
      const step = Math.max(1, Math.floor(d.length / 4 / 4000)); // at most ~4000 samples per rectangle
      const L = [];
      for (let i = 0; i < d.length; i += 4 * step) L.push(0.2126 * lin(d[i]) + 0.7152 * lin(d[i + 1]) + 0.0722 * lin(d[i + 2]));
      L.sort((a, b) => a - b);
      const at = (p) => L[Math.min(L.length - 1, Math.floor(p * L.length))];
      return { p05: at(0.05), p50: at(0.5), p95: at(0.95), n: L.length };
    });
  }, { b64: png.toString('base64'), rects });
}

/** Mean luminance (linear light) of a whole screenshot, and of each horizontal band of `bands` slices. */
export async function lumaBands(helper, png, bands) {
  return helper.evaluate(async ({ b64, n }) => {
    const img = new Image();
    img.src = 'data:image/png;base64,' + b64;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.naturalWidth; c.height = img.naturalHeight;
    const g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(img, 0, 0);
    const lin = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    const out = [];
    const bh = Math.floor(c.height / n);
    for (let b = 0; b < n; b++) {
      const d = g.getImageData(0, b * bh, c.width, bh).data;
      let s = 0, k = 0;
      for (let i = 0; i < d.length; i += 4 * 37) { s += 0.2126 * lin(d[i]) + 0.7152 * lin(d[i + 1]) + 0.0722 * lin(d[i + 2]); k++; }
      out.push(s / k);
    }
    return out;
  }, { b64: png.toString('base64'), n: bands });
}
