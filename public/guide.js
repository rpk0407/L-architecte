/* The site's first-visit guide: what each part of the page does, in a few steps, never in the way.
   The steps are written in the page, on the parts they describe (site.html), as
     data-guide="id"  data-guide-n="30"  data-guide-title="Mon espace"  data-guide-body="Deux phrases courtes."
   (a second and third step on the same part: data-guide-title-2 / -body-2 / -n-2, then -3; data-guide-scroll="top" for a
   part that only shows at the top of the page). A part that is not on the page today (membership off, no client space)
   simply has no step. Order is data-guide-n.
     - first visit: a small bubble « Première visite ? » appears once (localStorage, nothing if it cannot remember);
       « Voir » plays the steps, « × » hides it for good
     - « Comment ça marche ? » in any footer (a link to /?visite) plays them again
   The tour dims the page, cuts a spotlight around the part and glides a card next to it; Escape or « Passer » leaves
   at any time, ← → move, Tab stays in the card. Everything goes in through textContent. guide.css is added by this file
   when the bubble or the tour first shows, so the page's first paint never waits for it. Under prefers-reduced-motion
   nothing moves: the same steps, shown at once. */
(function () {
  'use strict';
  var SEEN = 'lx-guide';
  var SUFFIX = ['', '-2', '-3'];
  var PAD = 8;
  var st = null; // the running tour
  var bub = null; // the invitation

  function stored(k) { try { return window.localStorage.getItem(k); } catch (e) { return null; } }
  function keep(k, v) { try { window.localStorage.setItem(k, v); return window.localStorage.getItem(k) === v; } catch (e) { return false; } }
  function still() { return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); }
  function h(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function clamp(x, a, b) { return Math.max(a, Math.min(b, x)); }
  function vwh() { var d = document.documentElement; return [d.clientWidth || window.innerWidth, window.innerHeight]; }
  function cross() {
    var NS = 'http://www.w3.org/2000/svg', svg = document.createElementNS(NS, 'svg'), path = document.createElementNS(NS, 'path');
    svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('fill', 'none'); svg.setAttribute('stroke', 'currentColor'); svg.setAttribute('stroke-width', '1.9'); svg.setAttribute('stroke-linecap', 'round'); svg.setAttribute('aria-hidden', 'true');
    path.setAttribute('d', 'M6 6l12 12M18 6L6 18'); svg.appendChild(path);
    return svg;
  }
  /* the page's own accent and fonts, so the guide is never a different product (the css holds plain fallbacks) */
  function theme(el) {
    try {
      var c = window.getComputedStyle(document.querySelector('.lp') || document.body);
      ['--rouge', '--f-serif', '--f-sans'].forEach(function (k) { var v = c.getPropertyValue(k).trim(); if (v) el.style.setProperty(k, v); });
    } catch (e) { /* the css defaults */ }
  }
  function waitFor(test, then, ms, late) {
    var t0 = Date.now(), iv = setInterval(function () {
      var ok = test();
      if (ok || Date.now() - t0 > (ms || 8000)) { clearInterval(iv); if (ok) then(); else if (late) late(); }
    }, 120);
  }
  /* the stylesheet is added by this file (so the page's head never waits for it); then() runs once it is in, never without it
     (an unstyled bubble would sit in the page's flow), and not at all if it cannot load */
  var sheet = null, me = document.currentScript; // read while the file runs
  function withCss(then) {
    if (sheet) { if (sheet.ok === null) sheet.q.push(then); else if (sheet.ok) then(); return; }
    sheet = { ok: null, q: [then] };
    var fin = function (ok) { sheet.ok = ok; var q = sheet.q; sheet.q = []; if (ok) q.forEach(function (f) { f(); }); };
    var l = document.createElement('link');
    l.rel = 'stylesheet'; l.href = me && me.src ? me.src.replace(/\.js(\?.*)?$/, '.css') : '/guide.css';
    l.onload = function () { fin(true); }; l.onerror = function () { fin(false); };
    document.head.appendChild(l);
  }

  /* ---------- the steps: the marked parts that are on the page now ---------- */
  function collect() {
    var out = [], marks = document.querySelectorAll('[data-guide][data-guide-title]');
    for (var i = 0; i < marks.length; i++) {
      var m = marks[i];
      if (m.closest('x-dc') || !m.getClientRects().length) continue; // the raw template is not the page
      for (var j = 0; j < SUFFIX.length; j++) {
        var title = m.getAttribute('data-guide-title' + SUFFIX[j]);
        var body = m.getAttribute('data-guide-body' + SUFFIX[j]) || '';
        if (!title || title.indexOf('{{') >= 0 || body.indexOf('{{') >= 0) continue; // empty, or not rendered yet
        out.push({
          mark: m.getAttribute('data-guide'), title: title, body: body,
          n: Number(m.getAttribute('data-guide-n' + SUFFIX[j])) || 0, top: m.getAttribute('data-guide-scroll') === 'top'
        });
      }
    }
    return out.sort(function (a, b) { return a.n - b.n; });
  }
  function find(s) { return document.querySelector('[data-guide="' + s.mark + '"]'); }
  function fixedAbove(e) {
    for (; e && e.nodeType === 1; e = e.parentElement) if (window.getComputedStyle(e).position === 'fixed') return true;
    return false;
  }

  /* ---------- the tour ---------- */
  var starting = false;
  function start(opener) {
    if (st || starting) return;
    starting = true;
    withCss(function () { starting = false; play(opener); });
    setTimeout(function () { starting = false; }, 8000); // the sheet never came: a later tap may try again
  }
  function play(opener) {
    if (st) return;
    var steps = collect();
    if (!steps.length) return;
    closeBubble();
    keep(SEEN, '1');
    var root = h('div', 'gd-root'), spot = h('div', 'gd-spot'), card = h('div', 'gd-card gd-pre');
    theme(root);
    card.setAttribute('role', 'dialog'); card.setAttribute('aria-modal', 'true'); card.setAttribute('aria-labelledby', 'gd-t'); card.setAttribute('aria-describedby', 'gd-b'); card.tabIndex = -1;
    var ar = h('span', 'gd-ar'), inner = h('div'), k = h('p', 'gd-k'), t = h('h2', 'gd-t'), b = h('p', 'gd-b'), dots = h('div', 'gd-dots');
    t.id = 'gd-t'; b.id = 'gd-b'; dots.setAttribute('aria-hidden', 'true');
    steps.forEach(function () { dots.appendChild(h('i')); });
    var nav = h('div', 'gd-nav'), pass = h('button', 'gd-pass', 'Passer'), prev = h('button', 'gd-prev', 'Retour'), next = h('button', 'gd-next', 'Suivant');
    pass.type = prev.type = next.type = 'button';
    nav.appendChild(pass); nav.appendChild(prev); nav.appendChild(next);
    inner.appendChild(k); inner.appendChild(t); inner.appendChild(b);
    card.appendChild(ar); card.appendChild(inner); card.appendChild(dots); card.appendChild(nav);
    var say = h('p', 'gd-vh'); say.setAttribute('role', 'status'); say.setAttribute('aria-live', 'polite');
    root.appendChild(spot); root.appendChild(card); root.appendChild(say);
    document.body.appendChild(root);

    st = { steps: steps, i: -1, root: root, spot: spot, card: card, ar: ar, inner: inner, opener: opener || null, at: 0, moved: Date.now(), y: window.scrollY, ready: false, shown: false, key: '', rect: null, raf: 0, spotted: false };
    /* parts that came after the tour began (the membership, the client space) join the list at the next move */
    var refresh = function () {
      var fresh = collect(), cur = st.steps[st.i], at = -1, key = function (l) { return l.map(function (x) { return x.mark + '|' + x.title + '|' + x.body; }).join(); };
      if (key(fresh) === key(st.steps)) return;
      fresh.forEach(function (x, n) { if (x.mark === cur.mark && x.title === cur.title) at = n; });
      if (at < 0) return;
      st.steps = fresh; st.i = at;
      while (dots.firstChild) dots.removeChild(dots.firstChild);
      fresh.forEach(function () { dots.appendChild(h('i')); });
    };
    var go = function (d) { refresh(); var n = st.steps.length, j = st.i + d; if (j >= n) end(); else if (j >= 0) show(j); };
    next.addEventListener('click', function () { go(1); });
    prev.addEventListener('click', function () { go(-1); });
    pass.addEventListener('click', function () { end(); });
    root.addEventListener('click', function (e) { e.stopPropagation(); });
    document.addEventListener('keydown', keys, true);
    show(0);
    card.focus({ preventScroll: true });
    st.raf = requestAnimationFrame(frame);

    function show(j) {
      var steps = st.steps, s = steps[j], target = find(s);
      st.i = j; st.ready = false; st.at = Date.now(); st.moved = st.at; st.key = '';
      inner.classList.remove('gd-in'); void inner.offsetWidth; inner.classList.add('gd-in');
      k.textContent = (j + 1) + ' / ' + steps.length; t.textContent = s.title; b.textContent = s.body;
      prev.hidden = j === 0; pass.hidden = j === steps.length - 1; next.textContent = j === steps.length - 1 ? 'Terminé' : 'Suivant';
      var d = dots.children; for (var x = 0; x < d.length; x++) d[x].className = x === j ? 'on' : (x < j ? 'done' : '');
      say.textContent = 'Étape ' + (j + 1) + ' sur ' + steps.length + ' : ' + s.title + '. ' + s.body;
      if (st.rect) { // the spotlight closes where it was while the page moves, and opens on the next part
        var o = st.rect;
        spot.style.transform = 'translate3d(' + (o.left + o.right) / 2 + 'px,' + (o.top + o.bottom) / 2 + 'px,0)'; spot.style.width = '0px'; spot.style.height = '0px';
      }
      bring(s, target);
      if (st.rect) place(st.rect); // the card may be taller or shorter than the last one
    }
  }

  /* put the part where the card leaves room for it: the screen scrolls only when the part is not already in view */
  function scrollTo(y) {
    y = Math.max(0, y);
    // a long way (the footer from the top) jumps: a 1.5 s glide with the card already saying the next thing is not calm
    var far = Math.abs(y - window.scrollY) > vwh()[1] * 2;
    try { window.scrollTo({ top: y, behavior: still() || far ? 'instant' : 'smooth' }); } catch (e) { window.scrollTo(0, y); }
  }
  function bring(s, target) {
    var vw = vwh()[0], wh = vwh()[1];
    if (s.top) { if (window.scrollY > 0) scrollTo(0); return; }
    if (!target || fixedAbove(target)) return;
    var r = target.getBoundingClientRect();
    if (vw < 600) { // a phone: the card takes a band at the bottom (or the top); the part gets the rest, a tall one its top
      var ch = st.card.offsetHeight || 0, room = wh - ch - 36, want;
      if (r.height <= room) {
        if ((r.top >= 12 && r.bottom <= wh - ch - 24) || (r.top >= ch + 24 && r.bottom <= wh - 12)) return;
        want = 12 + (room - r.height) / 2;
      } else want = 16;
      scrollTo(window.scrollY + r.top - want);
      return;
    }
    if (r.top > wh * 0.12 && r.bottom < wh * 0.7) return;
    scrollTo(window.scrollY + r.top + Math.min(r.height, wh * 0.5) / 2 - wh * 0.4);
  }

  /* each frame: follow the part (reveals, resizes, the visitor's own scrolling), open the spotlight once the page rests */
  function frame() {
    if (!st) return;
    var now = Date.now(), s = st.steps[st.i], target = find(s), y = window.scrollY;
    if (Math.abs(y - st.y) > 0.5) { st.moved = now; st.y = y; }
    var moving = now - st.moved < 90;
    st.spot.classList.toggle('gd-mv', moving);
    var r = target ? target.getBoundingClientRect() : null, wh = vwh();
    var seen = !!r && r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < wh[1] && r.right > 0 && r.left < wh[0];
    if (!moving && !st.ready && (seen || now - st.at > 1400)) st.ready = true;
    if (st.ready) {
      var key = seen ? [r.left, r.top, r.width, r.height, wh[0], wh[1]].map(Math.round).join() : 'none';
      if (key !== st.key) { st.key = key; layout(seen ? r : null); }
    }
    st.raf = requestAnimationFrame(frame);
  }

  function layout(r) {
    var wh = vwh(), vw = wh[0], vh = wh[1], box;
    if (r) {
      var l = clamp(r.left - PAD, 6, vw - 6), tp = clamp(r.top - PAD, 6, vh - 6), rt = clamp(r.right + PAD, 6, vw - 6), bt = clamp(r.bottom + PAD, 6, vh - 6);
      box = { left: l, top: tp, right: rt, bottom: bt };
    } else box = { left: vw / 2, top: vh / 2, right: vw / 2, bottom: vh / 2 }; // no part on screen: the dimmed page and the card alone
    if (r) box = place(box) || box; // on a phone the card may take a band of the part: the spotlight keeps the rest
    var sp = st.spot, w = box.right - box.left, hh = box.bottom - box.top;
    sp.style.transform = 'translate3d(' + box.left + 'px,' + box.top + 'px,0)';
    sp.style.width = w + 'px'; sp.style.height = hh + 'px'; sp.style.borderRadius = Math.min(20, hh / 2) + 'px';
    st.rect = r ? box : null;
    if (!r) place(null);
  }

  function place(box) {
    var card = st.card, wh = vwh(), vw = wh[0], vh = wh[1], cw = card.offsetWidth, ch = card.offsetHeight, gap = 14, x, y, side;
    if (!box) { side = 'c'; x = (vw - cw) / 2; y = (vh - ch) / 2; }
    else if (vw < 600) { // a phone: a card the width of the screen, on the side with the most room
      side = 'f'; x = (vw - cw) / 2;
      var above = box.top - gap - 12, below = vh - box.bottom - gap - 12, top;
      if (above >= ch && below >= ch) top = above > below;
      else if (above >= ch || below >= ch) top = above >= ch;
      else top = box.top > vh * 0.3 && above > below; // nowhere to go: the bottom, over the foot of a tall part
      y = top ? 12 : vh - ch - 12;
      if (top && box.top < y + ch + 10) box = { left: box.left, right: box.right, bottom: box.bottom, top: Math.min(box.bottom - 40, y + ch + 10) };
      if (!top && box.bottom > y - 10) box = { left: box.left, right: box.right, top: box.top, bottom: Math.max(box.top + 40, y - 10) };
    } else {
      var cx = (box.left + box.right) / 2, cy = (box.top + box.bottom) / 2;
      if (vh - box.bottom - gap - 12 >= ch) { side = 'b'; y = box.bottom + gap; x = clamp(cx - cw / 2, 12, vw - cw - 12); }
      else if (box.top - gap - 12 >= ch) { side = 't'; y = box.top - gap - ch; x = clamp(cx - cw / 2, 12, vw - cw - 12); }
      else if (vw - box.right - gap - 12 >= cw) { side = 'r'; x = box.right + gap; y = clamp(cy - ch / 2, 12, vh - ch - 12); }
      else if (box.left - gap - 12 >= cw) { side = 'l'; x = box.left - gap - cw; y = clamp(cy - ch / 2, 12, vh - ch - 12); }
      else { side = 'c'; x = (vw - cw) / 2; y = (vh - ch) / 2; }
      card.style.setProperty('--ax', clamp(side === 'b' || side === 't' ? cx - x : cy - y, 26, (side === 'b' || side === 't' ? cw : ch) - 26) + 'px');
    }
    card.setAttribute('data-side', side);
    if (!st.shown) { // the first placement lands in place instead of gliding in from the corner
      card.style.transition = 'none'; st.spot.style.transition = 'none';
      card.style.transform = 'translate3d(' + Math.round(x) + 'px,' + Math.round(y) + 'px,0)';
      void card.offsetWidth;
      card.style.transition = ''; st.spot.style.transition = '';
      card.classList.remove('gd-pre'); st.shown = true;
    } else card.style.transform = 'translate3d(' + Math.round(x) + 'px,' + Math.round(y) + 'px,0)';
    return box;
  }

  function keys(e) {
    if (!st) return;
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); end(); return; }
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      var btn = st.card.querySelector(e.key === 'ArrowRight' ? '.gd-next' : '.gd-prev');
      if (btn && !btn.hidden) btn.click();
      return;
    }
    if (e.key === 'Tab') { // the card holds the focus
      var f = Array.prototype.filter.call(st.card.querySelectorAll('button'), function (x) { return !x.hidden; });
      if (!f.length) return;
      var i = f.indexOf(document.activeElement);
      if (i < 0 || (e.shiftKey && i === 0) || (!e.shiftKey && i === f.length - 1)) { e.preventDefault(); f[e.shiftKey ? f.length - 1 : 0].focus(); }
    }
  }

  function end() {
    if (!st) return;
    var o = st.opener;
    cancelAnimationFrame(st.raf);
    document.removeEventListener('keydown', keys, true);
    if (st.root.parentNode) st.root.parentNode.removeChild(st.root);
    st = null;
    if (o && o.isConnected && o.focus) o.focus({ preventScroll: true });
  }

  /* ---------- the invitation, once ---------- */
  var bubT = 0;
  function onScroll() { if (window.scrollY > vwh()[1] * 0.8) closeBubble(); } // past the hero the offer has been seen
  function closeBubble() {
    var b = bub; bub = null;
    clearTimeout(bubT); window.removeEventListener('scroll', onScroll);
    if (!b) return;
    if (still()) { if (b.parentNode) b.parentNode.removeChild(b); return; }
    b.classList.add('out');
    setTimeout(function () { if (b.parentNode) b.parentNode.removeChild(b); }, 320);
  }
  function invite() {
    if (bub || st || stored(SEEN)) return;
    if (/[?&](reserver|visite)(&|=|$)/.test(window.location.search) || document.querySelector('.bk.open')) return; // came to book
    if (!keep(SEEN, '1')) return; // cannot remember it was shown: stay quiet rather than ask at every visit
    withCss(function () { if (!bub && !st) drawBubble(); });
  }
  function drawBubble() {
    bub = h('div', 'gd-bub');
    theme(bub);
    bub.setAttribute('role', 'region'); bub.setAttribute('aria-label', 'Visite guidée');
    var p = h('p'), kk = h('b', '', 'Première visite ?');
    p.appendChild(kk); p.appendChild(document.createTextNode('Je te montre en 30 s'));
    var voir = h('button', 'gd-go', 'Voir'), x = h('button', 'gd-x');
    voir.type = x.type = 'button'; x.setAttribute('aria-label', 'Fermer, je ne veux pas la visite');
    x.appendChild(cross());
    voir.addEventListener('click', function () { start(null); });
    x.addEventListener('click', closeBubble);
    bub.appendChild(p); bub.appendChild(voir); bub.appendChild(x);
    document.body.insertBefore(bub, document.body.firstChild); // first in the tab order, it is fixed on screen anyway
    bubT = setTimeout(closeBubble, 15000); // it does not stay forever
    window.addEventListener('scroll', onScroll, { passive: true });
  }

  /* ---------- how it starts ---------- */
  /* the page has drawn: a mark outside the raw template (<x-dc>) is on it */
  function drawn() {
    var m = document.querySelectorAll('[data-guide-title]');
    for (var i = 0; i < m.length; i++) if (!m[i].closest('x-dc')) return true;
    return false;
  }
  function ready(then) { waitFor(drawn, then); }
  document.addEventListener('click', function (e) {
    var a = e.target && e.target.closest ? e.target.closest('[data-guide-replay]') : null;
    if (!a || e.defaultPrevented || e.button) return;
    e.preventDefault();
    start(a);
  });
  var replay = /[?&]visite(&|=|$)/.test(window.location.search);
  if (replay) {
    try { // the address goes back to the plain page, so a reload does not replay it
      var q = new URLSearchParams(window.location.search); q.delete('visite');
      window.history.replaceState(null, '', window.location.pathname + (q.toString() ? '?' + q : '') + window.location.hash);
    } catch (e) { /* the address stays */ }
    // the parts that depend on the salon's answers (membership, client space) come a moment after the page: wait until the list rests
    ready(function () {
      var n = -1, same = 0;
      // (a part that comes later still joins the tour at the next step)
      waitFor(function () { var c = collect().length; same = c === n ? same + 1 : 0; n = c; return c > 0 && same >= 5; }, function () { start(null); }, 5000, function () { start(null); });
    });
  } else ready(function () { withCss(function () {}); setTimeout(invite, 1800); }); // the sheet loads while the visitor looks around
})();
