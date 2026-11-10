/* « Le salon en direct » : the page's script (no inline script: the server's CSP is script-src 'self').
   It reads the real public API (/api/public/salon, /live, /availability), holds a slot while the client types
   (POST /holds) and books it (POST /bookings). When the API cannot be reached (file opened offline), a simulation
   takes over and a « mode démo » banner says so. */
(function () {
  'use strict';

  const NBSP = '\u00a0';
  const $ = (id) => document.getElementById(id);
  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
  const pad = (n) => String(n).padStart(2, '0');
  const WD = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
  const WDS = ['dim.', 'lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.'];
  const MO = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
  const ADDRESS = '16, place Pélabon, 13013 Marseille';
  const REMINDER_HOUR = 18;

  /* ---------- days and hours (the salon's own calendar: 'YYYY-MM-DD' and minutes after midnight) ---------- */
  const utc = (day) => { const p = day.split('-'); return new Date(Date.UTC(+p[0], +p[1] - 1, +p[2])); };
  const addDays = (day, n) => { const d = utc(day); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  const diffDays = (a, b) => Math.round((utc(b) - utc(a)) / 86400000);
  const dow = (day) => utc(day).getUTCDay();
  const fmtH = (m) => Math.floor(m / 60) + NBSP + 'h' + (m % 60 ? NBSP + pad(m % 60) : '');
  const hm = (m) => pad(Math.floor(m / 60)) + pad(m % 60);
  const dayLong = (day) => { const d = utc(day); return WD[d.getUTCDay()] + ' ' + (d.getUTCDate() === 1 ? '1er' : d.getUTCDate()) + ' ' + MO[d.getUTCMonth()]; };
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
  const eur = (cents) => (cents % 100 ? (cents / 100).toFixed(2).replace('.', ',') : String(cents / 100)) + NBSP + '€';
  const durText = (min) => min < 60 ? min + ' min' : Math.floor(min / 60) + ' h' + (min % 60 ? ' ' + pad(min % 60) : '');
  function dayWord(day) {
    const n = diffDays(S.today, day);
    return n === 0 ? 'Aujourd’hui' : n === 1 ? 'Demain' : cap(dayLong(day));
  }

  /* ---------- the booking client: the real API ---------- */
  function ApiError(status, code, message) { this.status = status; this.code = code; this.message = message; }
  async function req(method, path, body) {
    let res;
    try {
      // no-store: the answers allow stale-while-revalidate, and a planning « en direct » must never show a slot someone just took
      res = await fetch(path, { method, cache: 'no-store', headers: body ? { 'content-type': 'application/json', accept: 'application/json' } : { accept: 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    } catch (e) { throw new ApiError(0, 'network', 'Pas de réseau. Vérifie ta connexion et réessaie.'); }
    let data = null;
    try { data = await res.json(); } catch (e) { /* not JSON: no API behind this address */ }
    if (!res.ok || data == null) {
      const er = data && data.error;
      if (!er && (res.status === 404 || res.ok)) throw new ApiError(0, 'network', 'Le service de réservation ne répond pas.');
      throw new ApiError(res.status, (er && er.code) || 'error', (er && er.message) || 'Un souci est survenu. Réessaie dans un instant.');
    }
    return data;
  }
  const Real = {
    salon: () => req('GET', '/api/public/salon'),
    live: () => req('GET', '/api/public/live'),
    availability: (from, days, serviceId, staffId, hold) => req('GET', '/api/public/availability?from=' + from + '&days=' + days + '&services=' + encodeURIComponent(serviceId) + '&staff=' + encodeURIComponent(staffId) + (hold ? '&hold=' + encodeURIComponent(hold) : '')),
    hold: (body) => req('POST', '/api/public/holds', body),
    release: (id) => req('DELETE', '/api/public/holds/' + encodeURIComponent(id)).catch(() => null),
    book: (body) => req('POST', '/api/public/bookings', body)
  };

  /* ---------- the simulation: same answers, nothing leaves the page (prices: server/domain/seed.js) ---------- */
  function makeSim() {
    const now = new Date();
    const today = now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate());
    const nowMin = () => { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); };
    const SV = [
      ['cl', 'Coupe classique', 'Coupes', 2000, 30, 0, ['Coupe', 'Shampooing', 'Coiffage']],
      ['cc', 'Coupe + contour de barbe', 'Coupes', 2500, 30, 0, ['Coupe', 'Contour de la barbe']],
      ['ct', 'Coupe + taille de barbe', 'Coupes', 3000, 30, 0, ['Coupe', 'Taille de barbe', 'Shampooing', 'Coiffage', 'Soin cheveux', 'Soin barbe']],
      ['tr', 'Transformation', 'Changer de tête', 5000, 60, 0, ['Diagnostic', 'Étude de faisabilité', 'Coupe', 'Coiffage et soin']],
      ['cd', 'Coupe + décoloration', 'Changer de tête', 8000, 90, 1, ['Coupe', 'Décoloration']],
      ['de', 'Décoloration', 'Changer de tête', 6000, 60, 1, ['Décoloration', 'Sans coupe']],
      ['co', 'Coloration', 'Changer de tête', 3000, 60, 1, ['Coloration', 'Sans coupe']],
      ['si', 'Silver', 'Changer de tête', 10000, 60, 0, ['Décoloration jusqu’au blanc', 'Coloration grise', 'Soin', 'Produit d’entretien offert']],
      ['eb', 'Entretien barbe', 'Barbe', 1500, 30, 0, ['Contour de la barbe', 'Huile']],
      ['tb', 'Taille de barbe', 'Barbe', 1800, 30, 0, ['Taille', 'Mise en forme', 'Huile']],
      ['cb', 'Cover barbe', 'Barbe', 1500, 30, 0, ['Couleur de la barbe', 'Soin']]
    ].map((x) => ({ id: 'sim_' + x[0], slug: x[0], name: x[1], category: x[2], price: x[3], dur: x[4], from: !!x[5], includes: x[6], online: true, deposit: 0, description: '' }));
    const BB = [['JKut', 'JK'], ['Frank', 'F'], ['Le Soldat', 'LS'], ['Esteban', 'E']].map((x, i) => ({ id: 'sim_b' + i, name: x[0], initials: x[1], bio: '', away: null }));
    const mine = new Set();
    const hash = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0) / 4294967296; };
    const open = (day) => { const d = dow(day); return d >= 2 && d <= 6; };
    const busy = (day, b, m) => mine.has(day + b + m) || hash(day + '|' + b + '|' + m) < 0.56;
    const free = (day, b, m, dur) => {
      if (!open(day) || m < 540 || m + dur > 1110) return false;
      if (day === today && m < nowMin() + 30) return false;
      for (let t = m; t < m + dur; t += 30) if (busy(day, b, t)) return false;
      return true;
    };
    const wait = (v) => new Promise((ok) => setTimeout(() => ok(v), 180));
    return {
      salon: () => wait({
        shop: { name: 'Barber L’Architecte', mapsUrl: '', instagram: '' }, hours: { 0: [], 1: [], 2: [[540, 1110]], 3: [[540, 1110]], 4: [[540, 1110]], 5: [[540, 1110]], 6: [[540, 1110]] },
        hoursText: 'Du mardi au samedi, 9 h – 18 h 30', closedText: 'le dimanche et le lundi', openings: [], closures: [],
        booking: { enabled: true, stepMin: 30, maxDaysAhead: 90, holdMin: 5, pendingPayMin: 15, cancelUntilHours: 12 }, deposits: { mode: 'none' },
        services: SV, menu: SV.map((x) => ({ slug: x.slug, name: x.name, category: x.category, price: x.price, from: x.from, dur: x.dur, online: true }))
          .concat([{ slug: 'ab', name: 'Carnet 5 coupes', category: 'Carnet', price: 8000, from: false, dur: 30, online: false }]),
        barbers: BB, sms: false, mode: 'sim', today, now: Date.now()
      }),
      live: () => { const m = nowMin(); return wait({ open: open(today) && m >= 540 && m < 1110, min: m, today }); },
      availability: (from, days, serviceId, staffId) => {
        const sv = SV.find((x) => x.id === serviceId) || SV[0];
        const out = [];
        for (let i = 0; i < days; i++) {
          const day = addDays(from, i), slots = [];
          for (let m = 540; m < 1110; m += 30) if (free(day, staffId, m, sv.dur)) slots.push({ m, s: staffId });
          out.push({ day, open: open(day), slots });
        }
        return wait({ dur: sv.dur, days: out, now: Date.now() });
      },
      hold: (b) => {
        const sv = SV.find((x) => x.id === b.serviceIds[0]) || SV[0];
        if (!free(b.day, b.staffId, b.start, sv.dur)) return Promise.reject(new ApiError(409, 'taken', 'Ce créneau vient d’être pris.'));
        return wait({ holdId: 'sim_h' + Date.now(), staffId: b.staffId, exp: Date.now() + 5 * 60000 });
      },
      release: () => wait({ ok: true }),
      book: (b) => {
        const sv = SV.find((x) => x.id === b.serviceIds[0]) || SV[0];
        for (let t = b.start; t < b.start + sv.dur; t += 30) mine.add(b.day + b.staffId + t);
        return wait({ code: 'DEMO' + String(Math.floor(hash(b.day + b.start + b.phone) * 9000) + 1000), token: '', manage: '', status: 'booked', deposit: 0, staffId: b.staffId, payment: null });
      }
    };
  }

  /* ---------- state ---------- */
  let Api = Real;
  const S = {
    sim: false, salon: null, services: [], barbers: [], svc: null, today: '', nowMin: 0, open: false, skew: 0,
    from: '', day: '', tab: 0, days: [], /* [{ day, open, by: { staffId: Set(min) } }] */
    hold: null, /* { id, staffId, day, start, exp } */
    seq: 0, sig: '', next: null, msg: '', booked: null, ready: false
  };
  const SPAN = 14;
  const wide = () => window.matchMedia('(min-width:700px)').matches;
  const desk = () => window.matchMedia('(min-width:1000px)').matches;
  const barber = (id) => S.barbers.find((b) => b.id === id);
  const dayData = (day) => S.days.find((d) => d.day === day);
  const freeCount = (d, bid) => { if (!d) return 0; if (bid) return d.by[bid] ? d.by[bid].size : 0; let n = 0; for (const k in d.by) n += d.by[k].size; return n; };

  /* ---------- hero: the halftone « Frais. » (the main site's word, drawn the same way) ---------- */
  const Hero = {
    cv: $('hero-cv'), mask: document.createElement('canvas'), f: 1.02, ok: false,
    layout() {
      const cv = this.cv, box = cv.parentElement;
      const W = Math.max(40, Math.floor(box.clientWidth));
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const c = cv.getContext('2d');
      const font = (s) => '400 ' + s.toFixed(2) + 'px "Instrument Serif","Times New Roman",Times,serif';
      const vh = window.innerHeight || 800, big = window.innerWidth > 900;
      c.setTransform(1, 0, 0, 1, 0, 0);
      c.font = font(100);
      const size = Math.min(W / (c.measureText('Frais.').width / 100), vh * (big ? 0.5 : 0.3));
      c.font = font(size);
      const m = c.measureText('Frais.');
      const asc = m.actualBoundingBoxAscent || size * 0.72, desc = m.actualBoundingBoxDescent || 0;
      this.capH = c.measureText('H').actualBoundingBoxAscent || size * 0.7;
      const padT = Math.ceil(size * 0.03) + 3;
      const H = Math.ceil(padT + asc + desc + padT);
      this.W = W; this.H = H; this.dpr = dpr; this.w = m.width; this.base = padT + asc; this.top = padT - 2; this.bot = padT + asc + desc + 2;
      this.cell = Math.max(3.2, Math.min(11, size / 30));
      cv.style.height = H + 'px';
      cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
      this.mask.width = cv.width; this.mask.height = cv.height;
      const mc = this.mask.getContext('2d');
      mc.setTransform(dpr, 0, 0, dpr, 0, 0);
      mc.clearRect(0, 0, W, H);
      mc.font = font(size); mc.fillStyle = '#000'; mc.textBaseline = 'alphabetic';
      mc.fillText('Frais.', 0, this.base);
      this.ok = true;
      this.draw(this.f);
    },
    draw(f) {
      this.f = f;
      if (!this.ok) return;
      const c = this.cv.getContext('2d'), d = this.dpr, cell = this.cell;
      c.setTransform(d, 0, 0, d, 0, 0);
      c.globalCompositeOperation = 'source-over';
      c.clearRect(0, 0, this.W, this.H);
      c.fillStyle = '#0F0E0D';
      c.beginPath();
      const R = cell * 0.6, bTop = this.base - this.capH * f, top = this.top - cell;
      if (bTop > top) c.rect(-cell, top, this.w + cell * 2, bTop - top);
      const span = Math.max(1, this.base - bTop);
      let row = 0;
      for (let y = bTop + cell * 0.3; y < this.bot + cell; y += cell * 0.866, row++) {
        const t = (y - bTop) / span;
        const rad = t >= 1 ? 0 : R * Math.pow(1 - t, 1.15);
        if (rad < 0.22) continue;
        for (let x = -cell + (row % 2 ? cell / 2 : 0); x < this.w + cell; x += cell) { c.moveTo(x + rad, y); c.arc(x, y, rad, 0, 6.2832); }
      }
      c.fill();
      c.globalCompositeOperation = 'destination-in';
      c.setTransform(1, 0, 0, 1, 0, 0);
      c.drawImage(this.mask, 0, 0);
      c.globalCompositeOperation = 'source-over';
    },
    intro() {
      if (window.matchMedia('(prefers-reduced-motion:reduce)').matches) { this.layout(); this.draw(0.42); return; }
      this.layout();
      const t0 = performance.now(), self = this;
      (function step(t) {
        const k = Math.min(1, (t - t0) / 1400), e = 1 - Math.pow(1 - k, 3);
        self.draw(1.02 + (0.42 - 1.02) * e);
        if (k < 1) requestAnimationFrame(step);
      })(t0);
    }
  };
  function bootHero() {
    const go = () => Hero.intro();
    if (document.fonts && document.fonts.load) document.fonts.load('400 100px "Instrument Serif"', 'Frais.').then(go, go); else go();
    let rz = 0, lastW = window.innerWidth;
    window.addEventListener('resize', () => {
      if (window.innerWidth === lastW) return; // a phone's address bar hiding is not a resize of the word
      lastW = window.innerWidth;
      clearTimeout(rz); rz = setTimeout(() => Hero.layout(), 120);
    });
  }

  /* ---------- top bar, Sommaire, sticky « Réserver » ---------- */
  const tb = $('tb'), menu = $('menu'), menuBtn = $('menu-btn'), cta = $('cta');
  function setMenu(on) {
    menu.hidden = !on;
    tb.classList.toggle('mo', on);
    menuBtn.setAttribute('aria-expanded', String(on));
    menuBtn.setAttribute('aria-label', on ? 'Fermer le sommaire' : 'Ouvrir le sommaire');
    document.documentElement.style.overflow = on ? 'hidden' : '';
    if (on) { const a = menu.querySelector('a'); if (a) a.focus(); }
    onScroll();
  }
  function onScroll() {
    const tones = document.querySelectorAll('[data-tone]');
    let tone = 'light';
    for (const s of tones) { const r = s.getBoundingClientRect(); if (r.top <= 40 && r.bottom > 40) tone = s.getAttribute('data-tone'); }
    tb.classList.toggle('light', tone === 'light'); tb.classList.toggle('dark', tone === 'dark');
    tb.classList.toggle('scrolled', window.scrollY > 20);
    const vh = window.innerHeight;
    const rs = $('reserver').getBoundingClientRect(), ft = $('venir').getBoundingClientRect();
    const inPlan = rs.top < vh * 0.55 && rs.bottom > vh * 0.45;
    cta.classList.toggle('off', inPlan || ft.top < vh * 0.6 || !menu.hidden);
  }
  function bootChrome() {
    menuBtn.addEventListener('click', () => setMenu(menu.hidden));
    menu.addEventListener('click', (e) => { if (e.target.closest('a')) setMenu(false); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !menu.hidden) { setMenu(false); menuBtn.focus(); } });
    let tick = false;
    window.addEventListener('scroll', () => { if (tick) return; tick = true; requestAnimationFrame(() => { tick = false; onScroll(); }); }, { passive: true });
    window.addEventListener('resize', onScroll);
    onScroll();
  }
  // slot: the choice is made (a barber, a day, a formule), so a phone lands on the days and the planning, past the formule
  function toPlanning(focus, slot) {
    const top = $('reserver').getBoundingClientRect().top + window.scrollY;
    const y = desk() ? top : (slot ? document.querySelector('.pl-top') : $('fm')).getBoundingClientRect().top + window.scrollY - 84;
    window.scrollTo({ top: Math.max(top, y), behavior: window.matchMedia('(prefers-reduced-motion:reduce)').matches ? 'auto' : 'smooth' });
    if (focus) $('pl-day').focus({ preventScroll: true });
  }

  /* ---------- step 1: la formule ---------- */
  function depositOf(sv) {
    const d = S.salon.deposits;
    if (S.sim || (S.salon.payments && S.salon.payments.live === false)) return 0;
    if (typeof sv.deposit === 'number') return Math.min(sv.price, sv.deposit);
    if (!d || d.mode === 'none' || (d.mode === 'threshold' && sv.price < d.thresholdCents)) return 0;
    return Math.min(sv.price, Math.max(500, Math.round((sv.price * d.percent) / 100 / 100) * 100));
  }
  function priceText(sv) { return (sv.from ? 'dès ' : '') + eur(sv.price); }
  function renderFormules() {
    const list = $('fm-list');
    list.textContent = '';
    let cat = '';
    S.services.forEach((sv) => {
      if (sv.category !== cat) { cat = sv.category; list.appendChild(el('p', 'fm-cat', cat)); }
      const lab = el('label', 'fm-o' + (S.svc && S.svc.id === sv.id ? ' on' : ''));
      const inp = el('input', 'vh'); inp.type = 'radio'; inp.name = 'formule'; inp.value = sv.id; inp.checked = !!(S.svc && S.svc.id === sv.id);
      const name = el('span', 'fm-on', sv.name); name.appendChild(el('small', '', durText(sv.dur)));
      const price = el('span', 'fm-op'); if (sv.from) price.appendChild(el('small', '', 'dès')); price.appendChild(document.createTextNode(eur(sv.price)));
      lab.append(inp, el('i'), name, price);
      list.appendChild(lab);
    });
    renderFormuleCur();
  }
  function renderFormuleCur() {
    const cur = $('fm-cur'), sv = S.svc;
    cur.textContent = '';
    if (!sv) return;
    cur.appendChild(document.createTextNode(sv.name));
    cur.appendChild(el('small', '', durText(sv.dur) + ' · ' + priceText(sv)));
    const dep = depositOf(sv), note = $('fm-note');
    note.hidden = !(dep > 0 || sv.description);
    note.textContent = [sv.description, dep > 0 ? 'Un acompte de ' + eur(dep) + ' est demandé pour cette prestation, déduit au salon.' : ''].filter(Boolean).join(' ');
  }
  function chooseService(id, scroll) {
    const sv = S.services.find((x) => x.id === id);
    if (!sv) return;
    const changed = !S.svc || S.svc.id !== sv.id;
    S.svc = sv;
    document.querySelectorAll('.fm-o').forEach((l) => { const i = l.querySelector('input'); const on = i.value === sv.id; l.classList.toggle('on', on); i.checked = on; });
    renderFormuleCur();
    if (!desk()) $('fm').open = false;
    if (changed) { dropHold(); S.sig = ''; $('pl').setAttribute('aria-busy', 'true'); loadAvail(); }
    if (scroll) toPlanning(true, true);
  }

  /* ---------- step 2: the days and the planning ---------- */
  async function loadAvail() {
    if (!S.svc || !S.barbers.length) return;
    const seq = ++S.seq, from = S.from, svc = S.svc;
    try {
      const [live, ...res] = await Promise.all([Api.live().catch(() => null)].concat(S.barbers.map((b) => Api.availability(from, SPAN, svc.id, b.id, S.hold ? S.hold.id : ''))));
      if (seq !== S.seq) return;
      if (live) { S.open = !!live.open; S.nowMin = live.min; if (live.today && live.today !== S.today) { S.today = live.today; if (S.from < S.today) S.from = S.today; } }
      const days = [];
      res[0].days.forEach((d, i) => {
        const by = {};
        let open = d.open;
        S.barbers.forEach((b, k) => { const dd = res[k].days[i]; by[b.id] = new Set(dd ? dd.slots.map((x) => x.m) : []); open = open || !!(dd && dd.open); });
        days.push({ day: d.day, open, by });
      });
      S.days = days;
      if (from === S.today) {
        S.next = null;
        for (const d of days) { let best = null; for (const b of S.barbers) for (const m of d.by[b.id]) if (best == null || m < best) best = m; if (best != null) { S.next = { day: d.day, m: best, n: S.barbers.filter((b) => d.by[b.id].has(best)).length, bid: S.barbers.find((b) => d.by[b.id].has(best)).id }; break; } }
      }
      if (!S.day || !dayData(S.day)) { const first = days.find((d) => freeCount(d) > 0) || days.find((d) => d.open) || days[0]; S.day = first ? first.day : from; }
      S.ready = true;
      setLive(true);
      render();
    } catch (e) {
      if (seq !== S.seq) return;
      setLive(false);
      if (!S.ready) { const pl = $('pl'); pl.textContent = ''; pl.removeAttribute('aria-busy'); const p = el('p', 'pl-shut', 'Le planning ne répond pas.'); p.appendChild(el('small', '', e.message || 'Réessaie dans un instant.')); pl.appendChild(p); }
    }
  }
  function setLive(ok) {
    const p = $('pl-live'), d = new Date();
    p.classList.toggle('off', !ok);
    p.lastElementChild.textContent = ok ? 'En direct · mis à jour à ' + pad(d.getHours()) + ':' + pad(d.getMinutes()) : 'Connexion perdue · nouvel essai…';
  }
  function rowsOf(day) {
    const sal = S.salon, sp = (sal.openings || []).find((o) => o.day === day);
    const iv = sp ? sp.intervals : (sal.hours && sal.hours[dow(day)]) || [];
    const step = (sal.booking && sal.booking.stepMin) || 30;
    const rows = [];
    iv.forEach((x) => { for (let m = x[0]; m < x[1]; m += step) rows.push(m); });
    const d = dayData(day);
    if (d) for (const k in d.by) d.by[k].forEach((m) => { if (!rows.includes(m)) rows.push(m); });
    return rows.sort((a, b) => a - b);
  }
  function countText(n) { return n === 0 ? 'Complet' : n + (n > 1 ? ' libres' : ' libre'); }

  function render() {
    const d = dayData(S.day);
    const sig = JSON.stringify([S.svc.id, S.from, S.day, S.tab, S.hold && [S.hold.staffId, S.hold.day, S.hold.start], S.today, Math.floor(S.nowMin / 30), S.days.map((x) => [x.open, S.barbers.map((b) => [...x.by[b.id]])])]);
    renderStatus();
    renderTeam();
    if (sig === S.sig) return;
    S.sig = sig;
    renderDays();
    renderPlan(d);
  }

  function renderDays() {
    const box = $('days'), keep = box.scrollLeft;
    box.textContent = '';
    if (S.from > S.today) { const b = el('button', 'ds-more', 'Dates d’avant'); b.type = 'button'; b.dataset.shift = '-1'; box.appendChild(b); }
    S.days.forEach((d) => {
      const n = freeCount(d), b = el('button', 'ds-d' + (d.open ? '' : ' shut'));
      b.type = 'button'; b.dataset.day = d.day;
      b.setAttribute('aria-pressed', String(d.day === S.day));
      b.setAttribute('aria-label', cap(dayLong(d.day)) + ', ' + (!d.open ? 'fermé' : n ? n + ' créneau' + (n > 1 ? 'x' : '') + ' libre' + (n > 1 ? 's' : '') : 'complet'));
      b.append(el('span', 'ds-w1', d.day === S.today ? 'auj.' : WDS[dow(d.day)]), el('span', 'ds-n', String(utc(d.day).getUTCDate())), el('span', 'ds-f', !d.open ? 'fermé' : n ? countText(n) : 'complet'));
      box.appendChild(b);
    });
    const max = (S.salon.booking && S.salon.booking.maxDaysAhead) || 60;
    if (diffDays(S.today, addDays(S.from, SPAN)) <= max) { const b = el('button', 'ds-more', 'Dates suivantes'); b.type = 'button'; b.dataset.shift = '1'; box.appendChild(b); }
    box.scrollLeft = keep;
  }

  function renderPlan(d) {
    const pl = $('pl'), tabs = $('pl-tabs');
    const act = document.activeElement, refocus = act && act.classList && act.classList.contains('pl-c') ? [act.dataset.b, act.dataset.m] : null;
    pl.textContent = ''; tabs.textContent = '';
    pl.removeAttribute('aria-busy');
    const title = $('pl-day');
    title.textContent = dayWord(S.day);
    title.appendChild(el('small', '', (diffDays(S.today, S.day) < 2 ? cap(dayLong(S.day)) + ' · ' : '') + S.svc.name + ', ' + durText(S.svc.dur)));
    const total = freeCount(d);
    $('pl-first').hidden = !S.next;
    if (!d || !d.open) {
      tabs.hidden = true;
      const p = el('p', 'pl-shut', 'Le salon est fermé ce jour-là.');
      p.appendChild(el('small', '', S.salon.hoursText || ''));
      pl.appendChild(p);
      return;
    }
    tabs.hidden = false;
    const rows = rowsOf(S.day);
    const half = Math.ceil(rows.length / 2);
    // on a phone, open the first chair that has room rather than a full one
    if (!freeCount(d, S.barbers[S.tab].id) && total && !S.tabTouched) S.tab = Math.max(0, S.barbers.findIndex((b) => freeCount(d, b.id) > 0));
    const times = el('div', 'pl-times'); times.setAttribute('aria-hidden', 'true');
    rows.forEach((m) => times.appendChild(el('span', m % 60 ? 'half' : '', fmtH(m))));
    pl.appendChild(times);
    const h = S.hold && S.hold.day === S.day ? S.hold : null;
    S.barbers.forEach((b, i) => {
      const n = freeCount(d, b.id);
      const tab = el('button', 'pl-tab'); tab.type = 'button'; tab.id = 'tab-' + i; tab.dataset.tab = String(i);
      tab.setAttribute('role', 'tab'); tab.setAttribute('aria-selected', String(i === S.tab)); tab.setAttribute('aria-controls', 'col-' + i); tab.tabIndex = i === S.tab ? 0 : -1;
      tab.append(el('b', '', b.name), el('small', '', countText(n)));
      tabs.appendChild(tab);

      const col = el('div', 'pl-col' + (i === S.tab ? ' on' : '')); col.id = 'col-' + i;
      col.setAttribute('role', 'group'); col.setAttribute('aria-label', b.name + ', ' + countText(n).toLowerCase());
      const hd = el('div', 'pl-hd'), hn = el('div', 'pl-hn');
      const sm = el('small', n ? 'has' : '', b.away && b.away.note && !n ? b.away.note : countText(n));
      hn.append(el('b', '', b.name), sm);
      hd.append(el('span', 'pl-mono', b.initials || b.name.charAt(0)), hn);
      hd.firstChild.setAttribute('aria-hidden', 'true');
      const cells = el('div', 'pl-cells'); cells.style.setProperty('--half', String(half));
      rows.forEach((m) => {
        const mine = h && h.staffId === b.id && h.start === m;
        const cov = h && h.staffId === b.id && m > h.start && m < h.start + S.svc.dur;
        let c;
        if (d.by[b.id].has(m) || mine) {
          c = el('button', 'pl-c' + (mine ? ' mine' : '')); c.type = 'button'; c.dataset.b = b.id; c.dataset.m = String(m);
          c.setAttribute('aria-label', fmtH(m) + ' avec ' + b.name + ', ' + dayLong(S.day) + (mine ? ', ton créneau' : ', libre'));
          c.appendChild(el('span', '', fmtH(m)));
        } else {
          c = el('div', 'pl-c ' + (cov ? 'cov' : 'busy' + (S.day === S.today && m < S.nowMin ? ' past' : '')));
          c.setAttribute('aria-hidden', 'true');
          if (!cov) c.appendChild(el('span', '', fmtH(m)));
        }
        cells.appendChild(c);
      });
      col.append(hd, cells);
      pl.appendChild(col);
    });
    if (refocus) { const again = pl.querySelector('button.pl-c[data-b="' + refocus[0] + '"][data-m="' + refocus[1] + '"]'); if (again) again.focus({ preventScroll: true }); }
  }

  function renderStatus() {
    let text, open = S.open;
    const t = dayData(S.today), nx = S.next;
    if (open) {
      if (nx && nx.day === S.today) text = 'Ouvert · ' + nx.n + (nx.n > 1 ? ' fauteuils libres' : ' fauteuil libre') + ' à ' + fmtH(nx.m);
      else text = t || nx ? 'Ouvert · complet en ligne aujourd’hui' : 'Ouvert';
    } else text = nx ? 'Fermé · prochain créneau ' + dayWord(nx.day).toLowerCase() + ' à ' + fmtH(nx.m) : 'Fermé · ' + (S.salon.hoursText || '');
    document.querySelectorAll('[data-live-st]').forEach((p) => { p.classList.toggle('open', open); p.lastElementChild.textContent = text; });
    $('hero-next-v').textContent = nx ? dayWord(nx.day).replace(/^(\S+) (\S+) (\S{3})\S*$/, '$1 $2 $3.') + ' · ' + fmtH(nx.m) : 'Voir le planning';
  }

  /* ---------- l'équipe: monograms and each barber's next free slot ---------- */
  function renderTeam() {
    const ul = $('team');
    const key = S.barbers.map((b) => { const n = nextOf(b.id); return n ? n.day + n.m : '-'; }).join('|');
    if (ul.dataset.k === key) return;
    ul.dataset.k = key;
    ul.textContent = '';
    S.barbers.forEach((b, i) => {
      const li = el('li', 'bb-i');
      const mono = el('span', 'bb-mono', b.initials || b.name.charAt(0)); mono.setAttribute('aria-hidden', 'true');
      li.append(mono, el('h3', 'bb-n', b.name));
      if (b.bio) li.appendChild(el('p', 'bb-bio', b.bio));
      const n = nextOf(b.id);
      const go = el('button', 'bb-next' + (n ? '' : ' none')); go.type = 'button'; go.dataset.tab = String(i); if (n) { go.dataset.day = n.day; }
      go.append(el('i'), document.createTextNode(n ? dayWord(n.day).replace(/^(\S+) (\S+) (\S{3})\S*$/, '$1 $2 $3.') + ' · ' + fmtH(n.m) : (b.away && b.away.note) || 'Voir son planning'));
      go.firstChild.setAttribute('aria-hidden', 'true');
      go.setAttribute('aria-label', (n ? 'Prochain créneau de ' + b.name + ' : ' + dayWord(n.day).toLowerCase() + ' à ' + fmtH(n.m) : 'Voir le planning de ' + b.name) + '. Ouvrir le planning');
      const w = el('p', 'bb-go'); w.appendChild(go); li.appendChild(w);
      ul.appendChild(li);
    });
  }
  function nextOf(bid) {
    for (const d of S.days) { let best = null; d.by[bid].forEach((m) => { if (best == null || m < best) best = m; }); if (best != null) return { day: d.day, m: best }; }
    return null;
  }

  /* ---------- la carte ---------- */
  function renderCarte() {
    const box = $('carte-list');
    box.textContent = '';
    let cat = '';
    (S.salon.menu || []).forEach((it) => {
      if (it.category !== cat) { cat = it.category; box.appendChild(el('h3', 'cr-cat', cat)); }
      const sv = S.services.find((x) => (it.slug && x.slug === it.slug) || x.name === it.name);
      const row = el('div', 'cr-i');
      const name = el('p', 'cr-n', it.name);
      const bits = [];
      if (sv && sv.includes && sv.includes.length) bits.push(sv.includes.join(', '));
      bits.push(it.online ? durText(it.dur) : 'Se prend au salon');
      name.appendChild(el('small', '', bits.join(' · ')));
      const price = el('p', 'cr-p'); if (it.from) price.appendChild(el('small', '', 'dès')); price.appendChild(document.createTextNode(eur(it.price)));
      row.append(name, price);
      if (it.online && sv) { const b = el('button', 'btn small ghost cr-go', 'Voir les créneaux'); b.type = 'button'; b.dataset.svc = sv.id; b.setAttribute('aria-label', 'Voir les créneaux pour ' + it.name); row.appendChild(b); }
      box.appendChild(row);
    });
    if (S.services.length) { const min = Math.min.apply(null, S.services.map((x) => x.price)); $('cta-sub').textContent = 'dès ' + eur(min); }
  }

  /* ---------- holding a slot, then the sheet ---------- */
  const bk = $('bk'), form = $('bk-form');
  let holdTimer = 0;
  function planMsg(text) {
    const p = $('pl-msg');
    p.hidden = !text; p.textContent = text || '';
  }
  function dropHold() {
    if (S.hold) { Api.release(S.hold.id); S.hold = null; }
    clearInterval(holdTimer);
  }
  async function pick(btn) {
    if (S.picking) return;
    const b = barber(btn.dataset.b), m = Number(btn.dataset.m), day = S.day;
    if (S.hold && S.hold.staffId === b.id && S.hold.day === day && S.hold.start === m) { openSheet(); return; }
    S.picking = true; btn.setAttribute('aria-busy', 'true');
    planMsg('');
    try {
      const r = await Api.hold({ serviceIds: [S.svc.id], staffId: b.id, day, start: m, ...(S.hold ? { replace: S.hold.id } : {}) });
      S.hold = { id: r.holdId, staffId: r.staffId || b.id, day, start: m, exp: r.exp };
      S.sig = ''; render();
      openSheet();
    } catch (e) {
      btn.removeAttribute('aria-busy');
      if (e.code === 'taken') { planMsg('Ce créneau vient d’être pris. Le planning est à jour : choisis-en un autre, ta formule et ton jour sont gardés.'); S.sig = ''; await loadAvail(); $('pl-day').focus({ preventScroll: true }); }
      else planMsg(e.message);
    } finally { S.picking = false; }
  }
  function openSheet() {
    const h = S.hold, b = barber(h.staffId), sv = S.svc;
    form.hidden = false; $('bk-done').hidden = true;
    $('bk-t').textContent = 'Ton créneau';
    $('bk-x').setAttribute('aria-label', 'Fermer et libérer le créneau');
    $('recap-w').textContent = dayWord(h.day) + (diffDays(S.today, h.day) < 2 ? ', ' + dayLong(h.day).replace(/^\S+ /, '') : '') + ' à ' + fmtH(h.start);
    $('recap-s').textContent = sv.name + ' · ' + durText(sv.dur) + ' · avec ' + b.name;
    $('bk-price').textContent = priceText(sv);
    const dep = depositOf(sv), hours = (S.salon.booking && S.salon.booking.cancelUntilHours) || 12;
    $('bk-line').textContent = dep > 0 ? 'dont ' + eur(dep) + ' d’acompte en ligne' : 'à régler au salon';
    $('dep').hidden = !(dep > 0);
    $('dep').textContent = dep > 0 ? 'Un acompte de ' + eur(dep) + ' est demandé pour cette prestation, déduit au salon. Annulé plus de ' + hours + ' h avant, il est remboursé.' : '';
    $('bk-go').textContent = dep > 0 ? 'Réserver et régler l’acompte' : 'Confirmer le rendez-vous';
    const terms = $('bk-terms');
    terms.hidden = !(dep > 0);
    if (dep > 0 && !terms.firstChild) { terms.append('En réservant, tu acceptes les conditions d’annulation : gratuite jusqu’à ' + hours + NBSP + 'h avant, ensuite l’acompte reste au salon. '); const a = el('a', '', 'Voir les CGV'); a.href = '/cgv'; a.target = '_blank'; a.rel = 'noopener'; terms.appendChild(a); }
    const demo = $('bk-demo');
    demo.hidden = !(S.sim || S.salon.mode === 'demo');
    demo.textContent = S.sim ? 'Mode démo : le salon n’est pas joignable d’ici. Rien n’est réservé ni envoyé.' : 'Démo : n’entre pas tes vraies coordonnées, tout est visible. Aucun SMS n’est envoyé, aucun paiement n’est débité.';
    $('f-sms').closest('.sw').hidden = !reminderPossible(h.day);
    showErr('');
    tickHold();
    clearInterval(holdTimer); holdTimer = setInterval(tickHold, 1000);
    if (!bk.open) bk.showModal();
    bk.scrollTop = 0;
    $('bk-t').focus({ preventScroll: true });
  }
  // the reminder leaves the eve at 18 h: no promise for a cut today, nor for tomorrow once 18 h has passed
  function reminderPossible(day) { const n = diffDays(S.today, day); return n > 1 || (n === 1 && S.nowMin < REMINDER_HOUR * 60); }
  function tickHold() {
    const p = $('hold');
    if (!S.hold) { clearInterval(holdTimer); return; }
    const left = Math.round((S.hold.exp - (Date.now() + S.skew)) / 1000);
    if (left <= 0) { p.classList.add('gone'); $('hold-t').textContent = 'Le créneau n’est plus gardé. Confirme vite : il est à toi s’il est encore libre.'; clearInterval(holdTimer); return; }
    p.classList.remove('gone');
    $('hold-t').textContent = 'Créneau gardé pour toi pendant que tu écris';
    $('hold-left').textContent = Math.floor(left / 60) + ':' + pad(left % 60);
  }
  function closeSheet() {
    clearInterval(holdTimer);
    if (bk.open) bk.close();
    if (S.booked) { S.booked = null; }
    else if (S.hold) { Api.release(S.hold.id); S.hold = null; }
    S.sig = '';
    loadAvail();
  }
  function showErr(text) { const p = $('bk-err'); p.hidden = !text; p.textContent = text || ''; }
  function fieldErr(id, text) {
    const inp = $('f-' + id), e = $('e-' + id);
    inp.setAttribute('aria-invalid', String(!!text)); if (!text) inp.removeAttribute('aria-invalid');
    e.hidden = !text; e.textContent = text || '';
    return !text;
  }
  // the same reading as the server's normPhone: a French number, or an international one written with +
  function phoneOk(v) {
    let d = String(v || '').replace(/[^\d+]/g, '');
    if (d.startsWith('00')) d = '+' + d.slice(2);
    if (d.startsWith('+33')) d = '0' + d.slice(3);
    return d.startsWith('+') ? /^\+\d{8,15}$/.test(d) : /^0[1-9]\d{8}$/.test(d);
  }
  async function submit(e) {
    e.preventDefault();
    if (S.sending || !S.hold) return;
    const v = { first: $('f-first').value.trim(), last: $('f-last').value.trim(), phone: $('f-phone').value.trim(), email: $('f-email').value.trim(), note: $('f-note').value.trim() };
    const ok = [
      fieldErr('first', v.first.length < 2 ? 'Écris ton prénom (2 lettres au moins).' : /[:/]/.test(v.first) ? 'Sans « : » ni « / » dans le prénom.' : ''),
      fieldErr('phone', phoneOk(v.phone) ? '' : 'Écris un numéro valide, par exemple 06 12 34 56 78.'),
      fieldErr('email', !v.email || /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.email) ? '' : 'Cette adresse a l’air incomplète. Corrige-la ou laisse vide.')
    ];
    if (ok.includes(false)) { form.querySelector('[aria-invalid="true"]').focus(); return; }
    const h = S.hold, sv = S.svc, go = $('bk-go'), label = go.textContent;
    const sms = !$('f-sms').closest('.sw').hidden && $('f-sms').checked;
    S.sending = true; go.disabled = true; go.textContent = 'Un instant…'; showErr('');
    try {
      const body = { holdId: h.id, serviceIds: [sv.id], staffId: h.staffId, day: h.day, start: h.start, first: v.first, phone: v.phone, sms: $('f-sms').checked, marketing: $('f-mkt').checked };
      if (v.last && !/[:/]/.test(v.last)) body.last = v.last;
      if (v.email) body.email = v.email;
      if (v.note) body.note = v.note;
      const r = await Api.book(body);
      S.booked = { r, day: h.day, start: h.start, staffId: r.staffId || h.staffId, sv, email: v.email, sms };
      S.hold = null; clearInterval(holdTimer);
      showDone();
    } catch (er) {
      if (er.code === 'taken') {
        // back to the planning, formule, day and what was typed all kept
        S.hold = null; clearInterval(holdTimer);
        if (bk.open) bk.close();
        planMsg(er.message || 'Ce créneau vient d’être pris. Choisis-en un autre, tes choix sont gardés.');
        S.sig = ''; await loadAvail();
        toPlanning(true);
      } else showErr(er.message);
    } finally { S.sending = false; go.disabled = false; go.textContent = label; }
  }
  function icsUrl(k) {
    const d = k.day.replace(/-/g, ''), b = barber(k.staffId);
    const st = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
    const esc = (s) => String(s).replace(/\\/g, '\\\\').replace(/,/g, '\\,').replace(/;/g, '\\;');
    const ics = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Barber LArchitecte//Reservation//FR', 'BEGIN:VEVENT',
      'UID:' + k.r.code + '@larchitecte', 'DTSTAMP:' + st, 'DTSTART;TZID=Europe/Paris:' + d + 'T' + hm(k.start) + '00', 'DTEND;TZID=Europe/Paris:' + d + 'T' + hm(k.start + k.sv.dur) + '00',
      'SUMMARY:' + esc('Barber L’Architecte · ' + k.sv.name), 'LOCATION:' + esc(ADDRESS),
      'DESCRIPTION:' + esc((b ? 'Avec ' + b.name + '. ' : '') + 'Code ' + k.r.code + '.' + (k.r.manage ? ' Déplacer ou annuler : ' + k.r.manage : '')),
      ...(k.r.manage ? ['URL:' + k.r.manage] : []), 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
    return URL.createObjectURL(new Blob([ics], { type: 'text/calendar;charset=utf-8' }));
  }
  function showDone() {
    const k = S.booked, r = k.r, b = barber(k.staffId), pending = r.status === 'pending' && r.deposit > 0;
    form.hidden = true; $('bk-done').hidden = false;
    $('bk-t').textContent = S.sim ? 'Mode démo' : pending ? 'Presque fini' : 'Rendez-vous pris';
    $('bk-x').setAttribute('aria-label', 'Fermer');
    $('done-k').textContent = S.sim ? 'Démo terminée.' : pending ? 'Il reste l’acompte.' : 'C’est réservé.';
    $('done-w').textContent = cap(dayLong(k.day)) + ' à ' + fmtH(k.start);
    $('done-s').textContent = k.sv.name + ' · ' + durText(k.sv.dur) + (b ? ' · avec ' + b.name : '') + ' · ' + ADDRESS;
    const pay = $('done-pay'), payBtn = $('done-paybtn');
    pay.hidden = payBtn.hidden = !pending;
    if (pending) {
      pay.textContent = 'Il reste à régler l’acompte de ' + eur(r.deposit) + ' dans les ' + ((S.salon.booking && S.salon.booking.pendingPayMin) || 15) + ' minutes. Sans paiement, le créneau est libéré.';
      if (r.payment && r.payment.url) payBtn.href = r.payment.url; else payBtn.hidden = true;
    }
    const lines = [];
    if (S.sim) lines.push('Mode démo : rien n’a été réservé ni envoyé. Sur le vrai site, tu reçois ta confirmation par SMS.');
    else {
      if (pending) lines.push('Ton rendez-vous est confirmé dès que l’acompte est réglé.');
      else lines.push('Confirmation par SMS' + (k.email ? ' et par e-mail (' + k.email + ').' : '. Pas d’e-mail : tu n’as pas donné d’adresse.'));
      if (k.sms) lines.push('Rappel par SMS la veille à ' + REMINDER_HOUR + ' h, avec le lien pour déplacer ou annuler.');
      if (S.salon.mode === 'demo') lines.push('Démo : aucun SMS ni e-mail ne part vraiment.');
    }
    const ul = $('done-l'); ul.textContent = '';
    lines.forEach((t) => ul.appendChild(el('li', '', t)));
    $('done-ics').href = icsUrl(k);
    const mg = $('done-manage');
    mg.hidden = !r.manage; if (r.manage) mg.href = r.manage;
    const code = $('done-code'); code.textContent = 'Ton code : '; code.appendChild(el('b', '', r.code));
    bk.scrollTop = 0;
    $('bk-t').focus({ preventScroll: true });
    S.sig = ''; loadAvail();
  }

  /* ---------- events ---------- */
  function bootEvents() {
    $('fm-list').addEventListener('change', (e) => { if (e.target.name === 'formule') chooseService(e.target.value, false); });
    $('fm').addEventListener('toggle', () => { if (desk() && !$('fm').open) $('fm').open = true; });
    $('days').addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.shift) {
        S.from = b.dataset.shift === '1' ? addDays(S.from, SPAN) : (addDays(S.from, -SPAN) < S.today ? S.today : addDays(S.from, -SPAN));
        S.day = ''; S.tabTouched = false; $('days').scrollLeft = 0; $('pl').setAttribute('aria-busy', 'true'); loadAvail();
        return;
      }
      S.day = b.dataset.day; S.tabTouched = false; planMsg(''); render();
    });
    $('pl-tabs').addEventListener('click', (e) => { const t = e.target.closest('[data-tab]'); if (!t) return; S.tab = Number(t.dataset.tab); S.tabTouched = true; render(); const n = $('tab-' + S.tab); if (n) n.focus(); });
    $('pl-tabs').addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      e.preventDefault();
      S.tab = (S.tab + (e.key === 'ArrowRight' ? 1 : S.barbers.length - 1)) % S.barbers.length; S.tabTouched = true; render();
      const n = $('tab-' + S.tab); if (n) n.focus();
    });
    $('pl').addEventListener('click', (e) => { const c = e.target.closest('button.pl-c'); if (c) pick(c); });
    $('pl-first').addEventListener('click', goNext);
    $('hero-next').addEventListener('click', (e) => { e.preventDefault(); goNext(); });
    $('team').addEventListener('click', (e) => {
      const b = e.target.closest('.bb-next'); if (!b) return;
      S.tab = Number(b.dataset.tab); S.tabTouched = true;
      if (b.dataset.day && dayData(b.dataset.day)) S.day = b.dataset.day;
      render(); toPlanning(true, true);
    });
    $('carte-list').addEventListener('click', (e) => { const b = e.target.closest('[data-svc]'); if (b) chooseService(b.dataset.svc, true); });
    document.addEventListener('click', (e) => {
      const a = e.target.closest('a[href="#reserver"]'); if (!a || a.id === 'hero-next' || a.classList.contains('skip')) return;
      e.preventDefault(); toPlanning(true);
    });
    form.addEventListener('submit', submit);
    ['first', 'phone', 'email'].forEach((id) => $('f-' + id).addEventListener('input', () => { if ($('f-' + id).hasAttribute('aria-invalid')) fieldErr(id, ''); }));
    $('bk-x').addEventListener('click', closeSheet);
    $('done-close').addEventListener('click', closeSheet);
    bk.addEventListener('cancel', (e) => { e.preventDefault(); closeSheet(); });
    bk.addEventListener('click', (e) => { if (e.target === bk) closeSheet(); });
    document.addEventListener('visibilitychange', () => { if (!document.hidden && S.ready) loadAvail(); });
    setInterval(() => { if (!document.hidden && S.ready && !S.picking && !S.sending) loadAvail(); }, 30000);
    // a hold is released when the page is left, so the chair does not stay hatched for nobody
    window.addEventListener('pagehide', () => { if (S.hold && !S.sim) { try { fetch('/api/public/holds/' + encodeURIComponent(S.hold.id), { method: 'DELETE', keepalive: true }); } catch (e) { /* the hold expires by itself */ } } });
  }
  function goNext() {
    if (S.next) {
      if (S.from !== S.today) { S.from = S.today; S.day = ''; loadAvail(); }
      else { S.day = S.next.day; S.tab = Math.max(0, S.barbers.findIndex((b) => b.id === S.next.bid)); S.tabTouched = true; planMsg(''); render(); }
    }
    toPlanning(true, true);
  }

  /* ---------- boot ---------- */
  async function boot() {
    bootHero();
    bootChrome();
    bootEvents();
    if (!desk()) $('fm').open = false;
    let salon;
    try { salon = await Real.salon(); }
    catch (e) {
      if (e.code !== 'network') { const pl = $('pl'); pl.textContent = ''; pl.removeAttribute('aria-busy'); pl.appendChild(el('p', 'pl-shut', e.message)); return; }
      Api = makeSim(); S.sim = true;
      salon = await Api.salon();
      const b = $('demo-b'); b.hidden = false; b.textContent = 'Mode démo : le salon n’est pas joignable d’ici. Le planning est simulé, rien n’est réservé.';
    }
    S.salon = salon;
    S.services = (salon.services || []).filter((x) => x.online !== false && !x.pack);
    S.barbers = salon.barbers || [];
    S.today = salon.today; S.from = salon.today;
    S.skew = (salon.now || Date.now()) - Date.now();
    S.svc = S.services[0] || null;
    if (salon.hoursText) $('ft-hours').textContent = salon.hoursText + '.' + (salon.closedText ? ' Fermé ' + salon.closedText + '.' : '');
    if (salon.shop && salon.shop.mapsUrl) { $('ft-maps').href = salon.shop.mapsUrl; $('pv-link').href = salon.shop.mapsUrl; }
    renderFormules();
    renderCarte();
    if (salon.booking && salon.booking.enabled === false) {
      const pl = $('pl'); pl.textContent = ''; pl.removeAttribute('aria-busy');
      pl.appendChild(el('p', 'pl-shut', 'La réservation en ligne est momentanément fermée.'));
      return;
    }
    if (!S.svc || !S.barbers.length) return;
    await loadAvail();
  }
  boot();
})();
