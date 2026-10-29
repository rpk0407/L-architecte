// The focus ring of a control, measured the way a keyboard user meets it (shared by the end-to-end scenarios of the client space).

/**
 * The focus ring of a control reached by keyboard (a Tab first, so :focus-visible matches): drawn, and at least 3:1 against the surface
 * behind it (the first opaque background up the tree, the translucent layers over it composed). The ring takes a token of the theme, never
 * the control's own text colour: on the brand red, on the skip link or on an ink-filled chip that is the colour of what lies behind it.
 */
export async function focusRing(page, selector, where) {
  await page.keyboard.press('Tab');
  const r = await page.locator(selector).first().evaluate((el) => {
    el.focus({ preventScroll: true });
    const rgba = (c) => { const m = /rgba?\(([^)]+)\)/.exec(c); const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number); return { c: p.slice(0, 3), a: p.length > 3 ? p[3] : 1 }; };
    const layers = [];
    for (let n = el.parentElement; n; n = n.parentElement) { const b = getComputedStyle(n).backgroundColor, p = rgba(b); if (p.a > 0) layers.push(p); if (p.a === 1) break; }
    let bg = [255, 255, 255];
    for (const p of layers.reverse()) bg = bg.map((v, i) => p.c[i] * p.a + v * (1 - p.a));
    const cs = getComputedStyle(el), o = rgba(cs.outlineColor);
    const ringC = o.c.map((v, i) => v * o.a + bg[i] * (1 - o.a));
    const lum = (c) => { const l = c.map((x) => { x /= 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); }); return 0.2126 * l[0] + 0.7152 * l[1] + 0.0722 * l[2]; };
    const a = lum(ringC), b = lum(bg);
    return { visible: el.matches(':focus-visible'), style: cs.outlineStyle, width: parseFloat(cs.outlineWidth), ring: cs.outlineColor, ratio: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05) };
  });
  if (!r.visible || r.style === 'none' || r.width < 2) throw new Error(where + ': no focus ring on ' + selector + ' ' + JSON.stringify(r));
  if (r.ratio < 3) throw new Error(where + ': the focus ring of ' + selector + ' is ' + r.ratio.toFixed(2) + ':1 against what is behind it (' + r.ring + ')');
}
