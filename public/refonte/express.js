/* Refonte « Express » : la réservation en trois gestes (formule → créneau → prénom + numéro), sur l’API publique du
   salon. Le créneau touché est gardé (POST /api/public/holds) pendant que le client écrit : pas de double réservation.
   Si l’API ne répond pas (page ouverte hors ligne), une simulation prend le relais et le dit (« mode démo »). */
(function () {
  'use strict';
  document.documentElement.classList.add('js');

  /* ---------- small tools ---------- */
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const NB = ' ';
  function h(tag, props, kids) {
    const e = document.createElement(tag);
    for (const k in props || {}) {
      const v = props[k];
      if (v == null || v === false) continue;
      if (k === 'class') e.className = v;
      else if (k === 'text') e.textContent = v;
      else if (k === 'on') for (const ev in v) e.addEventListener(ev, v[ev]);
      else e.setAttribute(k, v === true ? '' : v);
    }
    for (const c of [].concat(kids || [])) if (c != null && c !== false) e.append(c);
    return e;
  }
  const ICONS = {
    arrow: '<path d="M4 12h15M13 6l6 6-6 6"/>', check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>', sms: '<path d="M4 5h16v11H9l-5 4z"/>',
    mail: '<path d="M3.5 6h17v12h-17zM4 7l8 6.5L20 7"/>', bell: '<path d="M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15zM10 20.5h4"/>', out: '<path d="M7 17L17 7M8 7h9v9"/>'
  };
  function icon(n) {
    const t = document.createElement('template');
    t.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + ICONS[n] + '</svg>';
    return t.content.firstChild;
  }
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const eur = (c) => (c % 100 ? (c / 100).toFixed(2).replace('.', ',') : String(c / 100)) + NB + '€';
  const hm = (m) => Math.floor(m / 60) + NB + 'h' + (m % 60 ? NB + String(m % 60).padStart(2, '0') : '');
  const hm24 = (m) => String(Math.floor(m / 60)).padStart(2, '0') + String(m % 60).padStart(2, '0');
  const durText = (m) => (m < 60 ? m + NB + 'min' : Math.floor(m / 60) + NB + 'h' + (m % 60 ? NB + String(m % 60).padStart(2, '0') : ''));
  const D = (s) => { const p = s.split('-').map(Number); return new Date(Date.UTC(p[0], p[1] - 1, p[2])); };
  const addDays = (s, n) => { const d = D(s); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  const diffDays = (a, b) => Math.round((D(b) - D(a)) / 86400000);
  const WD = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
  const WDS = ['dim.', 'lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.'];
  const MO = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
  /** « aujourd’hui », « demain », « jeudi », then « jeu. 19 nov. » */
  function dayWord(day) {
    const n = diffDays(S.today, day), d = D(day);
    if (n === 0) return 'aujourd’hui';
    if (n === 1) return 'demain';
    if (n > 1 && n < 7) return WD[d.getUTCDay()];
    return WDS[d.getUTCDay()] + ' ' + d.getUTCDate() + ' ' + MO[d.getUTCMonth()];
  }
  const dayFull = (day) => { const d = D(day); return WD[d.getUTCDay()] + ' ' + d.getUTCDate() + ' ' + MO[d.getUTCMonth()]; };
  const slotWords = (x) => dayWord(x.day) + ' ' + hm(x.m);
  const parisNow = () => {
    const p = {};
    for (const x of new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date())) p[x.type] = x.value;
    return { day: p.year + '-' + p.month + '-' + p.day, min: Number(p.hour) * 60 + Number(p.minute) };
  };
  /* the server's own rule (server/lib/util.js normPhone): a French number, or an international one */
  function phoneOk(v) {
    let d = String(v || '').replace(/[^\d+]/g, '');
    if (d.startsWith('00')) d = '+' + d.slice(2);
    if (d.startsWith('+33')) d = '0' + d.slice(3);
    return d.startsWith('+') ? /^\+\d{8,15}$/.test(d) : /^0[1-9]\d{8}$/.test(d);
  }

  /* ---------- what this phone remembers (always in try/catch: storage can be off) ---------- */
  const ME_KEY = 'lx.express.me';
  function readMe() { try { const m = JSON.parse(window.localStorage.getItem(ME_KEY) || 'null'); return m && typeof m === 'object' ? m : null; } catch (e) { return null; } }
  function writeMe(m) { try { window.localStorage.setItem(ME_KEY, JSON.stringify(m)); } catch (e) { /* storage off: nothing is remembered */ } }
  function clearMe() { try { window.localStorage.removeItem(ME_KEY); } catch (e) { /* storage off */ } }

  /* ---------- state ---------- */
  const S = {
    demo: false, sal: null, today: parisNow().day, skew: 0, svcs: [], byId: {}, bySlug: {}, barbers: [], staffBy: {},
    homeSvc: null, avail: {}, next: {}, rb: null, homeTk: 0, me: readMe(),
    open: false, step: 'formule', svc: null, staff: 'any', day: null, start: null, slotStaff: null, hold: null,
    days: null, daySel: null, daysTk: 0, daysMore: false, err: '', busy: false, f: { first: '', phone: '', email: '', sms: true },
    result: null, opener: null, icsUrl: '', tab: null
  };
  if (S.me) { S.f.first = S.me.first || ''; S.f.phone = S.me.phone || ''; }

  /* ---------- the API, and its stand-in when it cannot be reached ---------- */
  const FALLBACK = {
    shop: { name: 'Barber L’Architecte', address: '16, place Pélabon', zip: '13013', city: 'Marseille', mapsUrl: 'https://www.google.com/maps/search/?api=1&query=L%27Architecte%20coiffeur&query_place_id=ChIJJSWkBLy_yRIRbgAQcMwb-JY' },
    hoursText: 'Du mardi au samedi, 9 h – 18 h 30', closedText: 'le dimanche et le lundi',
    booking: { enabled: true, stepMin: 30, maxDaysAhead: 90, holdMin: 5, pendingPayMin: 15, cancelUntilHours: 12 },
    deposits: { mode: 'none' }, sms: false, payments: { live: false }, mode: 'sim',
    services: [
      ['cl', 'Coupe classique', 'Coupe', 'Coupes', 2000, 30, ['Coupe', 'Shampooing', 'Coiffage'], '', false],
      ['cc', 'Coupe + contour de barbe', 'Coupe + contour', 'Coupes', 2500, 30, ['Coupe', 'Contour de la barbe'], '', false],
      ['ct', 'Coupe + taille de barbe', 'Coupe + taille', 'Coupes', 3000, 30, ['Coupe', 'Taille de barbe', 'Shampooing', 'Coiffage', 'Soin cheveux', 'Soin barbe'], 'La plus complète', false],
      ['tr', 'Transformation', 'Transformation', 'Changer de tête', 5000, 60, ['Diagnostic', 'Étude de faisabilité', 'Coupe', 'Coiffage et soin'], 'Changement de look', false],
      ['cd', 'Coupe + décoloration', 'Coupe + déco', 'Changer de tête', 8000, 90, ['Coupe', 'Décoloration'], '', true],
      ['de', 'Décoloration', 'Décoloration', 'Changer de tête', 6000, 60, ['Décoloration', 'Sans coupe'], '', true],
      ['co', 'Coloration', 'Coloration', 'Changer de tête', 3000, 60, ['Coloration', 'Sans coupe'], '', true],
      ['si', 'Silver', 'Silver', 'Changer de tête', 10000, 60, ['Décoloration jusqu’au blanc', 'Coloration grise', 'Soin', 'Produit d’entretien offert'], 'Blanc ou gris', false],
      ['eb', 'Entretien barbe', 'Entretien barbe', 'Barbe', 1500, 30, ['Contour de la barbe', 'Huile'], '', false],
      ['tb', 'Taille de barbe', 'Taille de barbe', 'Barbe', 1800, 30, ['Taille', 'Mise en forme', 'Huile'], '', false],
      ['cb', 'Cover barbe', 'Cover barbe', 'Barbe', 1500, 30, ['Couleur de la barbe', 'Soin'], '', false]
    ].map((x, i) => ({ id: 'sim_' + x[0], slug: x[0], name: x[1], short: x[2], category: x[3], price: x[4], dur: x[5], includes: x[6], tag: x[7], from: x[8], order: i, description: '', deposit: null, online: true })),
    barbers: [['JKut', 'JK', 'Dégradés à la précision chirurgicale. Le fondateur de la méthode « construction au millimètre ».'], ['Frank', 'F', 'Coupes classiques et barbes taillées à l’ancienne.'], ['Le Soldat', 'LS', 'Skin fade, contours nets, couleur et silver.'], ['Esteban', 'E', 'Textures, boucles et transformations.']]
      .map((x, i) => ({ id: 'sim_b' + i, name: x[0], initials: x[1], bio: x[2], instagram: '', away: null }))
  };
  FALLBACK.menu = FALLBACK.services.map((x) => ({ slug: x.slug, name: x.name, category: x.category, price: x.price, from: x.from, dur: x.dur, online: true }))
    .concat([{ slug: 'ab', name: 'Carnet 5 coupes', category: 'Carnet', price: 8000, from: false, dur: 30, online: false }]);

  const SIM = { taken: new Map(), n: 0 };
  function hash(s) { let x = 2166136261; for (let i = 0; i < s.length; i++) { x ^= s.charCodeAt(i); x = Math.imul(x, 16777619); } return (x >>> 0) % 100; }
  function simFree(bid, day, m, dur) {
    for (let t = m; t < m + dur; t += 30) if (hash(day + bid + t) < 52 || SIM.taken.has(day + '|' + bid + '|' + t)) return false;
    return true;
  }
  function simSlot(sv, staff, day, m) {
    const now = parisNow(), dow = D(day).getUTCDay();
    if (dow < 2 || day < now.day || (day === now.day && m < now.min + 30) || m < 540 || m + sv.dur > 1110) return null;
    const b = FALLBACK.barbers.filter((x) => staff === 'any' || x.id === staff).find((x) => simFree(x.id, day, m, sv.dur));
    return b ? b.id : null;
  }
  const simFail = (status, code, message) => { throw { status, code, message }; };
  function sim(path, o) {
    const u = new URL(path, 'http://x'), q = u.searchParams, body = (o && o.body) || {};
    if (u.pathname.endsWith('/salon')) return Object.assign({}, FALLBACK, { today: parisNow().day, now: Date.now() });
    if (u.pathname.endsWith('/live')) { const n = parisNow(), dow = D(n.day).getUTCDay(); return { open: dow >= 2 && n.min >= 540 && n.min < 1110 }; }
    if (u.pathname.endsWith('/availability')) {
      const sv = S.byId[q.get('services')], days = [];
      for (let i = 0; i < Number(q.get('days') || 10); i++) {
        const day = addDays(q.get('from'), i), slots = [];
        for (let m = 540; m + sv.dur <= 1110; m += 30) { const s = simSlot(sv, q.get('staff') || 'any', day, m); if (s) slots.push({ m, s }); }
        days.push({ day, open: D(day).getUTCDay() >= 2, slots });
      }
      return { dur: sv.dur, days };
    }
    if (u.pathname.endsWith('/holds') && o && o.method === 'POST') {
      const sv = S.byId[body.serviceIds[0]];
      if (body.replace) for (const [k, v] of SIM.taken) if (v === body.replace) SIM.taken.delete(k);
      const s = simSlot(sv, body.staffId, body.day, body.start);
      if (!s) simFail(409, 'taken', 'Ce créneau vient d’être pris.');
      const id = 'sim_h' + (++SIM.n);
      for (let t = body.start; t < body.start + sv.dur; t += 30) SIM.taken.set(body.day + '|' + s + '|' + t, id);
      return { holdId: id, staffId: s, exp: Date.now() + 5 * 60000 };
    }
    if (u.pathname.includes('/holds/')) { const id = u.pathname.split('/').pop(); for (const [k, v] of SIM.taken) if (v === id) SIM.taken.delete(k); return { ok: true }; }
    if (u.pathname.endsWith('/bookings')) {
      const held = [...SIM.taken.values()].includes(body.holdId);
      const s = held ? S.slotStaff : simSlot(S.byId[body.serviceIds[0]], body.staffId, body.day, body.start);
      if (!s) simFail(409, 'taken', 'Ce créneau vient d’être pris. Choisis-en un autre, tes choix sont gardés.');
      let code = ''; for (let i = 0; i < 5; i++) code += 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'[Math.floor(Math.random() * 31)];
      return { code, token: '', manage: '', status: 'booked', deposit: 0, staffId: s, payment: null };
    }
    simFail(404, 'not_found', 'Indisponible.');
  }
  async function api(path, o) {
    if (S.demo) return sim(path, o);
    let res;
    try { res = await fetch(path, { cache: 'no-store', method: (o && o.method) || 'GET', headers: o && o.body ? { 'content-type': 'application/json' } : undefined, body: o && o.body ? JSON.stringify(o.body) : undefined }); }
    catch (e) { throw { status: 0, code: 'network', message: 'Pas de réseau. Vérifie ta connexion et réessaie.' }; }
    let j = null;
    try { j = await res.json(); } catch (e) { /* not JSON */ }
    if (!res.ok) throw { status: res.status, code: (j && j.error && j.error.code) || 'error', message: (j && j.error && j.error.message) || 'Ça n’a pas marché. Réessaie dans un instant.' };
    if (j == null) throw { status: res.status, code: 'not_json', message: 'Ça n’a pas marché. Réessaie dans un instant.' };
    return j;
  }
  const cache = new Map();
  function availability(svcId, staff, from, days, holdId) {
    const key = [svcId, staff, from, days].join('|');
    const hit = cache.get(key);
    if (!holdId && hit && Date.now() - hit.t < 15000) return hit.p;
    const p = api('/api/public/availability?services=' + encodeURIComponent(svcId) + '&staff=' + encodeURIComponent(staff) + '&from=' + from + '&days=' + days + (holdId ? '&hold=' + encodeURIComponent(holdId) : ''));
    if (!holdId) { cache.set(key, { t: Date.now(), p }); p.catch(() => cache.delete(key)); }
    return p;
  }
  const firstSlot = (days) => { for (const d of days || []) if (d.slots.length) return { day: d.day, m: d.slots[0].m, s: d.slots[0].s }; return null; };

  /* ---------- Halftone lettering: the fade, drawn in dots (the main site's, without the regrowth) ---------- */
  const SERIF = '"Instrument Serif", "Times New Roman", Times, serif';
  function Halftone(cv, word) { this.cv = cv; this.word = word; this.ctx = cv.getContext('2d'); this.mask = document.createElement('canvas'); this.ok = false; }
  Halftone.prototype.layout = function (maxH) {
    const cv = this.cv, box = cv.parentElement, c = this.ctx;
    const W = Math.max(40, Math.floor(box.clientWidth)), dpr = Math.min(2, window.devicePixelRatio || 1);
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.font = '400 100px ' + SERIF;
    let size = W / (Math.max(1, c.measureText(this.word).width) / 100);
    if (maxH) size = Math.min(size, maxH);
    const font = '400 ' + size.toFixed(2) + 'px ' + SERIF;
    c.font = font;
    const m = c.measureText(this.word);
    const asc = m.actualBoundingBoxAscent || size * 0.72, desc = m.actualBoundingBoxDescent || 0;
    const capH = c.measureText('H').actualBoundingBoxAscent || size * 0.7;
    const padT = Math.ceil(size * 0.03) + 3, H = Math.ceil(padT + asc + desc + padT);
    Object.assign(this, { W, H, size, capH, dpr, w: m.width, base: padT + asc, top: padT - 2, bot: padT + asc + desc + 2, cell: Math.max(3.2, Math.min(11, size / 30)) });
    cv.style.height = H + 'px';
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    this.mask.width = cv.width; this.mask.height = cv.height;
    const mc = this.mask.getContext('2d');
    mc.setTransform(dpr, 0, 0, dpr, 0, 0);
    mc.clearRect(0, 0, W, H);
    mc.font = font; mc.fillStyle = '#000'; mc.textBaseline = 'alphabetic';
    mc.fillText(this.word, 0, this.base);
    this.ok = true;
  };
  /* f: the share of the cap height drawn as a halftone fade */
  Halftone.prototype.draw = function (f, color) {
    if (!this.ok) return;
    const c = this.ctx, d = this.dpr, cell = this.cell;
    c.setTransform(d, 0, 0, d, 0, 0);
    c.globalCompositeOperation = 'source-over';
    c.clearRect(0, 0, this.W, this.H);
    c.fillStyle = color;
    c.beginPath();
    const R = cell * 0.6, bTop = this.base - this.capH * f, top = this.top - cell;
    if (bTop > top) c.rect(-cell, top, this.w + cell * 2, bTop - top);
    const span = Math.max(1, this.base - bTop);
    let row = 0;
    for (let y = bTop + cell * 0.3; y < this.bot + cell; y += cell * 0.866, row++) {
      const t = (y - bTop) / span, rad = t >= 1 ? 0 : R * Math.pow(1 - t, 1.15);
      if (rad < 0.22) continue;
      for (let x = -cell + (row % 2 ? cell / 2 : 0); x < this.w + cell; x += cell) { c.moveTo(x + rad, y); c.arc(x, y, rad, 0, 6.2832); }
    }
    c.fill();
    c.globalCompositeOperation = 'destination-in';
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.drawImage(this.mask, 0, 0);
    c.globalCompositeOperation = 'source-over';
  };
  function heroWord() {
    const cv = $('#ht');
    if (!cv || !cv.getContext) return;
    const ht = new Halftone(cv, 'Frais.');
    const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let intro = reduce ? 1 : 0, lastW = 0;
    const draw = () => ht.draw((1 - intro) * 1.02 + intro * 0.42, '#0F0E0D');
    const lay = () => { ht.layout(window.innerHeight * (window.innerWidth >= 1000 ? 0.5 : 0.3)); draw(); };
    const start = () => {
      lay();
      if (reduce) return;
      const t0 = performance.now();
      const tick = (t) => { const k = clamp((t - t0) / 1400, 0, 1); intro = 1 - Math.pow(1 - k, 3); draw(); if (k < 1) requestAnimationFrame(tick); };
      requestAnimationFrame(tick);
    };
    const ready = document.fonts && document.fonts.load ? document.fonts.load('400 100px "Instrument Serif"').catch(() => null) : Promise.resolve();
    Promise.race([ready, new Promise((r) => setTimeout(r, 1500))]).then(start);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(lay);
    window.addEventListener('resize', () => { if (window.innerWidth !== lastW) { lastW = window.innerWidth; lay(); } });
  }

  /* ---------- page furniture: top bar tone, index, reveals ---------- */
  function chrome() {
    const tb = $('#tb'), hero = $('#frais'), tones = $$('[data-tone]').filter((e) => !e.closest('.bk'));
    let raf = 0;
    const onScroll = () => {
      raf = 0;
      const y = window.scrollY, vh = window.innerHeight;
      let tone = 'light';
      for (const e of tones) if (e.getBoundingClientRect().top <= 40) tone = e.dataset.tone;
      tb.classList.toggle('light', tone === 'light');
      tb.classList.toggle('dark', tone === 'dark');
      tb.classList.toggle('scrolled', y > 24);
      hero.style.setProperty('--o', String(clamp(y / vh, 0, 1)));
    };
    window.addEventListener('scroll', () => { if (!raf) raf = requestAnimationFrame(onScroll); }, { passive: true });
    onScroll();

    const btn = $('#mn-btn'), mn = $('#menu');
    const setMenu = (on) => {
      mn.hidden = !on;
      btn.setAttribute('aria-expanded', String(on));
      btn.setAttribute('aria-label', on ? 'Fermer le sommaire' : 'Ouvrir le sommaire');
      tb.classList.toggle('mo', on);
      document.body.style.overflow = on ? 'hidden' : '';
      for (const e of [$('#main'), $('#venir'), $('#cta')]) e.inert = on;
      if (on) { const a = $('a', mn); if (a) a.focus(); } else btn.focus();
    };
    btn.addEventListener('click', () => setMenu(mn.hidden));
    mn.addEventListener('click', (e) => { if (e.target.closest('a')) { setMenu(false); } });
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      if (S.open) closeSheet(); else if (!mn.hidden) setMenu(false);
    });
    S.closeMenu = () => { if (!mn.hidden) setMenu(false); };

    if ('IntersectionObserver' in window) {
      const io = new IntersectionObserver((es) => { for (const e of es) if (e.isIntersecting) { e.target.setAttribute('data-in', ''); io.unobserve(e.target); } }, { rootMargin: '0px 0px -8% 0px' });
      S.reveal = (root) => $$('[data-rv]:not([data-in])', root).forEach((e) => io.observe(e));
    } else S.reveal = (root) => $$('[data-rv]', root).forEach((e) => e.setAttribute('data-in', ''));
    S.reveal(document);
  }

  /* ---------- the home: hero card, next slot of each barber, team, carte ---------- */
  const mono = (b) => h('span', { class: 'mono', 'aria-hidden': 'true', text: b.initials || b.name.charAt(0) });
  const svcShort = (sv) => sv.short || sv.name;

  function renderHeroChips() {
    const box = $('#hx-f');
    box.textContent = '';
    const top = S.svcs.slice(0, 3);
    if (!top.length) return;
    const base = svcShort(top[0]);
    for (const sv of top) {
      const s = svcShort(sv), label = sv !== top[0] && s.startsWith(base + ' + ') ? '+ ' + s.slice(base.length + 3) : s;
      box.append(h('button', { type: 'button', class: 'hx-c', 'aria-label': sv.name + ', ' + eur(sv.price) + ' : voir les créneaux', on: { click: (e) => chooseSvc(sv.id, e.currentTarget) } },
        [h('b', { text: label }), h('small', { text: eur(sv.price) })]));
    }
    box.append(h('button', { type: 'button', class: 'hx-c', 'aria-label': 'Une autre formule : toute la carte', on: { click: (e) => { S.svc = null; openSheet('formule', e.currentTarget); } } },
      [h('b', { text: 'Autre' }), h('small', { text: 'la carte' })]));
  }

  function renderHero() {
    const k = $('#hx-k'), v = $('#hx-v'), any = S.next.any;
    if (S.rb) { k.textContent = 'Comme la dernière fois ?'; v.textContent = S.rb.barber.name + ' · ' + slotWords(S.rb.slot); }
    else if (any) { k.textContent = 'Prochain créneau'; v.textContent = cap(dayWord(any.day)) + ' · ' + hm(any.m); }
    else if (any === null) { k.textContent = 'Réserver'; v.textContent = 'Choisis ton créneau'; }
    const min = S.svcs.length ? Math.min.apply(null, S.svcs.map((x) => x.price)) : 0;
    const held = S.hold && S.day && !S.result;
    $('#cta-l').textContent = held ? 'Reprendre' : 'Réserver';
    const sub = $('#cta-s');
    sub.textContent = held ? cap(dayWord(S.day)) + ' · ' + hm(S.start) : min ? 'dès ' + eur(min) : '';
    sub.hidden = !sub.textContent;
  }

  function renderNow() {
    const chips = $('#now-chips');
    chips.textContent = '';
    for (const sv of S.svcs) {
      chips.append(h('button', { type: 'button', class: 'fc', 'aria-pressed': String(sv.id === S.homeSvc), on: { click: () => { if (S.homeSvc === sv.id) return; S.homeSvc = sv.id; S.svc = sv.id; S.next = {}; renderNow(); renderTeam(); loadHome(); } } },
        [svcShort(sv), h('small', { text: (sv.from ? 'dès ' : '') + eur(sv.price) })]));
    }
    const nx = $('#nx');
    nx.textContent = '';
    const loading = !('any' in S.next);
    const cell = (b) => {
      const key = b ? b.id : 'any', n = S.next[key], away = b && b.away;
      if (loading) return h('li', { class: b ? '' : 'nx-any' }, h('div', { class: 'nx-sk' }));
      const who = b ? b.name : 'Le premier libre';
      const btn = h('button', {
        type: 'button', class: 'nx-b' + (n ? '' : ' none'), disabled: !n,
        'aria-label': n ? who + ', ' + slotWords(n) + ' : garder ce créneau' : who + ', pas de créneau libre ces jours-ci',
        on: n ? { click: (e) => { S.svc = S.homeSvc; S.staff = key; takeSlot(n.day, n.m, e.currentTarget); } } : {}
      });
      if (b) btn.append(h('span', { class: 'nx-hd' }, [mono(b), h('span', { class: 'nx-n', text: b.name })]));
      btn.append(h('span', { class: 'nx-w' }, [
        h('span', { class: 'nx-d' }, [h('i', { 'aria-hidden': 'true' }), b ? (n ? cap(dayWord(n.day)) : 'Complet') : 'Le premier libre' + (n ? ' · ' + dayWord(n.day) : '')]),
        h('span', { class: 'nx-t', text: n ? hm(n.m) : away ? away.note : 'Rien de libre sur 14 jours' })
      ]));
      if (!b) btn.append(h('span', { class: 'nx-go', 'aria-hidden': 'true' }, icon('arrow')));
      return h('li', { class: b ? '' : 'nx-any' }, btn);
    };
    nx.append(cell(null));
    for (const b of S.barbers) nx.append(cell(b));

    const slot = $('#rb-slot');
    slot.textContent = '';
    if (S.rb) {
      slot.append(h('button', { type: 'button', class: 'rb', on: { click: (e) => rebook(e.currentTarget) } }, [
        h('span', { class: 'rb-l' }, [
          h('span', { class: 'rb-k', text: S.me && S.me.first ? 'Bon retour, ' + S.me.first : 'Bon retour' }),
          h('span', { class: 'rb-t', text: 'Comme la dernière fois ?' }),
          h('span', { class: 'rb-s' }, [S.rb.barber.name + ' · ' + S.rb.svc.name + ' · prochain créneau ', h('b', { text: slotWords(S.rb.slot) })])
        ]),
        h('span', { class: 'rb-go', text: 'Reprendre' })
      ]));
    }
    $('#forget-w').hidden = !S.me;
  }

  function renderTeam() {
    const ul = $('#bb');
    ul.textContent = '';
    const sv = S.byId[S.homeSvc];
    for (const b of S.barbers) {
      const days = S.avail[b.id], d = (days || []).find((x) => x.slots.length);
      const x = h('div', { class: 'bb-x' });
      if (b.bio) x.append(h('p', { class: 'bb-bio', text: b.bio }));
      if (b.away) x.append(h('p', { class: 'bb-k none' }, [h('i', { 'aria-hidden': 'true' }), b.away.note]));
      else if (!days) x.append(h('p', { class: 'bb-k none' }, [h('i', { 'aria-hidden': 'true' }), 'On regarde ses créneaux…']));
      else if (!d) x.append(h('p', { class: 'bb-k none' }, [h('i', { 'aria-hidden': 'true' }), 'Complet sur 14 jours']));
      else x.append(h('p', { class: 'bb-k' }, [h('i', { 'aria-hidden': 'true' }), cap(dayWord(d.day)) + (sv ? ' · ' + svcShort(sv) : '')]));
      const row = h('div', { class: 'bb-slots' });
      if (d) for (const s of d.slots.slice(0, 3)) {
        row.append(h('button', { type: 'button', class: 'chip', text: hm(s.m), 'aria-label': b.name + ', ' + dayWord(d.day) + ' ' + hm(s.m) + ' : garder ce créneau', on: { click: (e) => { S.staff = b.id; S.svc = S.svc || null; takeSlot(d.day, s.m, e.currentTarget); } } }));
      }
      row.append(h('button', { type: 'button', class: 'chip more', text: d ? 'Un autre jour' : 'Voir ses jours', 'aria-label': b.name + ' : voir tous ses créneaux', on: { click: (e) => { S.staff = b.id; if (!S.svc) S.svc = S.homeSvc; clearSlot(); openSheet('creneau', e.currentTarget); } } }));
      x.append(row);
      if (b.instagram) x.append(h('a', { class: 'tl bb-ig', href: b.instagram, target: '_blank', rel: 'noopener', text: 'Son travail sur Instagram' }));
      ul.append(h('li', { class: 'bb-i' }, [mono(b), h('h3', { class: 'bb-n', text: b.name }), x]));
    }
  }

  function renderCarte() {
    const menu = S.sal.menu || [], cats = [];
    for (const m of menu) if (!cats.includes(m.category)) cats.push(m.category);
    if (!S.tab || !cats.includes(S.tab)) S.tab = cats[0];
    const tabs = $('#cr-tabs'), ul = $('#cr');
    tabs.textContent = ''; ul.textContent = '';
    for (const c of cats) tabs.append(h('button', { type: 'button', role: 'tab', class: 'cr-tab', 'aria-selected': String(c === S.tab), 'aria-controls': 'cr', text: c, on: { click: () => { S.tab = c; renderCarte(); } } }));
    ul.setAttribute('aria-label', S.tab || 'La carte');
    for (const m of menu.filter((x) => x.category === S.tab)) {
      const sv = m.slug ? S.bySlug[m.slug] : null;
      const inc = sv && sv.includes && sv.includes.length ? sv.includes.join(' · ') : '';
      const name = h('span', { class: 'cr-n' }, [m.name, m.online ? h('small', { text: durText(m.dur) + (inc ? ' · ' + inc : '') }) : null, sv && sv.description ? h('small', { text: sv.description }) : null, sv && sv.tag ? h('em', { text: sv.tag }) : null]);
      const price = h('span', { class: 'cr-p' }, [m.from ? h('small', { text: 'dès' }) : null, eur(m.price)]);
      const bookable = sv && m.online;
      const go = bookable ? h('span', { class: 'cr-go' }, ['Réserver', icon('arrow')]) : h('span', { class: 'cr-go off', text: 'Se prend au salon' });
      const row = bookable
        ? h('button', { type: 'button', class: 'cr-row', 'aria-label': m.name + ', ' + (m.from ? 'dès ' : '') + eur(m.price) + ' : réserver', on: { click: (e) => chooseSvc(sv.id, e.currentTarget) } }, [name, price, go])
        : h('div', { class: 'cr-row' }, [name, price, go]);
      ul.append(h('li', { class: 'cr-i' }, row));
    }
  }

  function renderCuts() {
    for (const a of $$('#ct-row .ct')) {
      const sv = S.bySlug[a.dataset.svc], line = $('[data-ct-line]', a), go = $('[data-ct-go]', a);
      if (!sv) { line.textContent = ''; go.hidden = true; continue; }
      line.textContent = sv.name + ' · ' + (sv.from ? 'dès ' : '') + eur(sv.price);
      go.hidden = false;
      go.onclick = (e) => chooseSvc(sv.id, e.currentTarget);
    }
  }

  /** The next slots, for the formule the home shows: the first free one, and each barber's. */
  async function loadHome() {
    const tk = ++S.homeTk, svc = S.homeSvc;
    if (!svc) return;
    const who = ['any'].concat(S.barbers.map((b) => b.id));
    const res = await Promise.all(who.map((id) => availability(svc, id, S.today, 14).then((r) => r.days, () => null)));
    if (tk !== S.homeTk) return;
    S.avail = {}; S.next = {};
    who.forEach((id, i) => { S.avail[id] = res[i] || []; S.next[id] = firstSlot(res[i]); });
    // the returning client: the same barber, the same formule, their next slot
    S.rb = null;
    const me = S.me, msv = me && S.bySlug[me.svc], mb = me && (S.staffBy[me.staff] || S.barbers.find((b) => b.name === me.staffName));
    if (msv && mb && !mb.away) {
      const days = msv.id === svc ? S.avail[mb.id] : await availability(msv.id, mb.id, S.today, 14).then((r) => r.days, () => null);
      if (tk !== S.homeTk) return;
      const slot = firstSlot(days);
      if (slot) S.rb = { svc: msv, barber: mb, slot };
    }
    renderHero(); renderNow(); renderTeam();
  }

  /* ---------- booking ---------- */
  const svcNow = () => S.byId[S.svc] || null;
  const holdSvc = () => S.svc || S.homeSvc;
  function clearSlot() { S.day = null; S.start = null; S.slotStaff = null; }
  function dropHold() { const hd = S.hold; S.hold = null; if (hd) api('/api/public/holds/' + encodeURIComponent(hd.id), { method: 'DELETE' }).catch(() => null); }
  function depositFor(sv) {
    const d = S.sal.deposits, live = !(S.sal.payments && S.sal.payments.live === false);
    if (!sv || !live) return 0;
    if (typeof sv.deposit === 'number') return Math.min(sv.price, sv.deposit);
    if (!d || d.mode === 'none' || (d.mode === 'threshold' && sv.price < d.thresholdCents)) return 0;
    return Math.min(sv.price, Math.max(500, Math.round((sv.price * d.percent) / 100 / 100) * 100));
  }

  /** Keep a slot: the server holds it while the client types. true when it is ours. */
  async function hold(day, m) {
    const res = await api('/api/public/holds', { method: 'POST', body: Object.assign({ serviceIds: [holdSvc()], staffId: S.staff, day, start: m }, S.hold ? { replace: S.hold.id } : {}) });
    S.day = day; S.start = m; S.slotStaff = res.staffId;
    S.hold = { id: res.holdId, exp: res.exp, svc: holdSvc() };
    cache.clear();
    return res;
  }

  /** A slot touched anywhere on the page: hold it, then the sheet shows what is still missing. */
  async function takeSlot(day, m, btn) {
    if (S.busy) return;
    S.busy = true; S.err = '';
    if (btn) { btn.setAttribute('aria-busy', 'true'); btn.classList.add('busy'); }
    const opener = S.open ? S.opener : btn;
    try {
      await hold(day, m);
      S.busy = false;
      if (S.open) goStep(S.svc ? 'infos' : 'formule'); else openSheet(S.svc ? 'infos' : 'formule', opener);
    } catch (e) {
      S.busy = false;
      clearSlot();
      S.err = e.code === 'taken' ? 'Ce créneau vient d’être pris. Choisis-en un autre : ta formule et ton barbier sont gardés.' : e.message;
      cache.clear();
      if (!S.svc) S.svc = S.homeSvc;
      if (S.open) goStep('creneau', true); else openSheet('creneau', opener, true);
      loadHome();
    } finally {
      if (btn && btn.isConnected) { btn.removeAttribute('aria-busy'); btn.classList.remove('busy'); }
      renderHero();
    }
  }

  /** A formule touched anywhere: it joins the ticket; a slot already kept is kept again for it. */
  async function chooseSvc(id, opener) {
    if (S.busy) return;
    S.svc = id; S.err = '';
    if (S.day == null) { if (S.open) goStep('creneau'); else openSheet('creneau', opener); return; }
    if (S.hold && S.hold.svc === id && S.hold.exp > Date.now() + S.skew) { if (S.open) goStep('infos'); else openSheet('infos', opener); return; }
    S.busy = true;
    try {
      await hold(S.day, S.start);
      S.busy = false;
      if (S.open) goStep('infos'); else openSheet('infos', opener);
    } catch (e) {
      S.busy = false;
      const sv = svcNow();
      dropHold(); clearSlot(); cache.clear();
      S.err = e.code === 'taken' ? 'Ce créneau ne va pas avec cette formule' + (sv ? ' (' + durText(sv.dur) + ')' : '') + '. Choisis-en un autre.' : e.message;
      if (S.open) goStep('creneau', true); else openSheet('creneau', opener, true);
    }
    renderHero();
  }

  function rebook(btn) {
    if (!S.rb) return;
    S.svc = S.rb.svc.id; S.staff = S.rb.barber.id;
    takeSlot(S.rb.slot.day, S.rb.slot.m, btn);
  }

  async function loadDays(more) {
    const tk = ++S.daysTk, svc = holdSvc();
    const from = more && S.days && S.days.length ? addDays(S.days[S.days.length - 1].day, 1) : S.today;
    if (!more) { S.days = null; renderStep(); }
    try {
      const r = await availability(svc, S.staff, from, 14, S.hold ? S.hold.id : null);
      if (tk !== S.daysTk) return;
      S.days = more ? S.days.concat(r.days) : r.days;
      const last = S.days.length ? S.days[S.days.length - 1].day : S.today;
      S.daysMore = r.days.length === 14 && diffDays(S.today, last) < (S.sal.booking.maxDaysAhead || 90);
      if (more) { const d = r.days.find((x) => x.slots.length); if (d) S.daySel = d.day; }
      else if (!S.daySel || !S.days.some((x) => x.day === S.daySel && x.slots.length)) { const d = S.days.find((x) => x.slots.length); S.daySel = d ? d.day : null; }
    } catch (e) {
      if (tk !== S.daysTk) return;
      S.days = S.days || []; S.err = e.message;
    }
    if (S.open && S.step === 'creneau') { renderStep(); renderErr(); }
  }

  async function submit(ev) {
    if (ev) ev.preventDefault();
    if (S.busy) return;
    const f = S.f, bad = [];
    f.first = f.first.trim(); f.phone = f.phone.trim(); f.email = f.email.trim();
    const set = (id, msg) => { const i = $('#' + id), hint = $('#' + id + '-h'); if (!i) return; i.setAttribute('aria-invalid', msg ? 'true' : 'false'); if (hint) { hint.textContent = msg || hint.dataset.d || ''; hint.classList.toggle('warn', !!msg); } if (msg) bad.push(i); };
    set('f-first', f.first.length < 2 ? 'Ton prénom, au moins deux lettres.' : /[:/]/.test(f.first) ? 'Ton prénom, sans « : » ni « / ».' : '');
    set('f-phone', phoneOk(f.phone) ? '' : 'Un numéro complet, par exemple 06 12 34 56 78.');
    set('f-email', !f.email || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email) ? '' : 'Cette adresse ne semble pas complète.');
    if (bad.length) { bad[0].focus(); return; }
    const sv = svcNow();
    S.busy = true; S.err = ''; renderErr(); renderFoot();
    try {
      const res = await api('/api/public/bookings', { method: 'POST', body: Object.assign({ serviceIds: [sv.id], staffId: S.staff, day: S.day, start: S.start, first: f.first, phone: f.phone, sms: f.sms }, S.hold ? { holdId: S.hold.id } : {}, f.email ? { email: f.email } : {}) });
      const barber = S.staffBy[res.staffId] || S.staffBy[S.slotStaff] || null;
      S.result = Object.assign({}, res, { day: S.day, start: S.start, svc: sv, barber, first: f.first, phone: f.phone, email: f.email, sms: f.sms });
      S.me = { first: f.first, phone: f.phone, svc: sv.slug, staff: barber ? barber.id : null, staffName: barber ? barber.name : '' };
      writeMe(S.me);
      S.hold = null; S.busy = false; cache.clear();
      S.icsUrl = res.status === 'pending' || S.demo ? '' : makeIcs(S.result);
      goStep('done');
      loadHome();
    } catch (e) {
      S.busy = false;
      if (e.code === 'taken') {
        // back to the slots: the formule, the barber and what was typed are kept
        S.hold = null; clearSlot(); cache.clear();
        S.err = e.message || 'Ce créneau vient d’être pris. Choisis-en un autre, tes choix sont gardés.';
        goStep('creneau', true);
        loadHome();
      } else { S.err = e.message; renderErr(); renderFoot(); const er = $('#bk-err'); if (er && er.scrollIntoView) er.scrollIntoView({ block: 'nearest' }); }
    }
    renderHero();
  }

  function makeIcs(r) {
    try {
      const d = r.day.replace(/-/g, ''), st = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
      const ics = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Barber LArchitecte//Reservation//FR', 'BEGIN:VEVENT',
        'UID:' + r.code + '@larchitecte', 'DTSTAMP:' + st, 'DTSTART;TZID=Europe/Paris:' + d + 'T' + hm24(r.start) + '00', 'DTEND;TZID=Europe/Paris:' + d + 'T' + hm24(r.start + r.svc.dur) + '00',
        'SUMMARY:Barber L’Architecte · ' + r.svc.name, 'LOCATION:16 place Pélabon\\, 13013 Marseille',
        'DESCRIPTION:' + (r.barber ? 'Avec ' + r.barber.name + '. ' : '') + 'Code ' + r.code + '.' + (r.manage ? ' Gérer : ' + r.manage : ''), r.manage ? 'URL:' + r.manage : null, 'END:VEVENT', 'END:VCALENDAR'].filter(Boolean).join('\r\n');
      return URL.createObjectURL(new Blob([ics], { type: 'text/calendar' }));
    } catch (e) { return ''; }
  }

  /* ---------- the sheet ---------- */
  const STEPS = ['formule', 'creneau', 'infos'];
  const TITLES = { formule: 'Ta formule', creneau: 'Ton créneau', infos: 'Ton prénom, ton numéro' };
  let holdTimer = 0;

  function openSheet(step, opener, keepErr) {
    if (S.closeMenu) S.closeMenu();
    if (S.result) resetBooking();
    S.open = true; S.opener = opener || document.activeElement;
    $('#bk').classList.add('open'); $('#bk-veil').classList.add('open'); $('#cta').classList.add('off');
    for (const e of [$('#tb'), $('#main'), $('#venir'), $('#cta')]) e.inert = true;
    document.body.style.overflow = 'hidden';
    goStep(step || (!S.svc ? 'formule' : S.day == null ? 'creneau' : 'infos'), keepErr);
  }
  function closeSheet() {
    if (!S.open) return;
    S.open = false;
    $('#bk').classList.remove('open'); $('#bk-veil').classList.remove('open'); $('#cta').classList.remove('off');
    for (const e of [$('#tb'), $('#main'), $('#venir'), $('#cta')]) e.inert = false;
    document.body.style.overflow = '';
    clearInterval(holdTimer);
    if (S.result) resetBooking();
    renderHero();
    const o = S.opener;
    if (o && o.isConnected && o.focus) o.focus(); else $('#mn-btn').focus();
  }
  function resetBooking() {
    if (S.icsUrl) { try { URL.revokeObjectURL(S.icsUrl); } catch (e) { /* ignore */ } }
    S.result = null; S.icsUrl = ''; S.svc = null; S.staff = 'any'; clearSlot(); S.hold = null; S.err = ''; S.days = null; S.daySel = null; S.f.email = '';
  }
  function goStep(step, keepErr) {
    if (!keepErr) S.err = '';
    if (step === 'infos' && (!S.svc || S.day == null)) step = !S.svc ? 'formule' : 'creneau';
    S.step = step;
    clearInterval(holdTimer);
    const done = step === 'done';
    $('#bk-k').textContent = done ? (S.result.status === 'pending' ? 'Presque' : S.demo ? 'Mode démo' : 'C’est réservé') : 'Étape ' + (STEPS.indexOf(step) + 1) + ' sur 3';
    $('#bk-t').textContent = done ? (S.result.status === 'pending' ? 'Reste l’acompte.' : 'À très vite, ' + S.result.first + '.') : TITLES[step];
    renderTicket(); renderErr(); renderStep(); renderFoot();
    $('#bk-body').scrollTop = 0;
    if (step === 'creneau') { S.daySel = S.day || S.daySel; loadDays(false); }
    const t = $('#bk-t');
    setTimeout(() => { if (S.open) t.focus({ preventScroll: true }); }, 60);
  }
  function renderErr() { const e = $('#bk-err'); e.textContent = S.err || ''; e.hidden = !S.err; }

  function renderTicket() {
    const tk = $('#tk');
    tk.textContent = '';
    tk.className = 'tk';
    if (S.step === 'done') { ticketDone(tk); return; }
    const sv = svcNow(), b = S.staffBy[S.slotStaff], hasSlot = S.day != null;
    const row = (n, key, label, value, extra, ok, can) => {
      const cur = S.step === key;
      const kids = [h('span', { class: 'tk-i', 'aria-hidden': 'true' }, ok && !cur ? icon('check') : String(n)), h('span', { class: 'tk-c' }, [h('span', { class: 'tk-l', text: label }), h('span', { class: 'tk-v', text: value })]), extra];
      const cls = 'tk-r' + (ok ? ' ok' : '') + (cur ? ' cur' : '');
      return can && !cur ? h('button', { type: 'button', class: cls, 'aria-label': label + ' : ' + value + '. Modifier', on: { click: () => goStep(key) } }, kids) : h('div', { class: cls, 'aria-current': cur ? 'step' : null }, kids);
    };
    const ed = (ok, cur) => (ok && !cur ? h('span', { class: 'tk-e ed', 'aria-hidden': 'true', text: 'Modifier' }) : null);
    tk.append(
      row(1, 'formule', 'Formule', sv ? sv.name + ' · ' + durText(sv.dur) : 'À choisir', sv ? h('span', { class: 'tk-e', text: (sv.from ? 'dès ' : '') + eur(sv.price) }) : null, !!sv, true),
      row(2, 'creneau', 'Créneau', hasSlot ? cap(dayWord(S.day)) + ' · ' + hm(S.start) + (b ? ' · avec ' + b.name : '') : S.staff !== 'any' && S.staffBy[S.staff] ? 'À choisir · avec ' + S.staffBy[S.staff].name : 'À choisir', ed(hasSlot, S.step === 'creneau'), hasSlot, true),
      row(3, 'infos', 'Pour', S.f.first.trim() ? S.f.first.trim() + (S.f.phone.trim() ? ' · ' + S.f.phone.trim() : '') : 'Ton prénom, ton numéro', null, S.f.first.trim().length > 1 && phoneOk(S.f.phone), !!sv && hasSlot)
    );
    for (const i of $$('.tk-i svg', tk)) { i.style.width = '14px'; i.style.height = '14px'; }
  }

  function ticketDone(tk) {
    const r = S.result, pending = r.status === 'pending';
    tk.classList.add('done');
    tk.append(
      h('div', { class: 'tk-top' }, [
        h('span', { class: 'tk-ok' + (pending ? ' wait' : '') }, [h('i', { 'aria-hidden': 'true' }, pending ? null : icon('check')), pending ? 'En attente de l’acompte' : S.demo ? 'Simulation' : 'Réservé']),
        h('span', { class: 'tk-code' }, ['Code', h('b', { text: r.code })])
      ]),
      h('p', { class: 'tk-w', text: cap(dayFull(r.day)) + ' · ' + hm(r.start) }),
      h('p', { class: 'tk-f', text: r.svc.name + ' · ' + (r.svc.from ? 'dès ' : '') + eur(r.svc.price) }),
      h('p', { class: 'tk-b', text: (r.barber ? 'Avec ' + r.barber.name + ' · ' : '') + durText(r.svc.dur) }),
      h('div', { class: 'tk-a' }, [h('span', {}, [h('b', { text: 'Barber L’Architecte' }), '16, place Pélabon · 13013 Marseille']), h('span', { class: 'tk-bars', 'aria-hidden': 'true' })])
    );
  }

  function renderStep() {
    const st = $('#st'), fresh = h('div', { class: 'st', id: 'st' });
    ({ formule: stepFormule, creneau: stepCreneau, infos: stepInfos, done: stepDone })[S.step](fresh);
    st.replaceWith(fresh);
  }

  function stepFormule(st) {
    if (!S.sal.booking.enabled) { st.append(h('p', { class: 'full', text: 'La réservation en ligne est momentanément fermée. Passe au salon : 16, place Pélabon.' })); return; }
    const cats = [];
    for (const sv of S.svcs) if (!cats.includes(sv.category)) cats.push(sv.category);
    for (const c of cats) {
      st.append(h('p', { class: 'sg-h', text: c }));
      for (const sv of S.svcs.filter((x) => x.category === c)) {
        st.append(h('button', { type: 'button', class: 'so', 'aria-pressed': String(S.svc === sv.id), on: { click: (e) => { e.currentTarget.setAttribute('aria-pressed', 'true'); chooseSvc(sv.id); } } }, [
          h('span', { class: 'so-l' }, [h('span', { class: 'so-n' }, [sv.name, sv.tag ? h('em', { text: sv.tag }) : null]), h('span', { class: 'so-d', text: (sv.includes || []).join(' · ') })]),
          h('span', { class: 'so-r' }, [h('b', { text: (sv.from ? 'dès ' : '') + eur(sv.price) }), h('small', { text: durText(sv.dur) })])
        ]));
      }
    }
  }

  function stepCreneau(st) {
    const who = h('div', { class: 'who', role: 'group', 'aria-label': 'Avec qui' });
    const pick = (id) => { if (S.staff === id) return; S.staff = id; if (S.day != null) { dropHold(); clearSlot(); renderTicket(); renderHero(); } S.err = ''; renderErr(); loadDays(false); };
    who.append(h('button', { type: 'button', class: 'wc any', 'aria-pressed': String(S.staff === 'any'), text: 'Le premier libre', on: { click: () => pick('any') } }));
    for (const b of S.barbers) who.append(h('button', { type: 'button', class: 'wc', 'aria-pressed': String(S.staff === b.id), on: { click: () => pick(b.id) } }, [mono(b), b.name]));
    st.append(who);
    if (!S.days) { st.append(h('p', { class: 'ld', role: 'status' }, [h('i', { 'aria-hidden': 'true' }), 'On regarde les créneaux libres…'])); return; }
    const first = firstSlot(S.days);
    if (first && !(S.day === first.day && S.start === first.m)) {
      st.append(h('button', { type: 'button', class: 'fast', on: { click: (e) => takeSlot(first.day, first.m, e.currentTarget) } }, [
        h('span', { class: 'fast-l' }, [h('span', { class: 'fast-k', text: 'Le plus tôt' }), h('span', { class: 'fast-t', text: cap(dayWord(first.day)) + ' · ' + hm(first.m) })]),
        h('span', { class: 'fast-go', text: 'Garder' })
      ]));
    }
    const strip = h('div', { class: 'dstrip', role: 'group', 'aria-label': 'Choisis un jour' });
    for (const d of S.days) {
      const dt = D(d.day), n = d.slots.length;
      strip.append(h('button', { type: 'button', class: 'dc', disabled: !n, 'aria-pressed': String(d.day === S.daySel), 'aria-label': cap(dayFull(d.day)) + ', ' + (n ? n + (n > 1 ? ' créneaux libres' : ' créneau libre') : d.open ? 'complet' : 'fermé'), on: { click: () => { S.daySel = d.day; renderStep(); } } },
        [h('small', { text: WDS[dt.getUTCDay()] }), h('b', { text: String(dt.getUTCDate()) }), h('span', { text: n ? n + (n > 1 ? ' libres' : ' libre') : d.open ? 'complet' : 'fermé' })]));
    }
    if (S.daysMore) strip.append(h('button', { type: 'button', class: 'dc more', 'aria-label': 'Voir les jours suivants', on: { click: (e) => { e.currentTarget.disabled = true; loadDays(true); } } }, [h('small', { text: 'Plus tard' }), h('b', { text: '›' }), h('span', { text: '14 jours' })]));
    st.append(strip);
    const day = S.days.find((x) => x.day === S.daySel);
    if (!first) { st.append(h('p', { class: 'full', text: S.staff !== 'any' && S.staffBy[S.staff] ? S.staffBy[S.staff].name + ' n’a rien de libre sur ces jours. Regarde plus tard, ou touche « Le premier libre ».' : 'Rien de libre sur ces jours. Regarde plus tard.' })); return; }
    if (!day) return;
    const groups = [['Matin', day.slots.filter((x) => x.m < 720)], ['Après-midi', day.slots.filter((x) => x.m >= 720)]];
    for (const g of groups) {
      if (!g[1].length) continue;
      st.append(h('p', { class: 'slg-h' }, [g[0] + ' · ' + dayFull(day.day), h('span', { text: g[1].length + (g[1].length > 1 ? ' créneaux' : ' créneau') })]));
      const grid = h('div', { class: 'slots' });
      for (const s of g[1]) grid.append(h('button', { type: 'button', class: 'sl', 'aria-pressed': String(S.day === day.day && S.start === s.m), 'aria-label': cap(dayFull(day.day)) + ' à ' + hm(s.m), text: hm(s.m), on: { click: (e) => takeSlot(day.day, s.m, e.currentTarget) } }));
      st.append(grid);
    }
    const sel = $('[aria-pressed="true"]', strip);
    if (sel) requestAnimationFrame(() => { strip.scrollLeft = Math.max(0, sel.offsetLeft - strip.offsetLeft - 20); });
  }

  function stepInfos(st) {
    const sv = svcNow(), dep = depositFor(sv), bk = S.sal.booking;
    const holdEl = h('p', { class: 'hold', role: 'status' }, [h('i', { 'aria-hidden': 'true' }), h('span', { id: 'hold-t', text: 'Ce créneau est gardé pour toi' }), h('b', { id: 'hold-l', 'aria-hidden': 'true' })]);
    st.append(holdEl);
    const tick = () => {
      const left = S.hold ? Math.round((S.hold.exp - (Date.now() + S.skew)) / 1000) : 0;
      if (left > 0) { $('#hold-l', holdEl).textContent = Math.floor(left / 60) + ':' + String(left % 60).padStart(2, '0'); return; }
      clearInterval(holdTimer);
      holdEl.classList.add('gone');
      $('#hold-t', holdEl).textContent = 'Le créneau n’est plus gardé. Confirme : il est à toi s’il est encore libre.';
    };
    tick(); holdTimer = setInterval(tick, 1000);

    const fld = (id, label, optional, attrs, hint, key) => {
      const input = h('input', Object.assign({ id, name: key, value: S.f[key], 'aria-describedby': id + '-h', 'aria-invalid': 'false', on: { input: (e) => { S.f[key] = e.target.value; e.target.setAttribute('aria-invalid', 'false'); const ht = $('#' + id + '-h'); if (ht && ht.classList.contains('warn')) { ht.classList.remove('warn'); ht.textContent = hint; } renderTicket(); } } }, attrs));
      return h('div', { class: 'fld' }, [h('label', { for: id }, [label, optional ? h('span', { class: 'opt-l', text: ' facultatif' }) : null]), input, h('span', { class: 'hint', id: id + '-h', 'data-d': hint, text: hint })]);
    };
    const form = h('form', { id: 'bk-form', novalidate: true, on: { submit } }, [
      h('div', { class: 'fld2' }, [
        fld('f-first', 'Prénom', false, { type: 'text', autocomplete: 'given-name', autocapitalize: 'words', required: true, maxlength: '40' }, '', 'first'),
        fld('f-phone', 'Téléphone', false, { type: 'tel', inputmode: 'tel', autocomplete: 'tel', required: true, maxlength: '24', placeholder: '06 12 34 56 78' }, '', 'phone')
      ]),
      fld('f-email', 'E-mail', true, { type: 'email', inputmode: 'email', autocomplete: 'email', maxlength: '120' }, 'Pour recevoir la confirmation par e-mail, avec le rendez-vous pour ton agenda.', 'email'),
      h('label', { class: 'ck', for: 'f-sms' }, [
        h('input', Object.assign({ id: 'f-sms', type: 'checkbox', on: { change: (e) => { S.f.sms = e.target.checked; } } }, S.f.sms ? { checked: true } : {})),
        h('span', {}, ['Confirmation et rappel par SMS', h('small', { text: 'Le rappel part la veille à 18 h, avec un lien pour déplacer ou annuler.' })])
      ])
    ]);
    st.append(form);
    if (dep > 0) st.append(h('p', { class: 'note dep', text: 'Un acompte de ' + eur(dep) + ' est demandé pour cette prestation, déduit au salon. Tu le règles en ligne juste après, dans les ' + (bk.pendingPayMin || 15) + ' minutes. Annulé plus de ' + bk.cancelUntilHours + ' h avant, il est remboursé.' }));
    if (S.sal.mode === 'demo') st.append(h('p', { class: 'note demo', text: 'Salon de démonstration : n’entre pas tes vraies coordonnées. Aucun SMS n’est envoyé, aucun paiement n’est débité.' }));
    st.append(h('p', { class: 'note' }, ['Tes coordonnées servent à ce rendez-vous. Ta formule, ton barbier, ton prénom et ton numéro restent aussi sur ce téléphone, pour reprendre plus vite la prochaine fois. ', h('a', { href: '/confidentialite', target: '_blank', rel: 'noopener', text: 'Comment elles sont traitées' })]));
  }

  function stepDone(st) {
    const r = S.result, pending = r.status === 'pending', bk = S.sal.booking, sms = r.sms && S.sal.sms !== false;
    if (pending) {
      st.append(h('div', { class: 'pay-b' }, [
        h('p', { text: 'Il reste à régler l’acompte de ' + eur(r.deposit || 0) + ' dans les ' + (bk.pendingPayMin || 15) + ' minutes. Sans paiement, le créneau est libéré.' }),
        r.payment && r.payment.url ? h('a', { class: 'btn', href: r.payment.url, text: 'Régler l’acompte' }) : null
      ]));
    }
    const li = (ic, t, s) => h('li', {}, [icon(ic), h('span', {}, [t, s ? h('small', { text: s }) : null])]);
    const list = h('ul', { class: 'nxt', 'aria-label': 'La suite' });
    const when = pending ? 'Dès l’acompte réglé : ' : '';
    if (S.demo) list.append(li('sms', 'Mode démo : rien n’est réservé', 'Aucun SMS, aucun e-mail. Réserve sur le site du salon quand il répond.'));
    else {
      if (sms) list.append(li('sms', when + (pending ? 'confirmation par SMS' : 'Confirmation par SMS'), 'Au ' + r.phone + '.'));
      if (r.email) list.append(li('mail', when + (pending ? 'confirmation par e-mail' : 'Confirmation par e-mail'), 'À ' + r.email + ', avec le rendez-vous pour ton agenda.'));
      else list.append(li('mail', 'Pas d’e-mail', 'Tu n’as pas donné d’adresse : la confirmation ne part pas par e-mail.'));
      if (sms && r.day === S.today) list.append(li('bell', 'C’est aujourd’hui', 'Pas de rappel la veille, donc : garde le lien de ton rendez-vous.'));
      else if (sms) list.append(li('bell', 'Rappel par SMS la veille à 18 h', 'Avec un lien pour déplacer ou annuler.'));
      else list.append(li('bell', 'Pas de SMS', r.sms ? 'Les SMS ne sont pas branchés pour l’instant : garde le lien de ton rendez-vous.' : 'Tu as décoché les SMS : garde le lien de ton rendez-vous.'));
      if (S.sal.mode === 'demo') list.append(li('check', 'Salon de démonstration', 'Ici, aucun SMS ni e-mail ne part vraiment.'));
    }
    st.append(list);
    const act = h('div', { class: 'done-act' });
    if (S.icsUrl) act.append(h('a', { class: 'btn', href: S.icsUrl, download: 'rdv-larchitecte.ics', text: 'Ajouter à mon agenda' }));
    act.append(h('a', { class: 'btn ghost', href: S.sal.shop.mapsUrl, target: '_blank', rel: 'noopener', text: 'Itinéraire' }));
    st.append(act);
    if (r.manage) {
      st.append(h('a', { class: 'mg-l', href: r.manage }, [h('span', {}, ['La page de ton rendez-vous', h('small', { text: 'Déplacer ou annuler, jusqu’à ' + bk.cancelUntilHours + ' h avant.' })]), icon('out')]));
    }
    st.append(h('p', { class: 'note' }, [h('button', { type: 'button', class: 'tl', text: 'Revenir au site', on: { click: closeSheet } })]));
  }

  function renderFoot() {
    const ft = $('#bk-foot');
    ft.textContent = '';
    ft.hidden = S.step !== 'infos';
    if (ft.hidden) return;
    const sv = svcNow(), bk = S.sal.booking;
    ft.append(
      h('button', { type: 'submit', form: 'bk-form', class: 'btn', 'aria-disabled': S.busy ? 'true' : null }, S.busy ? [h('span', { class: 'spin', 'aria-hidden': 'true' }), 'On réserve…'] : ['Confirmer', sv ? ' · ' + (sv.from ? 'dès ' : '') + eur(sv.price) : '']),
      h('p', { class: 'bk-terms' }, ['En réservant, tu acceptes les ', h('a', { href: '/cgv', target: '_blank', rel: 'noopener', text: 'CGV' }), '. Annulation gratuite en ligne jusqu’à ' + bk.cancelUntilHours + ' h avant. Paiement au salon' + (depositFor(sv) > 0 ? ', acompte déduit.' : '.')])
    );
  }

  /* ---------- start ---------- */
  function wire() {
    document.addEventListener('click', (e) => {
      const b = e.target.closest('[data-book]');
      if (!b || !S.sal) return;
      if (b.dataset.book === 'creneau') { if (!S.svc) S.svc = S.homeSvc; openSheet(S.day == null ? 'creneau' : 'infos', b); }
      else openSheet(null, b);
    });
    $('#hx-next').addEventListener('click', (e) => {
      if (!S.sal) return;
      if (S.rb) { rebook(e.currentTarget); return; }
      const n = S.next.any;
      if (n) { S.staff = 'any'; takeSlot(n.day, n.m, e.currentTarget); } else openSheet(null, e.currentTarget);
    });
    $('#bk-x').addEventListener('click', closeSheet);
    $('#bk-veil').addEventListener('click', closeSheet);
    $('#forget').addEventListener('click', () => {
      clearMe(); S.me = null; S.rb = null; S.f.first = ''; S.f.phone = '';
      $('#forgot').textContent = ' · C’est oublié sur ce téléphone.';
      renderHero(); renderNow();
    });
  }

  function status() {
    api('/api/public/live').then((l) => {
      for (const e of $$('[data-status]')) {
        e.classList.toggle('open', !!l.open);
        $('span', e).textContent = l.open ? 'Ouvert en ce moment' : 'Fermé en ce moment';
      }
    }).catch(() => null);
  }

  async function boot() {
    heroWord(); chrome(); wire();
    let sal = null;
    if (window.location.protocol === 'file:') S.demo = true;
    else {
      try { sal = await api('/api/public/salon'); }
      catch (e) { S.demo = true; }
      if (sal && (!Array.isArray(sal.services) || !Array.isArray(sal.barbers))) { sal = null; S.demo = true; }
    }
    if (S.demo) { sal = sim('/api/public/salon'); $('#demo-b').hidden = false; $('#top').classList.add('demo'); window.dispatchEvent(new Event('resize')); }
    S.sal = sal;
    S.today = sal.today || S.today;
    S.skew = sal.now ? sal.now - Date.now() : 0;
    S.svcs = sal.services.filter((x) => x.online !== false && x.active !== false && !x.pack);
    for (const x of S.svcs) { S.byId[x.id] = x; if (x.slug) S.bySlug[x.slug] = x; }
    S.barbers = sal.barbers;
    for (const b of S.barbers) S.staffBy[b.id] = b;
    const last = S.me && S.bySlug[S.me.svc];
    S.homeSvc = last ? last.id : S.svcs.length ? S.svcs[0].id : null;
    if (last) S.svc = last.id;
    if (sal.shop && sal.shop.mapsUrl) { $('#ft-maps').href = sal.shop.mapsUrl; $('#pv-link').href = sal.shop.mapsUrl; }
    if (sal.hoursText) $('#ft-h').textContent = sal.hoursText + '.' + (sal.closedText ? ' Fermé ' + sal.closedText + '.' : '');
    renderHeroChips(); renderHero(); renderNow(); renderTeam(); renderCarte(); renderCuts();
    status();
    loadHome();
    // the page left open: the next slots move on
    document.addEventListener('visibilitychange', () => { if (!document.hidden && !S.open) { cache.clear(); loadHome(); status(); } });
  }
  boot();
})();
