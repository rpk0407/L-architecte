// WCAG contrast arithmetic on the node side (the in-page twin lives in inpage.mjs): used to turn sampled pixels into a ratio,
// and by the unit tests that check the formulas against the values the WCAG itself publishes.

/** sRGB channel (0–255) to linear light. */
export const toLinear = (c) => { const v = c / 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };

/** Relative luminance of an [r,g,b] colour, 0 (black) to 1 (white). */
export const luminance = ([r, g, b]) => 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);

/** Contrast ratio between two luminances, 1 to 21, in either order. */
export const ratio = (a, b) => { const hi = Math.max(a, b), lo = Math.min(a, b); return (hi + 0.05) / (lo + 0.05); };

/** WCAG large text: 24 px, or 18.66 px (14 pt) and bold. */
export const isLarge = (px, weight = 400) => px >= 24 || (px >= 18.66 && weight >= 700);

/** The ratio a piece of text must reach for AA. */
export const required = (px, weight = 400) => (isLarge(px, weight) ? 3 : 4.5);

/** [r,g,b,a] over an opaque [r,g,b]. */
export const over = ([r, g, b, a], [br, bg, bb]) => [r * a + br * (1 - a), g * a + bg * (1 - a), b * a + bb * (1 - a)];

/** #rgb, #rrggbb or rgb()/rgba() to [r,g,b,a] (for tests and fixtures; the browser resolves everything else itself). */
export function parseColor(css) {
  const s = String(css).trim();
  let m = /^#([0-9a-f]{3})$/i.exec(s);
  if (m) return [...m[1]].map((h) => parseInt(h + h, 16)).concat(1);
  m = /^#([0-9a-f]{6})$/i.exec(s);
  if (m) return [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16)).concat(1);
  m = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+))?\s*\)$/.exec(s);
  if (m) return [+m[1], +m[2], +m[3], m[4] == null ? 1 : +m[4]];
  throw new Error('cannot parse colour: ' + css);
}

/**
 * Contrast of text over a backdrop that varies (a photograph). The worst case is what a reader meets:
 * light text fails on the lightest pixels, dark text on the darkest. `bg` carries the luminance percentiles sampled behind the text.
 * @param {number[]} fg [r,g,b,a] @param {{ p05: number, p50: number, p95: number }} bg
 */
export function overPixels(fg, bg) {
  const mid = bg.p50;
  // composite a translucent text colour over the median backdrop, as a first approximation
  const grey = 255 * (mid <= 0.0031308 ? mid * 12.92 : 1.055 * mid ** (1 / 2.4) - 0.055);
  const eff = fg[3] >= 0.999 ? fg : over(fg, [grey, grey, grey]);
  const lf = luminance(eff);
  const worst = lf >= mid ? bg.p95 : bg.p05;
  return { worst: ratio(lf, worst), median: ratio(lf, mid) };
}
