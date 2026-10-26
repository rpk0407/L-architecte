// 00 · Ouverture. The salon first shows as the brand's dot screen, then resolves into the photograph as the
// visitor starts scrolling; the red LED line of the mirror draws itself once, on arrival (hero.css).
// Both prints are baked once into canvases when the photo is decoded (a real AM halftone: one dot per cell,
// its size from the tone under it), so the scroll only fades and scales unfiltered layers.
import { track, span, ease, reduced, magnetic } from '../../../site-kit/motion';
import { $, $$ } from '../util';
import './hero.css';

/** The photo in black and white, as the CSS filter on .hero-img draws it before the bake. */
function print(img: HTMLImageElement) {
  const c = document.createElement('canvas');
  c.width = img.naturalWidth; c.height = img.naturalHeight;
  const g = c.getContext('2d')!;
  g.drawImage(img, 0, 0);
  const d = g.getImageData(0, 0, c.width, c.height), px = d.data;
  // grayscale(1) contrast(1.15) brightness(.7)
  for (let i = 0; i < px.length; i += 4) {
    const v = Math.min(255, Math.max(0, ((0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2]) - 127.5) * 1.15 + 127.5) * 0.7);
    px[i] = px[i + 1] = px[i + 2] = v;
  }
  g.putImageData(d, 0, 0);
  c.className = 'hero-print';
  return c;
}

/** The dot screen at the size it is shown: the photo averaged to one pixel per cell, then one dot per cell. */
function screen(img: HTMLImageElement, w: number, h: number) {
  const cell = innerWidth < 600 ? 7 : Math.min(10, Math.max(6, innerWidth * 0.0062));
  const cols = Math.ceil(w / cell), rows = Math.ceil(h / cell);
  const s = document.createElement('canvas');
  s.width = cols; s.height = rows;
  const sg = s.getContext('2d')!;
  sg.imageSmoothingQuality = 'high';
  sg.drawImage(img, 0, 0, cols, rows);
  const px = sg.getImageData(0, 0, cols, rows).data;
  // sharp on retina without a huge bitmap on a phone
  const dpr = Math.min(devicePixelRatio || 1, 2, Math.sqrt(2.6e6 / (w * h)));
  const c = document.createElement('canvas');
  c.width = Math.round(w * dpr); c.height = Math.round(h * dpr);
  const g = c.getContext('2d')!;
  g.scale(dpr, dpr);
  g.fillStyle = '#050404'; g.fillRect(0, 0, w, h);
  g.fillStyle = '#ECE8E0';
  g.beginPath();
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
    const i = (y * cols + x) * 4;
    // a touch of contrast so the mirror, the chairs and the light read from afar
    const l = Math.min(1, Math.max(0, ((0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2]) / 255 - 0.5) * 1.5 + 0.5));
    const r = cell * 0.56 * Math.sqrt(l);
    if (r < 0.45) continue;
    const cx = (x + 0.5) * cell, cy = (y + 0.5) * cell;
    g.moveTo(cx + r, cy);
    g.arc(cx, cy, r, 0, Math.PI * 2);
  }
  g.fill();
  return c;
}

export function mountHero() {
  const hero = $('#ouverture');
  $$('[data-magnetic]').forEach((el) => magnetic(el, 0.18));
  if (!hero || reduced()) return;
  const box = $('.hero-box', hero)!, ph = $('.hero-ph', hero)!, ht = $('.hero-ht', hero)!, img = $<HTMLImageElement>('.hero-img', hero)!;
  const card = $('.hero-card', hero)!, sub = $('.lb-sub')!;

  let bakedW = 0;
  const bake = () => {
    const w = box.offsetWidth, h = box.offsetHeight;
    if (!img.naturalWidth || !w || Math.abs(w - bakedW) < 2) return;
    try {
      if (!bakedW) ph.appendChild(print(img));
      ht.replaceChildren(screen(img, w, h));
      bakedW = w;
      box.classList.add('is-baked');
    } catch { /* no canvas: the filtered photo stays, without the dot screen */ }
  };
  if (img.complete) bake(); else img.addEventListener('load', bake, { once: true });
  let rt = 0;
  addEventListener('resize', () => { clearTimeout(rt); rt = window.setTimeout(bake, 250); }, { passive: true });

  track(hero, (p) => {
    const r = ease(span(p, 0, 0.5));
    ht.style.opacity = (1 - r).toFixed(3);
    ht.style.transform = `scale(${(1 + r * 0.14).toFixed(4)})`;
    ph.style.transform = `scale(${(1.08 - r * 0.08).toFixed(4)})`;
    card.style.transform = `translate3d(0, ${(-p * 28).toFixed(1)}px, 0)`;
    sub.style.opacity = (1 - span(p, 0.1, 0.4)).toFixed(3);
  }, 'sticky');
}
