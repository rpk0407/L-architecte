// « Ta coupe en photo »: a photo the client picks or takes, composed in his browser into the salon's frame (a square
// 1080 × 1080 or a story 1080 × 1920: the photo, the logo, the salon's name, « Marseille »). Everything happens on a
// canvas of this page: the photo is never uploaded, never stored, never sent to the salon. No gallery either (a public
// one needs consent and moderation). Pure layout here (tested without a browser), the drawing below it.

export type FrameFormat = 'square' | 'story';
export const FRAME_SIZE: Record<FrameFormat, { w: number; h: number }> = { square: { w: 1080, h: 1080 }, story: { w: 1080, h: 1920 } };
export const FRAME_BG = '#0F0E0D';
export const FRAME_INK = '#F4EFE6';
export const FRAME_RED = '#EB4639';
export const LOGO_SRC = { dark: '/img/logo-clair.png', light: '/img/logo-sombre.png' };
/** the logo's own proportions (public/img/logo-*.png, 858 × 912) */
const LOGO_RATIO = 858 / 912;

export type Rect = { x: number; y: number; w: number; h: number };
/**
 * Where everything goes: the photo's window (the photo covers it, centred, cropped), the band under it with the logo on
 * the left and the two lines of text beside it.
 */
export function frameLayout(format: FrameFormat) {
  const { w, h } = FRAME_SIZE[format];
  const pad = 48;
  const band = format === 'story' ? 380 : 236;
  const photo: Rect = { x: pad, y: pad, w: w - 2 * pad, h: h - pad - band };
  const logoH = band - 56;
  const logo: Rect = { x: pad, y: h - band + 28, w: Math.round(logoH * LOGO_RATIO), h: logoH };
  const textX = logo.x + logo.w + 40;
  const mid = h - band / 2;
  return { w, h, pad, band, photo, logo, text: { x: textX, name: mid - 6, city: mid + 50, max: w - pad - textX } };
}

/** The part of a source (sw × sh) that covers a window of this shape, centred: what « cover » keeps of the photo. */
export function coverCrop(sw: number, sh: number, win: { w: number; h: number }): Rect {
  if (!(sw > 0) || !(sh > 0)) return { x: 0, y: 0, w: 0, h: 0 };
  const r = win.w / win.h;
  const w = sw / sh > r ? sh * r : sw, h = sw / sh > r ? sh : sw / r;
  return { x: (sw - w) / 2, y: (sh - h) / 2, w, h };
}

/** The file's name when it is saved or shared: « larchitecte-coupe-2026-11-17-carre.jpg ». */
export const frameFileName = (day: string, format: FrameFormat) => 'larchitecte-coupe-' + day + '-' + (format === 'story' ? 'story' : 'carre') + '.jpg';

type Drawable = { width: number; height: number };
/** Draw the frame on a canvas: the photo in its window (rounded), the logo, the name and « Marseille ». */
export function drawFrame(canvas: HTMLCanvasElement, o: { format: FrameFormat; photo: (CanvasImageSource & Drawable) | null; logo: (CanvasImageSource & Drawable) | null; name: string; city: string }) {
  const L = frameLayout(o.format);
  canvas.width = L.w; canvas.height = L.h;
  const g = canvas.getContext('2d');
  if (!g) return;
  g.fillStyle = FRAME_BG; g.fillRect(0, 0, L.w, L.h);
  const p = L.photo, r = 36;
  g.save();
  g.beginPath();
  g.moveTo(p.x + r, p.y); g.arcTo(p.x + p.w, p.y, p.x + p.w, p.y + p.h, r); g.arcTo(p.x + p.w, p.y + p.h, p.x, p.y + p.h, r); g.arcTo(p.x, p.y + p.h, p.x, p.y, r); g.arcTo(p.x, p.y, p.x + p.w, p.y, r);
  g.closePath(); g.clip();
  g.fillStyle = '#1B1917'; g.fillRect(p.x, p.y, p.w, p.h);
  if (o.photo) { const c = coverCrop(o.photo.width, o.photo.height, p); g.drawImage(o.photo, c.x, c.y, c.w, c.h, p.x, p.y, p.w, p.h); }
  g.restore();
  if (o.logo) g.drawImage(o.logo, L.logo.x, L.logo.y, L.logo.w, L.logo.h);
  g.fillStyle = FRAME_INK; g.textBaseline = 'alphabetic';
  g.font = '400 ' + (o.format === 'story' ? 68 : 56) + 'px "Instrument Serif", Georgia, serif';
  g.fillText(o.name, L.text.x, L.text.name, L.text.max);
  g.fillStyle = FRAME_RED;
  g.font = '600 ' + (o.format === 'story' ? 30 : 26) + 'px "Instrument Sans", system-ui, sans-serif';
  g.fillText(o.city.toUpperCase().split('').join(' '), L.text.x, L.text.city, L.text.max);
}
