// The in-page library: every measurement that has to run inside the browser.
//
// `uxInpage` is a plain function so it can be linted, read and unit-tested; the harness serialises it with toString() and
// installs it before the page’s own scripts run (addInitScript), which is what lets the vitals observers see the whole load.
// It defines window.__ux. Nothing here changes the page; the one exception is contrast(), which asks the node side to take
// a screenshot with the text hidden, so a photograph behind text can be measured instead of guessed.
//
// Rules of thumb used throughout: a thing is “visible” when a person could see it (a box, not clipped to a pixel, not
// transparent); “interactive” is anything a finger or a key can operate; sizes are CSS pixels.

export function uxInpage() {
  if (window.__ux) return;
  const ux = (window.__ux = {});

  // ── small helpers ──────────────────────────────────────────────────────────────────────────────────────────────
  const q = (s, r) => Array.from((r || document).querySelectorAll(s));
  const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();
  const labelOf = (el) => clean(el.getAttribute('aria-label') || el.getAttribute('title') || el.textContent || el.getAttribute('placeholder') || el.value || '');
  const describe = (el) => {
    if (!el || !el.tagName) return '';
    let s = el.tagName.toLowerCase();
    if (el.id) s += '#' + el.id;
    const cls = typeof el.className === 'string' ? el.className.trim().split(/\s+/).filter(Boolean).slice(0, 2) : [];
    if (cls.length) s += '.' + cls.join('.');
    const t = labelOf(el).slice(0, 30);
    return t ? s + ' “' + t + '”' : s;
  };
  ux.describe = describe;
  const inView = (r, vw, vh) => r.right > 0 && r.bottom > 0 && r.left < vw && r.top < vh && r.width > 0 && r.height > 0;
  /** A box a person could see: not collapsed to a pixel (screen-reader-only text), not transparent, not hidden. */
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return false;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none' || parseFloat(cs.opacity) < 0.05) return false;
    for (let p = el.parentElement; p; p = p.parentElement) {
      const ps = getComputedStyle(p);
      if (ps.display === 'none' || parseFloat(ps.opacity) < 0.05) return false;
    }
    return true;
  };
  const gap = (a, b) => {
    const dx = Math.max(0, Math.max(a.left, b.left) - Math.min(a.right, b.right));
    const dy = Math.max(0, Math.max(a.top, b.top) - Math.min(a.bottom, b.bottom));
    return Math.hypot(dx, dy);
  };

  // ── colour: any CSS colour to [r,g,b,a] ───────────────────────────────────────────────────────────────────────
  const cv = document.createElement('canvas');
  cv.width = cv.height = 1;
  const cx = cv.getContext('2d', { willReadFrequently: true });
  const colours = new Map();
  const rgba = (css) => {
    if (colours.has(css)) return colours.get(css);
    let out;
    const m = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/.exec(css);
    if (m) out = [+m[1], +m[2], +m[3], m[4] == null ? 1 : m[4].endsWith('%') ? parseFloat(m[4]) / 100 : +m[4]];
    else { // color(srgb …), oklch(), color-mix(): let the browser resolve it
      cx.clearRect(0, 0, 1, 1); cx.fillStyle = '#000'; cx.fillStyle = css; cx.fillRect(0, 0, 1, 1);
      const d = cx.getImageData(0, 0, 1, 1).data;
      out = [d[0], d[1], d[2], d[3] / 255];
    }
    colours.set(css, out);
    return out;
  };
  const over = (fg, bg) => [fg[0] * fg[3] + bg[0] * (1 - fg[3]), fg[1] * fg[3] + bg[1] * (1 - fg[3]), fg[2] * fg[3] + bg[2] * (1 - fg[3])];
  const lin = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  const lum = (c) => 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
  const ratio = (a, b) => { const hi = Math.max(a, b), lo = Math.min(a, b); return (hi + 0.05) / (lo + 0.05); };
  ux.lum = lum;

  // ── vitals, from the very first byte ──────────────────────────────────────────────────────────────────────────
  const v = (ux.v = { fcp: 0, lcp: 0, lcpEl: '', cls: 0, longTasks: [], inp: 0, interactions: 0 });
  const observe = (type, fn, extra) => { try { new PerformanceObserver((l) => l.getEntries().forEach(fn)).observe({ type, buffered: true, ...extra }); } catch { /* not supported */ } };
  observe('paint', (e) => { if (e.name === 'first-contentful-paint') v.fcp = e.startTime; });
  observe('largest-contentful-paint', (e) => { v.lcp = e.startTime; v.lcpEl = e.element ? describe(e.element) : e.url || ''; });
  observe('layout-shift', (e) => { if (!e.hadRecentInput) v.cls += e.value; });
  observe('longtask', (e) => v.longTasks.push([Math.round(e.startTime), Math.round(e.duration)]));
  observe('event', (e) => { if (e.interactionId) { v.interactions++; v.inp = Math.max(v.inp, e.duration); } }, { durationThreshold: 16 });
  ux.vitals = () => ({
    fcp: Math.round(v.fcp), lcp: Math.round(v.lcp), lcpEl: v.lcpEl, cls: +v.cls.toFixed(3),
    longTasks: v.longTasks.length, tbt: Math.round(v.longTasks.reduce((a, t) => a + Math.max(0, t[1] - 50), 0)),
    inp: Math.round(v.inp), interactions: v.interactions
  });

  // ── what a person sees: text and links, in the first viewport or on the whole page ────────────────────────────
  ux.seen = (scope) => {
    const vw = innerWidth, vh = innerHeight;
    const out = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = walker.nextNode())) {
      const t = clean(n.nodeValue);
      const el = n.parentElement;
      if (!t || !el || el.closest('script,style,noscript,template')) continue;
      if (!visible(el)) continue;
      if (scope === 'viewport') {
        const range = document.createRange();
        range.selectNodeContents(n);
        if (!Array.from(range.getClientRects()).some((r) => inView(r, vw, vh))) continue;
      }
      out.push(t);
    }
    const links = q('a[href],button,[role="button"]')
      .filter((el) => visible(el) && (scope !== 'viewport' || inView(el.getBoundingClientRect(), vw, vh)))
      .map((el) => ({ tag: el.tagName.toLowerCase(), href: el.getAttribute('href') || '', label: labelOf(el) }));
    return { text: out.join(' · '), links };
  };

  // ── tap targets ────────────────────────────────────────────────────────────────────────────────────────────────
  const INTERACTIVE = 'a[href],button,input:not([type="hidden"]),select,textarea,summary,[role="button"],[role="link"],[role="tab"],[role="switch"],[role="checkbox"],[role="radio"],[role="menuitem"],[tabindex]:not([tabindex="-1"])';
  /**
   * Sizes of everything a finger can hit. `min` is the comfortable size (44), `floor` the WCAG 2.5.8 minimum (24).
   * Inline links inside a sentence are exempt (the criterion’s own “inline” exception).
   */
  ux.targets = (opts) => {
    const { min = 44, floor = 24, scope = 'document', ignore = [], within = '' } = opts || {};
    const vw = innerWidth, vh = innerHeight;
    const found = [];
    for (const el of q(INTERACTIVE)) {
      if (ignore.some((s) => el.closest(s))) continue;
      if (within && !el.closest(within)) continue;
      if (el.closest('[inert],[aria-hidden="true"]')) continue;
      let box = el;
      if (el.tagName === 'INPUT' && /^(checkbox|radio)$/.test(el.type) && el.labels && el.labels[0]) box = el.labels[0];
      if (!visible(box)) continue;
      const r = box.getBoundingClientRect();
      if (r.width < 8 && r.height < 8) continue; // a focus sentinel or a status dot, not something a finger is meant to find
      if (scope === 'viewport' && !inView(r, vw, vh)) continue;
      const cs = getComputedStyle(el);
      const inline = cs.display === 'inline' && !!el.closest('p,li,dd,dt,td,figcaption,blockquote,label');
      found.push({ el, r, d: describe(el), w: Math.round(r.width), h: Math.round(r.height), x: Math.round(r.left), y: Math.round(r.top + scrollY), inline });
    }
    const sized = found.filter((t) => !t.inline);
    const under = sized.filter((t) => t.w < min || t.h < min);
    // WCAG 2.5.8: a target under 24 px is acceptable when a 24 px circle centred on it touches no other target and no other undersized circle
    const undersized = sized.filter((t) => t.w < floor || t.h < floor);
    const circle = (t) => ({ x: t.r.left + t.r.width / 2, y: t.r.top + t.r.height / 2, r: floor / 2 });
    const hitsBox = (c, r) => { const dx = Math.max(r.left - c.x, 0, c.x - r.right), dy = Math.max(r.top - c.y, 0, c.y - r.bottom); return Math.hypot(dx, dy) < c.r; };
    const below = undersized.filter((t) => {
      const c = circle(t);
      return sized.some((o) => o !== t && !o.el.contains(t.el) && !t.el.contains(o.el) && hitsBox(c, o.r))
        || undersized.some((o) => { if (o === t) return false; const d = circle(o); return Math.hypot(c.x - d.x, c.y - d.y) < c.r + d.r; });
    });
    const tight = [];
    const small = (t) => Math.min(t.w, t.h) < 32; // a 40 px pill beside another is fine; a 28 px one is not
    for (const a of under.filter(small)) {
      for (const b of sized) {
        if (a === b || a.el.contains(b.el) || b.el.contains(a.el)) continue;
        const g = gap(a.r, b.r);
        if (g < 8 && !tight.some((p) => p.a === b.d && p.b === a.d)) tight.push({ a: a.d, b: b.d, gap: Math.round(g) });
      }
    }
    const strip = (t) => ({ d: t.d, w: t.w, h: t.h, x: t.x, y: t.y });
    return { total: found.length, counted: sized.length, under: under.map(strip), below: below.map(strip), small: sized.filter(small).map(strip), tight: tight.slice(0, 20), min, floor };
  };

  // ── fixed interface laid over the content ──────────────────────────────────────────────────────────────────────
  /**
   * Share of the viewport covered by fixed interface at rest, overall and in the thumb zone (bottom 40%).
   * A fixed wrapper is often transparent and click-through while its children paint the pills, so what is measured is the painted
   * surface (a background, an image) inside each outermost fixed layer. A sticky block sits in the flow and is not an overlay.
   */
  ux.coverage = () => {
    const vw = innerWidth, vh = innerHeight;
    const surface = (el) => { const cs = getComputedStyle(el); return rgba(cs.backgroundColor)[3] > 0.08 || cs.backgroundImage !== 'none' || /^(IMG|VIDEO|CANVAS)$/i.test(el.tagName); };
    const fixed = q('body *').filter((el) => getComputedStyle(el).position === 'fixed');
    const tops = fixed.filter((el) => !fixed.some((o) => o !== el && o.contains(el)));
    const rects = [];
    for (const top of tops) {
      for (const el of [top, ...q('*', top)]) {
        if (!visible(el) || !surface(el)) continue;
        const r = el.getBoundingClientRect();
        if (!inView(r, vw, vh) || r.width * r.height > vw * vh * 0.85) continue; // a full-screen backdrop is a scene, not an overlay
        rects.push({ d: describe(el), r });
      }
    }
    const step = 6;
    let all = 0, covered = 0, zone = 0, zoneCovered = 0;
    for (let y = step / 2; y < vh; y += step) {
      for (let x = step / 2; x < vw; x += step) {
        const hit = rects.some(({ r }) => x >= r.left && x <= r.right && y >= r.top && y <= r.bottom);
        all++; if (hit) covered++;
        if (y >= vh * 0.6) { zone++; if (hit) zoneCovered++; }
      }
    }
    return {
      vw, vh, ratio: +(covered / all).toFixed(3), thumbZone: +(zoneCovered / zone).toFixed(3),
      layers: rects.map(({ d, r }) => ({ d, x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) }))
    };
  };

  /** Interactive things whose centre is under something else (a sticky bar over the footer, a field under the keyboard’s footer). */
  ux.obscured = (opts) => {
    const { scope = 'viewport', within, zone } = opts || {};
    const vw = innerWidth, vh = innerHeight;
    const out = [];
    for (const el of q(within ? within + ' ' + INTERACTIVE.split(',').join(',' + within + ' ') : INTERACTIVE)) {
      if (el.closest('[inert],[aria-hidden="true"]') || !visible(el)) continue;
      const r = el.getBoundingClientRect();
      if (scope === 'viewport' && !inView(r, vw, vh)) continue;
      if (zone === 'bottom' && r.top + r.height / 2 < vh * 0.65) continue; // above that, scrolling up reveals it: only the foot of the page is stuck
      const cx0 = Math.min(vw - 1, Math.max(0, r.left + r.width / 2)), cy0 = Math.min(vh - 1, Math.max(0, r.top + r.height / 2));
      const top = document.elementFromPoint(cx0, cy0);
      if (top && top !== el && !el.contains(top) && !top.contains(el)) out.push({ d: describe(el), by: describe(top) });
    }
    return out;
  };

  // ── reflow, text size ──────────────────────────────────────────────────────────────────────────────────────────
  ux.reflow = () => {
    const vw = document.documentElement.clientWidth;
    const sw = document.documentElement.scrollWidth;
    const off = [];
    for (const el of q('body *')) {
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2 || (r.right <= vw + 1 && r.left >= -1)) continue;
      let scroller = false;
      for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
        const o = getComputedStyle(p).overflowX;
        if (/auto|scroll|hidden|clip/.test(o) && p.getBoundingClientRect().right <= vw + 1) { scroller = true; break; }
      }
      if (!scroller && visible(el)) off.push({ d: describe(el), left: Math.round(r.left), right: Math.round(r.right) });
    }
    return { vw, sw, overflow: sw - vw, off: off.slice(0, 12) };
  };

  ux.textSizes = () => {
    let chars = 0, small = 0, tiny = 0, minPx = 99;
    const smallest = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = walker.nextNode())) {
      const t = clean(n.nodeValue);
      const el = n.parentElement;
      if (!t || !el || el.closest('script,style,noscript,template') || !visible(el)) continue;
      const px = parseFloat(getComputedStyle(el).fontSize);
      chars += t.length;
      if (px < 14) { small += t.length; if (smallest.length < 6) smallest.push({ d: describe(el), px: +px.toFixed(1) }); }
      if (px < 12) tiny += t.length;
      minPx = Math.min(minPx, px);
    }
    return { chars, under14: chars ? +(small / chars).toFixed(3) : 0, under12: chars ? +(tiny / chars).toFixed(3) : 0, minPx: +minPx.toFixed(1), smallest };
  };

  // ── contrast ───────────────────────────────────────────────────────────────────────────────────────────────────
  /** Walk the paint stack under a point; a photograph or gradient there means “measure the pixels instead”. */
  const backdrop = (el, x, y) => {
    const stack = document.elementsFromPoint(x, y);
    let i = stack.findIndex((e) => e === el || el.contains(e));
    if (i < 0) i = 0;
    const layers = [];
    for (let k = i; k < stack.length; k++) {
      const e = stack[k];
      const cs = getComputedStyle(e);
      if (/^(IMG|VIDEO|CANVAS|PICTURE|SVG)$/i.test(e.tagName) && e !== el && !el.contains(e)) return { pixels: true, why: e.tagName.toLowerCase() };
      if (cs.backgroundImage && cs.backgroundImage !== 'none') return { pixels: true, why: 'background-image' };
      const c = rgba(cs.backgroundColor);
      if (c[3] > 0) layers.push(c);
      if (c[3] >= 0.999) break;
    }
    let base = [255, 255, 255];
    for (let k = layers.length - 1; k >= 0; k--) base = over(layers[k], base);
    return { color: base };
  };

  /** Every text element in view with its colour, its size and either a resolved ratio or the rectangles to sample. */
  ux.contrast = (opts) => {
    const { scope = 'viewport' } = opts || {};
    const vw = innerWidth, vh = innerHeight;
    const byEl = new Map();
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = walker.nextNode())) {
      const t = clean(n.nodeValue);
      const el = n.parentElement;
      if (!t || !el || el.closest('script,style,noscript,template,[disabled]') || !visible(el)) continue;
      const range = document.createRange();
      range.selectNodeContents(n);
      const rects = Array.from(range.getClientRects()).filter((r) => r.width > 1 && r.height > 1 && (scope !== 'viewport' || inView(r, vw, vh)));
      if (!rects.length) continue;
      const e = byEl.get(el) || { el, text: '', rects: [] };
      e.text += (e.text ? ' ' : '') + t;
      e.rects.push(...rects.map((r) => ({ x: r.left, y: r.top, w: r.width, h: r.height })));
      byEl.set(el, e);
    }
    const items = [];
    for (const { el, text, rects } of byEl.values()) {
      const cs = getComputedStyle(el);
      let opacity = 1;
      for (let p = el; p; p = p.parentElement) opacity *= parseFloat(getComputedStyle(p).opacity);
      const fg = rgba(cs.color).slice(); // a copy: the colour cache is shared, and a faded element must not fade every other element that uses the same ink
      fg[3] *= opacity;
      const px = parseFloat(cs.fontSize), weight = parseInt(cs.fontWeight, 10) || 400;
      const large = px >= 24 || (px >= 18.66 && weight >= 700);
      const c = rects[0];
      const back = backdrop(el, Math.min(vw - 1, Math.max(0, c.x + c.w / 2)), Math.min(vh - 1, Math.max(0, c.y + c.h / 2)));
      const item = { d: describe(el), text: text.slice(0, 40), px: +px.toFixed(1), large, required: large ? 3 : 4.5, fg: [Math.round(fg[0]), Math.round(fg[1]), Math.round(fg[2]), +fg[3].toFixed(2)], op: +opacity.toFixed(2), at: [Math.round(c.x), Math.round(c.y), Math.round(c.w), Math.round(c.h)] };
      if (back.pixels) { item.pixels = true; item.why = back.why; item.rects = rects; }
      else { const eff = over(fg, back.color); item.ratio = +ratio(lum(eff), lum(back.color)).toFixed(2); }
      items.push(item);
    }
    return items;
  };
  /** Hide all text so the node side can photograph only what lies behind it. */
  ux.hideText = (on) => {
    let s = document.getElementById('__ux_hide');
    if (on && !s) {
      s = document.createElement('style');
      s.id = '__ux_hide';
      s.textContent = '*,*::before,*::after{color:transparent!important;-webkit-text-fill-color:transparent!important;text-shadow:none!important;caret-color:transparent!important}::placeholder{color:transparent!important}';
      document.head.appendChild(s);
    } else if (!on && s) s.remove();
  };

  // ── semantics, motion, images ──────────────────────────────────────────────────────────────────────────────────
  ux.semantics = () => {
    const heads = q('h1,h2,h3,h4,h5,h6').filter((h) => visible(h) || h.classList.contains('vh'));
    let skips = 0, last = 0;
    for (const h of heads) { const lv = +h.tagName[1]; if (last && lv > last + 1) skips++; last = lv; }
    const named = (el) => !!(labelOf(el) || el.getAttribute('aria-labelledby') || el.querySelector('img[alt]:not([alt=""])'));
    const fields = q('input:not([type="hidden"]):not([type="submit"]):not([type="button"]),select,textarea').filter((el) => visible(el) && !el.closest('[inert],[aria-hidden="true"]'));
    const unlabelled = fields.filter((el) => !(el.labels && el.labels.length) && !el.getAttribute('aria-label') && !el.getAttribute('aria-labelledby') && !el.title);
    const ids = {};
    q('[id]').forEach((el) => { ids[el.id] = (ids[el.id] || 0) + 1; });
    const vp = document.querySelector('meta[name="viewport"]');
    const vpc = vp ? vp.getAttribute('content') || '' : '';
    return {
      lang: document.documentElement.lang || '', title: document.title,
      description: !!document.querySelector('meta[name="description"]'),
      ogImage: !!document.querySelector('meta[property="og:image"]'), ogTitle: !!document.querySelector('meta[property="og:title"]'), canonical: !!document.querySelector('link[rel="canonical"]'),
      jsonld: q('script[type="application/ld+json"]').length,
      h1: q('h1').length, headingSkips: skips,
      landmarks: { main: !!document.querySelector('main,[role="main"]'), nav: !!document.querySelector('nav,[role="navigation"]'), header: !!document.querySelector('header,[role="banner"]'), footer: !!document.querySelector('footer,[role="contentinfo"]') },
      imgNoAlt: q('img').filter((i) => !i.hasAttribute('alt')).length,
      unnamedControls: q('a[href],button,[role="button"]').filter((el) => visible(el) && !el.closest('[inert],[aria-hidden="true"]') && !named(el)).map(describe).slice(0, 8),
      unlabelledFields: unlabelled.map(describe).slice(0, 8),
      duplicateIds: Object.keys(ids).filter((k) => ids[k] > 1).slice(0, 8),
      zoomLocked: /user-scalable\s*=\s*(no|0)|maximum-scale\s*=\s*(0?\.\d+|1(\.0+)?)\b/i.test(vpc), viewportMeta: vpc
    };
  };

  ux.motion = () => {
    const vw = innerWidth, vh = innerHeight;
    const LAYOUT = /^(width|height|top|left|right|bottom|margin|padding|border-width|font-size|line-height|letter-spacing|gap|flex|grid|inset|min-|max-)/;
    const PAINT = /^(color|background|box-shadow|border|outline|fill|stroke|text-shadow|filter|backdrop)/;
    const kebab = (p) => p.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase());
    const out = { total: 0, running: 0, infinite: 0, infiniteVisible: [], layout: [], paint: 0, compositor: 0 };
    for (const a of document.getAnimations()) {
      const eff = a.effect;
      if (!eff) continue;
      out.total++;
      let props = [];
      try { props = [...new Set(eff.getKeyframes().flatMap((k) => Object.keys(k).filter((p) => !/^(offset|easing|composite|computedOffset)$/.test(p))))].map(kebab); } catch { /* not a keyframe effect */ }
      if (a.transitionProperty) props = [a.transitionProperty];
      const timing = eff.getComputedTiming();
      const target = eff.target;
      const r = target && target.getBoundingClientRect ? target.getBoundingClientRect() : null;
      const on = !!r && inView(r, vw, vh);
      if (a.playState === 'running') out.running++;
      if (timing.iterations === Infinity && a.playState === 'running') { out.infinite++; if (on) out.infiniteVisible.push({ d: describe(target), props }); }
      for (const p of props) {
        if (LAYOUT.test(p)) out.layout.push({ d: describe(target), p });
        else if (PAINT.test(p)) out.paint++;
        else out.compositor++;
      }
    }
    return out;
  };

  ux.images = () => {
    const vh = innerHeight;
    return q('img').filter((i) => i.currentSrc || i.src).map((i) => {
      const r = i.getBoundingClientRect();
      const shown = Math.max(1, r.width) * (window.devicePixelRatio || 1);
      return {
        src: (i.getAttribute('src') || '').slice(0, 60), alt: i.getAttribute('alt'), nw: i.naturalWidth, shown: Math.round(r.width),
        oversize: +(i.naturalWidth / shown).toFixed(2), hasSize: i.hasAttribute('width') && i.hasAttribute('height'),
        lazy: i.loading === 'lazy', belowFold: r.top > vh * 1.5, priority: i.getAttribute('fetchpriority') || ''
      };
    });
  };

  // ── focus, for the keyboard walk done on the node side ─────────────────────────────────────────────────────────
  const sig = (el) => { const cs = getComputedStyle(el); return [cs.outlineStyle, cs.outlineWidth, cs.outlineColor, cs.boxShadow, cs.borderTopColor, cs.backgroundColor, cs.color, cs.textDecorationLine].join('|'); };
  ux.sigs = new WeakMap();
  ux.snapSigs = () => { q(INTERACTIVE).forEach((el) => ux.sigs.set(el, sig(el))); };
  ux.focusInfo = () => {
    const el = document.activeElement;
    if (!el || el === document.body) return null;
    const cs = getComputedStyle(el);
    const outline = cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0;
    const changed = ux.sigs.has(el) ? ux.sigs.get(el) !== sig(el) : outline;
    const r = el.getBoundingClientRect();
    const cxp = r.left + r.width / 2, cyp = r.top + r.height / 2;
    const onScreen = cxp >= 0 && cxp < innerWidth && cyp >= 0 && cyp < innerHeight && r.width > 0;
    const top = onScreen ? document.elementFromPoint(cxp, cyp) : null;
    const hidden = !!top && top !== el && !el.contains(top) && !top.contains(el);
    return { d: describe(el), visibleIndicator: outline || changed, outline, offscreen: !onScreen, obscured: hidden, by: hidden ? describe(top) : '', inDialog: !!el.closest('[role="dialog"]') };
  };
}
