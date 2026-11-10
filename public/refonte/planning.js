/* « Le salon en direct » : the page's script (no inline script: the server's CSP is script-src 'self').
   The booking journey is the one clients already know (docs/refonte-conventions.md): prestation → barbier →
   jour et heure → coordonnées → confirmation. What is new sits around it: the live line, the pill, the salon's planning
   as a second view of the time step. They are shortcuts into that journey, never another one.
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
  const MOS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
  const ADDRESS = '16, place Pélabon, 13013 Marseille';
  const REMINDER_HOUR = 18;

  /* ---------- days and hours (the salon's own calendar: 'YYYY-MM-DD' and minutes after midnight) ---------- */
  const utc = (day) => { const p = day.split('-'); return new Date(Date.UTC(+p[0], +p[1] - 1, +p[2])); };
  const addDays = (day, n) => { const d = utc(day); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  const diffDays = (a, b) => Math.round((utc(b) - utc(a)) / 86400000);
  const dow = (day) => utc(day).getUTCDay();
  const hm = (m) => pad(Math.floor(m / 60)) + pad(m % 60);
  // « 14:30 » on the time-slot buttons only (the journey's habit, docs/refonte-conventions.md 4); everywhere else the site's « 14 h 30 »
  const t24 = (m) => pad(Math.floor(m / 60)) + ':' + pad(m % 60);
  const th = (m) => Math.floor(m / 60) + NBSP + 'h' + (m % 60 ? NBSP + pad(m % 60) : '');
  const dayLong = (day) => { const d = utc(day); return WD[d.getUTCDay()] + ' ' + (d.getUTCDate() === 1 ? '1er' : d.getUTCDate()) + ' ' + MO[d.getUTCMonth()]; };
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
  const eur = (cents) => (cents % 100 ? (cents / 100).toFixed(2).replace('.', ',') : String(cents / 100)) + NBSP + '€';
  const durText = (min) => min < 60 ? min + ' min' : Math.floor(min / 60) + ' h' + (min % 60 ? ' ' + pad(min % 60) : '');
  function dayWord(day) {
    const n = diffDays(S.today, day);
    return n === 0 ? 'Aujourd’hui' : n === 1 ? 'Demain' : cap(dayLong(day));
  }

  /* ---------- the booking client: the real API ---------- */
  /** Until how many hours before the client may cancel for free: the salon's own setting (GET /api/public/salon), null when it says none (the sentence is then left out, never guessed). */
  const cancelH = () => { const n = S.salon && S.salon.booking ? S.salon.booking.cancelUntilHours : null; return typeof n === 'number' && n > 0 ? n : null; };
  function ApiError(status, code, message) { this.status = status; this.code = code; this.message = message; }
  /* A slot refused (409): for a moment the next reads of the free slots ask for the journal as it is (&fresh=1), past
     the answer the network keeps 5 s. A hold or a booking carries one id per attempt (x-request-id): when the answer is
     lost on the way, the same request sent again gets the first answer and nothing is booked twice. */
  let freshUntil = 0;
  const RID = {};
  const newRid = () => { try { return window.crypto.randomUUID(); } catch (e) { let s = ''; for (let i = 0; i < 32; i++) s += Math.floor(Math.random() * 16).toString(16); return s; } };
  function netCall(method, path, body) {
    const read = method === 'GET' && path.indexOf('/api/public/availability') === 0 && Date.now() < freshUntil;
    const key = method === 'POST' && (path === '/api/public/holds' || path === '/api/public/bookings') ? path : '';
    const sig = key ? JSON.stringify(body) : '';
    if (key && (!RID[key] || RID[key].sig !== sig)) RID[key] = { sig: sig, id: newRid() };
    return {
      path: read ? path + '&fresh=1' : path, rid: key ? RID[key].id : '',
      // an answer came back, whatever it says: this attempt is over (a network failure keeps its id for the retry)
      done: (status) => { if (key) delete RID[key]; if (status === 409) freshUntil = Date.now() + 15000; }
    };
  }
  async function req(method, path, body) {
    let res;
    const w = netCall(method, path, body);
    try {
      // no-store: the answers allow stale-while-revalidate, and a planning « en direct » must never show a slot someone just took
      res = await fetch(w.path, { method, cache: 'no-store', headers: body ? Object.assign({ 'content-type': 'application/json', accept: 'application/json' }, w.rid ? { 'x-request-id': w.rid } : {}) : { accept: 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    } catch (e) { throw new ApiError(0, 'network', 'Pas de réseau. Vérifie ta connexion et réessaie.'); }
    w.done(res.status);
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
        const who = b.staffId === 'any' ? BB.find((x) => free(b.day, x.id, b.start, sv.dur)) : BB.find((x) => x.id === b.staffId && free(b.day, x.id, b.start, sv.dur));
        if (!who) return Promise.reject(new ApiError(409, 'taken', 'Ce créneau vient d’être pris.'));
        return wait({ holdId: 'sim_h' + Date.now(), staffId: who.id, exp: Date.now() + 5 * 60000 });
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
    sim: false, salon: null, services: [], barbers: [], today: '', nowMin: 0, open: false, skew: 0,
    step: 'svc', /* svc → staff → slot → form → done */
    svc: null, staff: null, /* null, 'any' (« Peu importe ») or a barber's id */
    view: 'list', /* the time step: 'list' (default) or 'plan' (the salon's planning) */
    pre: { staff: false, slot: null }, /* what a shortcut filled in advance */
    from: '', day: '', dayPicked: false, tab: 0, days: [], /* [{ day, open, by: { staffId: Set(min) } }] */
    hold: null, /* { id, staffId, day, start, exp } */
    seq: 0, sig: '', next: null, booked: null, ready: false
  };
  const STEPS = ['svc', 'staff', 'slot', 'form'];
  // before a prestation is chosen, the live line and the barbers' next slots are read for the first one of the carte
  const calcSvc = () => S.svc || S.services[0];
  const SPAN = 14;
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

  /* ---------- top bar, Sommaire, sticky « Réserver » and the journey's bottom bar ---------- */
  const tb = $('tb'), menu = $('menu'), menuBtn = $('menu-btn'), cta = $('cta'), bar = $('bar');
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
    const rs = $('bw').getBoundingClientRect(), ft = $('venir').getBoundingClientRect();
    // inside the journey the page's « Réserver » gives way to the journey's own bar (recap + the one main button)
    const inPlan = rs.top < vh * 0.62 && rs.bottom > vh * 0.38;
    cta.classList.toggle('off', inPlan || ft.top < vh * 0.6 || !menu.hidden);
    bar.classList.toggle('show', inPlan && menu.hidden && S.step !== 'done' && S.ready);
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
  const calm = () => window.matchMedia('(prefers-reduced-motion:reduce)').matches;
  function toJourney(focus) {
    const y = $('bw').getBoundingClientRect().top + window.scrollY - (desk() ? 100 : 84);
    window.scrollTo({ top: Math.max(0, y), behavior: calm() ? 'auto' : 'smooth' });
    if (focus) { const h = $('st-' + S.step).querySelector('.stp-h,.done-k'); if (h) h.focus({ preventScroll: true }); }
  }

  /* ---------- the journey: prestation → barbier → jour et heure → coordonnées → confirmation ---------- */
  const TITLES = { svc: 'Prestation', staff: 'Barbier', slot: 'Jour et heure', form: 'Coordonnées' };
  function depositOf(sv) {
    const d = S.salon.deposits;
    if (S.sim || (S.salon.payments && S.salon.payments.live === false)) return 0;
    if (typeof sv.deposit === 'number') return Math.min(sv.price, sv.deposit);
    if (!d || d.mode === 'none' || (d.mode === 'threshold' && sv.price < d.thresholdCents)) return 0;
    return Math.min(sv.price, Math.max(500, Math.round((sv.price * d.percent) / 100 / 100) * 100));
  }
  function priceText(sv) { return (sv.from ? 'dès ' : '') + eur(sv.price); }
  function msg(text) { const p = $('bw-msg'); p.hidden = !text; p.textContent = text || ''; }

  function go(step, keepMsg) {
    S.step = step;
    if (!keepMsg) msg('');
    if (step === 'slot') fixDay();
    S.sig = '';
    renderJourney();
    onScroll();
    toJourney(true);
  }
  function back() {
    S.pre = { staff: false, slot: null };
    const i = STEPS.indexOf(S.step);
    if (i > 0) { go(STEPS[i - 1]); return; }
    // first step: Retour leaves the journey, back to the top of the page
    window.scrollTo({ top: 0, behavior: calm() ? 'auto' : 'smooth' });
    const w = document.querySelector('.wm'); if (w) w.focus({ preventScroll: true });
  }
  // after step i is answered: the next step, past the ones a shortcut already filled
  function nextFrom(i) {
    if (i === 0 && !(S.pre.staff && S.staff)) { go('staff'); return; }
    S.pre.staff = false;
    if (S.pre.slot) { autoHold(); return; }
    go('slot');
  }
  function mainAction() {
    if (S.picking || S.sending) return;
    if (S.step === 'svc' && S.svc) nextFrom(0);
    else if (S.step === 'staff' && S.staff) nextFrom(1);
    else if (S.step === 'slot' && S.hold) go('form');
    else if (S.step === 'form') submit();
  }
  function setSvc(sv) {
    if (S.svc && S.svc.id === sv.id) return;
    dropHold();
    S.svc = sv; S.sig = '';
    $('tm').setAttribute('aria-busy', 'true');
    loadAvail();
  }
  function setStaff(id) {
    if (S.staff === id) return;
    dropHold();
    S.staff = id; S.sig = '';
    if (id !== 'any') { S.tab = Math.max(0, S.barbers.findIndex((b) => b.id === id)); S.tabTouched = true; }
  }
  // a shortcut (hero pill, live line, a barber's card, the carte) fills steps of the same journey, then lands on the first empty one
  function prefill(p) {
    S.pre = { staff: false, slot: null };
    if (S.step === 'done') resetJourney();
    if (p.svc) setSvc(p.svc);
    if (p.staff) { setStaff(p.staff); S.pre.staff = true; }
    if (p.slot) { if (S.hold && (S.hold.day !== p.slot.day || S.hold.start !== p.slot.m)) dropHold(); S.pre.slot = p.slot; }
    if (!S.svc) go('svc');
    else if (!S.staff) go('staff');
    else if (S.pre.slot) { S.pre.staff = false; autoHold(); }
    else go(S.hold ? 'form' : 'slot');
  }
  async function autoHold() {
    const w = S.pre.slot; S.pre.slot = null;
    if (S.hold && S.hold.day === w.day && S.hold.start === w.m) { go('form'); return; }
    S.picking = true; setGo();
    try {
      await holdSlot(w.day, w.m, S.staff);
      go('form');
      loadAvail();
    } catch (e) {
      if (!dayData(w.day)) S.from = S.today;
      S.day = w.day; S.dayPicked = true;
      go('slot');
      msg(e.code === 'taken' ? 'Ce créneau n’est pas libre pour cette prestation. Choisis une autre heure : ta prestation et ton barbier sont gardés.' : e.message);
      await loadAvail();
    } finally { S.picking = false; setGo(); }
  }
  function resetJourney() {
    S.booked = null; S.hold = null; clearInterval(holdTimer);
    S.svc = null; S.staff = null; S.step = 'svc'; S.dayPicked = false; S.pre = { staff: false, slot: null };
    S.sig = '';
    loadAvail();
  }

  function renderJourney() {
    const done = S.step === 'done', i = STEPS.indexOf(S.step);
    ['svc', 'staff', 'slot', 'form', 'done'].forEach((k) => { $('st-' + k).hidden = k !== S.step; });
    $('bw-nav').hidden = done;
    $('bw').classList.toggle('is-done', done);
    if (!done) {
      $('bw-step').textContent = 'Étape ' + (i + 1) + ' sur 4';
      $('bw-step').appendChild(el('span', '', TITLES[S.step]));
      $('bw-prog').style.width = ((i + 1) * 25) + '%';
      $('bw-back').setAttribute('aria-label', i ? 'Retour à l’étape ' + i + ' : ' + TITLES[STEPS[i - 1]].toLowerCase() : 'Retour en haut de la page');
    }
    if (S.step === 'svc') renderSvc();
    if (S.step === 'staff') renderStaff();
    if (S.step === 'slot') renderSlot();
    if (S.step === 'form') renderForm();
    renderRecap();
  }

  /* step 1: la prestation (price and duration before the choice) */
  function optBtn(cls, on) { const b = el('button', 'op ' + cls + (on ? ' on' : '')); b.type = 'button'; b.setAttribute('aria-pressed', String(!!on)); return b; }
  function renderSvc() {
    const list = $('svc-list');
    list.textContent = '';
    let cat = '', box = null;
    S.services.forEach((sv) => {
      if (sv.category !== cat || !box) {
        cat = sv.category;
        list.appendChild(el('h4', 'op-cat', cat));
        box = el('div', 'op-g'); list.appendChild(box);
      }
      const b = optBtn('op-s', S.svc && S.svc.id === sv.id); b.dataset.svc = sv.id;
      const dep = depositOf(sv);
      const name = el('span', 'op-n', sv.name); name.appendChild(el('small', '', durText(sv.dur) + (dep > 0 ? ' · acompte ' + eur(dep) : '')));
      const price = el('span', 'op-p'); if (sv.from) price.appendChild(el('small', '', 'dès')); price.appendChild(document.createTextNode(eur(sv.price)));
      b.append(name, price);
      box.appendChild(b);
    });
  }

  /* step 2: le barbier, « Peu importe » first */
  function nextOf(bid) {
    for (const d of S.days) { let best = null; d.by[bid].forEach((m) => { if (best == null || m < best) best = m; }); if (best != null) return { day: d.day, m: best }; }
    return null;
  }
  const shortDay = (day) => dayWord(day).replace(/^(\S+) (\S+) (\S{3})\S*$/, '$1 $2 $3.');
  function renderStaff() {
    const list = $('staff-list');
    const act = document.activeElement, refocus = act && act.dataset && act.dataset.staff && list.contains(act) ? act.dataset.staff : null;
    list.textContent = '';
    const box = el('div', 'op-g'); list.appendChild(box);
    const any = optBtn('op-b', S.staff === 'any'); any.dataset.staff = 'any';
    const am = el('span', 'pl-mono', '?'); am.setAttribute('aria-hidden', 'true');
    const an = el('span', 'op-n', 'Peu importe'); an.appendChild(el('small', '', 'Le premier barbier libre'));
    any.append(am, an);
    box.appendChild(any);
    S.barbers.forEach((b) => {
      const o = optBtn('op-b', S.staff === b.id); o.dataset.staff = b.id;
      const mono = el('span', 'pl-mono', b.initials || b.name.charAt(0)); mono.setAttribute('aria-hidden', 'true');
      const n = S.days.length ? nextOf(b.id) : null;
      const name = el('span', 'op-n', b.name);
      name.appendChild(el('small', n ? 'has' : '', n ? 'Prochain créneau : ' + shortDay(n.day).toLowerCase() + ' à ' + th(n.m) : (b.away && b.away.note) || (S.days.length ? 'Complet sur ces deux semaines' : '')));
      o.append(mono, name);
      box.appendChild(o);
    });
    if (refocus) { const again = list.querySelector('[data-staff="' + refocus + '"]'); if (again) again.focus({ preventScroll: true }); }
  }

  /* step 3: le jour et l'heure. The list is the default; the salon's planning is the other view of the same slots */
  async function loadAvail() {
    const svc = calcSvc();
    if (!svc || !S.barbers.length) return;
    const seq = ++S.seq, from = S.from;
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
        for (const d of days) { let best = null; for (const b of S.barbers) for (const m of d.by[b.id]) if (best == null || m < best) best = m; if (best != null) { S.next = { day: d.day, m: best, n: S.barbers.filter((b) => d.by[b.id].has(best)).length }; break; } }
      }
      if (!S.day || !dayData(S.day)) { S.day = ''; S.dayPicked = false; }
      fixDay();
      S.ready = true;
      setLive(true);
      render();
      onScroll();
    } catch (e) {
      if (seq !== S.seq) return;
      setLive(false);
      if (!S.ready) { const t = $('svc-list'); t.textContent = ''; const p = el('p', 'pl-shut', 'Le planning ne répond pas.'); p.appendChild(el('small', '', e.message || 'Réessaie dans un instant.')); t.appendChild(p); }
    }
  }
  function setLive(ok) {
    const p = $('pl-live'), d = new Date();
    p.classList.toggle('off', !ok);
    p.lastElementChild.textContent = ok ? 'En direct · ' + th(d.getHours() * 60 + d.getMinutes()) : 'Connexion perdue · nouvel essai…';
  }
  // the list answers for the chosen barber (or all of them for « Peu importe »), the planning always shows the four chairs
  const scopeStaff = () => (S.view === 'plan' || !S.staff || S.staff === 'any' ? null : S.staff);
  function timesOf(d) {
    if (!d) return [];
    const sid = scopeStaff(), set = new Set();
    (sid ? [sid] : S.barbers.map((b) => b.id)).forEach((id) => { if (d.by[id]) d.by[id].forEach((m) => set.add(m)); });
    return [...set].sort((a, b) => a - b);
  }
  function nextFreeDay(after) { return S.days.find((d) => d.day > after && timesOf(d).length > 0) || null; }
  // unless the client picked a day, stand on the first one that has room
  function fixDay() {
    if (!S.days.length) return;
    if (S.hold && dayData(S.hold.day) && !S.dayPicked) { S.day = S.hold.day; return; }
    if (S.day && dayData(S.day) && (S.dayPicked || timesOf(dayData(S.day)).length)) return;
    const first = S.days.find((d) => timesOf(d).length > 0) || S.days.find((d) => d.open) || S.days[0];
    S.day = first.day;
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

  // what the poll refreshes: the live bits around the journey, and the step on screen if its data changed
  function render() {
    renderStatus();
    renderTeam();
    if (S.step === 'staff') renderStaff();
    if (S.step === 'slot') renderSlot();
    renderRecap();
  }
  function renderSlot() {
    const d = dayData(S.day);
    if (!d) return; // the days are still loading: the step shows its « Chargement » line
    const sig = JSON.stringify([calcSvc().id, S.staff, S.view, S.from, S.day, S.tab, S.hold && [S.hold.staffId, S.hold.day, S.hold.start], S.today, Math.floor(S.nowMin / 30), S.days.map((x) => [x.open, S.barbers.map((b) => [...x.by[b.id]])])]);
    if (sig === S.sig) return;
    S.sig = sig;
    $('vw-list').setAttribute('aria-pressed', String(S.view === 'list'));
    $('vw-plan').setAttribute('aria-pressed', String(S.view === 'plan'));
    renderDays();
    const title = $('pl-day'), who = S.staff && S.staff !== 'any' && S.view === 'list' ? barber(S.staff) : null;
    title.textContent = cap(dayLong(S.day));
    title.appendChild(el('small', '', S.view === 'plan' ? 'Les quatre fauteuils' : who ? 'Avec ' + who.name : 'Tous les barbiers'));
    const times = timesOf(d), none = $('sl-none');
    none.textContent = '';
    none.hidden = times.length > 0 || !S.days.length;
    if (!none.hidden) {
      none.appendChild(el('p', '', !d || !d.open ? 'Le salon est fermé ce jour-là.' : who ? 'Complet ce jour-là avec ' + who.name + '.' : 'Complet ce jour-là.'));
      const nx = nextFreeDay(S.day) || S.days.find((x) => timesOf(x).length > 0);
      const b = el('button', 'btn small'); b.type = 'button';
      if (nx) { b.dataset.day = nx.day; b.textContent = 'Prochain jour libre : ' + dayLong(nx.day); }
      else { b.dataset.shift = '1'; b.textContent = 'Voir les dates suivantes'; }
      none.appendChild(b);
    }
    $('tm').hidden = S.view !== 'list';
    $('plw').hidden = S.view !== 'plan';
    if (S.view === 'list') renderTimes(d, times); else renderPlan(d);
  }
  function renderDays() {
    const box = $('days'), keep = box.scrollLeft;
    const act = document.activeElement, refocus = act && box.contains(act) ? act.dataset.day : null;
    box.textContent = '';
    if (S.from > S.today) { const b = el('button', 'ds-more', 'Dates d’avant'); b.type = 'button'; b.dataset.shift = '-1'; box.appendChild(b); }
    S.days.forEach((d) => {
      const n = timesOf(d).length, b = el('button', 'ds-d' + (!d.open ? ' shut' : n ? '' : ' full'));
      b.type = 'button'; b.dataset.day = d.day;
      if (!d.open) b.disabled = true;
      b.setAttribute('aria-pressed', String(d.day === S.day));
      b.setAttribute('aria-label', cap(dayLong(d.day)) + (!d.open ? ', fermé' : n ? '' : ', complet'));
      b.append(el('span', 'ds-w1', d.day === S.today ? 'auj.' : WDS[dow(d.day)]), el('span', 'ds-n', String(utc(d.day).getUTCDate())), el('span', 'ds-f', !d.open ? 'fermé' : n ? MOS[utc(d.day).getUTCMonth()] : 'complet'));
      box.appendChild(b);
    });
    const max = (S.salon.booking && S.salon.booking.maxDaysAhead) || 60;
    if (diffDays(S.today, addDays(S.from, SPAN)) <= max) { const b = el('button', 'ds-more', 'Dates suivantes'); b.type = 'button'; b.dataset.shift = '1'; box.appendChild(b); }
    box.scrollLeft = keep;
    if (refocus) { const again = box.querySelector('[data-day="' + refocus + '"]'); if (again) again.focus({ preventScroll: true }); }
  }
  const isMine = (m) => !!(S.hold && S.hold.day === S.day && S.hold.start === m);
  function renderTimes(d, times) {
    const tm = $('tm');
    const act = document.activeElement, refocus = act && tm.contains(act) ? act.dataset.m : null;
    tm.textContent = '';
    tm.removeAttribute('aria-busy');
    if (!S.days.length) { tm.appendChild(el('p', 'pl-wait', 'Chargement des créneaux…')); return; }
    [['Matin', times.filter((m) => m < 720)], ['Après-midi', times.filter((m) => m >= 720)]].forEach((g) => {
      if (!g[1].length) return;
      const id = 'tm-' + (g[0] === 'Matin' ? 'am' : 'pm');
      const h = el('h5', 'tm-h', g[0]); h.id = id;
      const box = el('div', 'tm-g'); box.setAttribute('role', 'group'); box.setAttribute('aria-labelledby', id);
      g[1].forEach((m) => {
        const mine = isMine(m);
        const b = el('button', 'tm-b' + (mine ? ' mine' : ''), t24(m)); b.type = 'button'; b.dataset.m = String(m);
        b.setAttribute('aria-pressed', String(mine));
        b.setAttribute('aria-label', t24(m) + ', ' + dayLong(S.day) + (mine ? ', ton créneau' : ''));
        box.appendChild(b);
      });
      tm.append(h, box);
    });
    if (refocus) { const again = tm.querySelector('[data-m="' + refocus + '"]'); if (again) again.focus({ preventScroll: true }); }
  }
  function renderPlan(d) {
    const pl = $('pl'), tabs = $('pl-tabs');
    const act = document.activeElement, refocus = act && act.classList && act.classList.contains('pl-c') ? [act.dataset.b, act.dataset.m] : null;
    pl.textContent = ''; tabs.textContent = '';
    if (!d || !d.open) { tabs.hidden = true; pl.hidden = true; return; }
    tabs.hidden = false; pl.hidden = false;
    const rows = rowsOf(S.day), total = freeCount(d);
    const half = Math.ceil(rows.length / 2);
    // on a phone, open the first chair that has room rather than a full one
    if (!freeCount(d, S.barbers[S.tab].id) && total && !S.tabTouched) S.tab = Math.max(0, S.barbers.findIndex((b) => freeCount(d, b.id) > 0));
    const times = el('div', 'pl-times'); times.setAttribute('aria-hidden', 'true');
    rows.forEach((m) => times.appendChild(el('span', m % 60 ? 'half' : '', th(m))));
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
        const cov = h && h.staffId === b.id && m > h.start && m < h.start + calcSvc().dur;
        let c;
        if (d.by[b.id].has(m) || mine) {
          c = el('button', 'pl-c' + (mine ? ' mine' : '')); c.type = 'button'; c.dataset.b = b.id; c.dataset.m = String(m);
          c.setAttribute('aria-label', t24(m) + ' avec ' + b.name + ', ' + dayLong(S.day) + (mine ? ', ton créneau' : ', libre'));
          c.appendChild(el('span', '', t24(m)));
        } else {
          c = el('div', 'pl-c ' + (cov ? 'cov' : 'busy' + (S.day === S.today && m < S.nowMin ? ' past' : '')));
          c.setAttribute('aria-hidden', 'true');
          if (!cov) c.appendChild(el('span', '', t24(m)));
        }
        cells.appendChild(c);
      });
      col.append(hd, cells);
      pl.appendChild(col);
    });
    if (refocus) { const again = pl.querySelector('button.pl-c[data-b="' + refocus[0] + '"][data-m="' + refocus[1] + '"]'); if (again) again.focus({ preventScroll: true }); }
  }

  /* ---------- around the journey: the live line, the pill, the team ---------- */
  function renderStatus() {
    let text; const open = S.open;
    const t = dayData(S.today), nx = S.next;
    if (open) {
      if (nx && nx.day === S.today) text = 'Ouvert · ' + nx.n + (nx.n > 1 ? ' fauteuils libres' : ' fauteuil libre') + ' à ' + th(nx.m);
      else text = t || nx ? 'Ouvert · complet en ligne aujourd’hui' : 'Ouvert';
    } else text = nx ? 'Fermé · prochain créneau ' + dayWord(nx.day).toLowerCase() + ' à ' + th(nx.m) : 'Fermé · ' + (S.salon.hoursText || '');
    document.querySelectorAll('[data-live-st]').forEach((p) => { p.classList.toggle('open', open); p.lastElementChild.textContent = text; });
    $('hero-live').setAttribute('aria-label', text + (nx ? '. Réserver ce créneau' : '. Prendre rendez-vous'));
    $('hero-next-v').textContent = nx ? shortDay(nx.day) + ' · ' + th(nx.m) : 'Prendre rendez-vous';
  }
  function renderTeam() {
    const ul = $('team');
    const key = S.barbers.map((b) => { const n = nextOf(b.id); return n ? n.day + n.m : '-'; }).join('|');
    if (ul.dataset.k === key) return;
    ul.dataset.k = key;
    ul.textContent = '';
    S.barbers.forEach((b) => {
      const li = el('li', 'bb-i');
      const mono = el('span', 'bb-mono', b.initials || b.name.charAt(0)); mono.setAttribute('aria-hidden', 'true');
      li.append(mono, el('h3', 'bb-n', b.name));
      if (b.bio) li.appendChild(el('p', 'bb-bio', b.bio));
      const n = nextOf(b.id);
      const goB = el('button', 'bb-next' + (n ? '' : ' none')); goB.type = 'button'; goB.dataset.staff = b.id; if (n) { goB.dataset.day = n.day; goB.dataset.m = String(n.m); }
      goB.append(el('i'), document.createTextNode(n ? shortDay(n.day) + ' · ' + th(n.m) : (b.away && b.away.note) || 'Réserver avec ' + b.name));
      goB.firstChild.setAttribute('aria-hidden', 'true');
      goB.setAttribute('aria-label', n ? 'Réserver avec ' + b.name + ', prochain créneau ' + dayWord(n.day).toLowerCase() + ' à ' + th(n.m) : 'Réserver avec ' + b.name);
      const w = el('p', 'bb-go'); w.appendChild(goB); li.appendChild(w);
      ul.appendChild(li);
    });
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
      if (it.online && sv) { const b = el('button', 'btn small ghost cr-go', 'Réserver'); b.type = 'button'; b.dataset.svc = sv.id; b.setAttribute('aria-label', 'Réserver : ' + it.name); row.appendChild(b); }
      box.appendChild(row);
    });
    if (S.services.length) { const min = Math.min.apply(null, S.services.map((x) => x.price)); $('cta-sub').textContent = 'dès ' + eur(min); }
  }

  /* ---------- the recap (side panel on a desk, bottom bar on a phone) and the one main button ---------- */
  function whenText(h) { return cap(WDS[dow(h.day)]) + ' ' + utc(h.day).getUTCDate() + ' ' + MO[utc(h.day).getUTCMonth()] + ' à ' + th(h.start); }
  function staffText() {
    if (!S.staff) return '';
    if (S.staff !== 'any') return barber(S.staff).name;
    const b = S.hold && barber(S.hold.staffId);
    return b ? b.name + ' (peu importe)' : 'Peu importe';
  }
  function renderRecap() {
    const sv = S.booked ? S.booked.sv : S.svc, h = S.booked ? { day: S.booked.day, start: S.booked.start } : S.hold;
    const who = S.booked ? (barber(S.booked.staffId) || {}).name || '' : staffText();
    const set = (id, v, dash) => { const n = $(id); n.textContent = v || dash || 'À choisir'; n.classList.toggle('todo', !v); };
    set('rc-svc', sv && sv.name);
    set('rc-staff', who);
    set('rc-when', h && whenText(h));
    set('rc-dur', sv && durText(sv.dur), '–');
    set('rc-total', sv && priceText(sv), '–');
    $('bar-a').textContent = sv ? sv.name : 'Ton rendez-vous';
    const bits = [who, h ? whenText(h) : '', sv ? durText(sv.dur) : ''].filter(Boolean);
    $('bar-b').textContent = bits.length ? bits.join(' · ') : 'Choisis ta prestation';
    $('bar-p').textContent = sv ? priceText(sv) : '';
    setGo();
  }
  function setGo() {
    const sv = S.svc, dep = sv ? depositOf(sv) : 0, form = S.step === 'form';
    const ok = S.step === 'svc' ? !!sv : S.step === 'staff' ? !!S.staff : S.step === 'slot' ? !!S.hold : form;
    const label = S.sending || S.picking ? 'Un instant…' : !form ? 'Continuer' : dep > 0 ? 'Confirmer et régler l’acompte · ' + eur(dep) : 'Confirmer le rendez-vous · ' + priceText(sv);
    const note = form ? (dep > 0 ? 'Total ' + priceText(sv) + ', dont ' + eur(dep) + ' d’acompte en ligne.' : 'À régler au salon.') : '';
    document.querySelectorAll('.js-go').forEach((b) => { b.textContent = label; b.disabled = !ok || !!S.sending || !!S.picking; b.hidden = S.step === 'done'; });
    document.querySelectorAll('.js-note').forEach((p) => { p.hidden = !note; p.textContent = note; });
  }

  /* ---------- holding a slot (before the form), then the coordonnées ---------- */
  const form = $('bk-form');
  let holdTimer = 0;
  function dropHold() {
    if (S.hold) { Api.release(S.hold.id); S.hold = null; }
    clearInterval(holdTimer);
  }
  async function holdSlot(day, m, staffId) {
    const r = await Api.hold({ serviceIds: [S.svc.id], staffId, day, start: m, ...(S.hold ? { replace: S.hold.id } : {}) });
    S.hold = { id: r.holdId, staffId: r.staffId || staffId, day, start: m, exp: r.exp };
    S.day = day;
    clearInterval(holdTimer); holdTimer = setInterval(tickHold, 1000);
  }
  // a time in the list and a free cell of the planning do the same thing: hold the slot, then the coordonnées
  async function pick(btn, m, staffId) {
    if (S.picking) return;
    const day = S.day;
    if (S.hold && S.hold.day === day && S.hold.start === m && (staffId === 'any' || S.hold.staffId === staffId)) { if (staffId !== 'any') S.staff = staffId; go('form'); return; }
    S.picking = true; btn.setAttribute('aria-busy', 'true'); setGo();
    msg('');
    try {
      await holdSlot(day, m, staffId);
      if (staffId !== 'any') setStaffQuiet(staffId);
      S.picking = false;
      go('form');
      loadAvail();
    } catch (e) {
      btn.removeAttribute('aria-busy');
      S.picking = false;
      if (e.code === 'taken') { msg('Ce créneau vient d’être pris. Choisis une autre heure : ta prestation et ton barbier sont gardés.'); S.sig = ''; await loadAvail(); $('pl-day').focus({ preventScroll: true }); }
      else msg(e.message);
      setGo();
    }
  }
  function setStaffQuiet(id) { S.staff = id; S.tab = Math.max(0, S.barbers.findIndex((b) => b.id === id)); S.tabTouched = true; }
  // the reminder leaves the eve at 18 h: no promise for a cut today, nor for tomorrow once 18 h has passed
  function reminderPossible(day) { const n = diffDays(S.today, day); return n > 1 || (n === 1 && S.nowMin < REMINDER_HOUR * 60); }
  function renderForm() {
    const sv = S.svc, h = S.hold;
    const dep = depositOf(sv), hours = cancelH();
    $('dep').hidden = !(dep > 0);
    $('dep').textContent = dep > 0 ? 'Un acompte de ' + eur(dep) + ' est demandé pour cette prestation, déduit au salon.' + (hours ? ' Annulé plus de ' + hours + NBSP + 'h avant, il est remboursé.' : '') : '';
    const terms = $('bk-terms');
    terms.hidden = !(dep > 0);
    if (dep > 0 && !terms.firstChild) { terms.append(hours ? 'En réservant, tu acceptes les conditions d’annulation : gratuite jusqu’à ' + hours + NBSP + 'h avant, ensuite l’acompte reste au salon. ' : 'En réservant, tu acceptes les conditions d’annulation du salon. '); const a = el('a', '', 'Voir les CGV'); a.href = '/cgv'; a.target = '_blank'; a.rel = 'noopener'; terms.appendChild(a); }
    const demo = $('bk-demo');
    demo.hidden = !(S.sim || S.salon.mode === 'demo');
    demo.textContent = S.sim ? 'Mode démo : le salon n’est pas joignable d’ici. Rien n’est réservé ni envoyé.' : 'Démo : n’entre pas tes vraies coordonnées, tout est visible. Aucun SMS n’est envoyé, aucun paiement n’est débité.';
    // confirmation and reminder are service messages, on by default; no reminder is promised for a cut today
    $('sms-i').textContent = 'On t’envoie la confirmation par SMS' + (h && reminderPossible(h.day) ? ', et un rappel la veille à ' + REMINDER_HOUR + ' h.' : '.');
    showErr('');
    tickHold();
  }
  function tickHold() {
    const p = $('hold');
    if (!S.hold) { clearInterval(holdTimer); return; }
    const left = Math.round((S.hold.exp - (Date.now() + S.skew)) / 1000);
    if (left <= 0) { p.classList.add('gone'); $('hold-t').textContent = 'Le créneau n’est plus gardé. Confirme vite : il est à toi s’il est encore libre.'; clearInterval(holdTimer); return; }
    p.classList.remove('gone');
    $('hold-t').textContent = 'Créneau gardé pour toi pendant que tu écris';
    $('hold-left').textContent = Math.floor(left / 60) + ':' + pad(left % 60);
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
    if (e) e.preventDefault();
    if (S.sending || !S.hold || S.step !== 'form') return;
    const v = { first: $('f-first').value.trim(), phone: $('f-phone').value.trim(), email: $('f-email').value.trim(), note: $('f-note').value.trim() };
    const ok = [
      fieldErr('first', v.first.length < 2 ? 'Écris ton prénom (2 lettres au moins).' : /[:/]/.test(v.first) ? 'Sans « : » ni « / » dans le prénom.' : ''),
      fieldErr('phone', phoneOk(v.phone) ? '' : 'Écris un numéro valide, par exemple 06 12 34 56 78.'),
      fieldErr('email', !v.email || /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.email) ? '' : 'Cette adresse a l’air incomplète. Corrige-la ou laisse vide.')
    ];
    if (ok.includes(false)) { const bad = form.querySelector('[aria-invalid="true"]'); bad.focus(); bad.scrollIntoView({ block: 'center', behavior: calm() ? 'auto' : 'smooth' }); return; }
    const h = S.hold, sv = S.svc;
    const sms = !$('f-nosms').checked;
    S.sending = true; setGo(); showErr('');
    try {
      const body = { holdId: h.id, serviceIds: [sv.id], staffId: h.staffId, day: h.day, start: h.start, first: v.first, phone: v.phone, sms, marketing: $('f-mkt').checked };
      if (v.email) body.email = v.email;
      if (v.note) body.note = v.note;
      const r = await Api.book(body);
      S.booked = { r, day: h.day, start: h.start, staffId: r.staffId || h.staffId, sv, email: v.email, sms, reminder: sms && reminderPossible(h.day) };
      S.hold = null; clearInterval(holdTimer);
      S.sending = false;
      showDone();
    } catch (er) {
      S.sending = false;
      if (er.code === 'taken') {
        // back to the time step: prestation, barbier, day and what was typed are all kept
        S.hold = null; clearInterval(holdTimer);
        S.day = h.day; S.dayPicked = true;
        go('slot');
        msg('Ce créneau vient d’être pris. Choisis une autre heure : ta prestation, ton barbier et tes coordonnées sont gardés.');
        await loadAvail();
      } else { showErr(er.message); $('bk-err').scrollIntoView({ block: 'center', behavior: calm() ? 'auto' : 'smooth' }); }
      setGo();
    }
  }
  function icsUrl(k) {
    const d = k.day.replace(/-/g, ''), b = barber(k.staffId);
    const st = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
    const esc = (s) => String(s).replace(/\\/g, '\\\\').replace(/,/g, '\\,').replace(/;/g, '\;');
    const ics = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Barber LArchitecte//Reservation//FR', 'BEGIN:VEVENT',
      'UID:' + k.r.code + '@larchitecte', 'DTSTAMP:' + st, 'DTSTART;TZID=Europe/Paris:' + d + 'T' + hm(k.start) + '00', 'DTEND;TZID=Europe/Paris:' + d + 'T' + hm(k.start + k.sv.dur) + '00',
      'SUMMARY:' + esc('Barber L’Architecte · ' + k.sv.name), 'LOCATION:' + esc(ADDRESS),
      'DESCRIPTION:' + esc((b ? 'Avec ' + b.name + '. ' : '') + 'Code ' + k.r.code + '.' + (k.r.manage ? ' Déplacer ou annuler : ' + k.r.manage : '')),
      ...(k.r.manage ? ['URL:' + k.r.manage] : []), 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
    return URL.createObjectURL(new Blob([ics], { type: 'text/calendar;charset=utf-8' }));
  }
  /* the confirmation: quoi, avec qui, quand, où; the agenda; the link to move or cancel; what happens next */
  function showDone() {
    const k = S.booked, r = k.r, b = barber(k.staffId), pending = r.status === 'pending' && r.deposit > 0;
    $('done-k').textContent = S.sim ? 'Démo terminée.' : pending ? 'Il reste l’acompte.' : 'C’est réservé.';
    $('done-what').textContent = k.sv.name + ' · ' + durText(k.sv.dur) + ' · ' + priceText(k.sv);
    $('done-who').textContent = b ? b.name : 'Le salon';
    $('done-when').textContent = cap(dayLong(k.day)) + ' à ' + th(k.start);
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
      else if (k.sms) lines.push('Confirmation par SMS' + (k.email ? ' et par e-mail (' + k.email + ').' : '. Pas d’e-mail : tu n’as pas donné d’adresse.'));
      else lines.push(k.email ? 'Confirmation par e-mail (' + k.email + '). Pas de SMS, comme tu l’as demandé.' : 'Pas de SMS ni d’e-mail, comme tu l’as demandé : garde ton code et le lien pour déplacer ou annuler.');
      if (k.reminder) lines.push('Rappel par SMS la veille à ' + REMINDER_HOUR + ' h, avec le lien pour déplacer ou annuler.');
      if (S.salon.mode === 'demo') lines.push('Démo : aucun SMS ni e-mail ne part vraiment.');
    }
    const ul = $('done-l'); ul.textContent = '';
    lines.forEach((t) => ul.appendChild(el('li', '', t)));
    $('done-ics').href = icsUrl(k);
    const mg = $('done-manage');
    mg.hidden = !r.manage; if (r.manage) mg.href = r.manage;
    const code = $('done-code'); code.textContent = 'Ton code : '; code.appendChild(el('b', '', r.code));
    go('done');
    loadAvail();
  }

  /* ---------- events ---------- */
  function bootEvents() {
    $('bw-back').addEventListener('click', back);
    document.querySelectorAll('.js-go').forEach((b) => b.addEventListener('click', mainAction));
    $('svc-list').addEventListener('click', (e) => {
      const b = e.target.closest('[data-svc]'); if (!b || S.picking) return;
      const sv = S.services.find((x) => x.id === b.dataset.svc); if (!sv) return;
      setSvc(sv); nextFrom(0);
    });
    $('staff-list').addEventListener('click', (e) => {
      const b = e.target.closest('[data-staff]'); if (!b || S.picking) return;
      setStaff(b.dataset.staff); S.pre.staff = false; nextFrom(1);
    });
    document.querySelector('.vw').addEventListener('click', (e) => {
      const b = e.target.closest('[data-view]'); if (!b || S.view === b.dataset.view) return;
      S.view = b.dataset.view; S.sig = ''; renderSlot();
    });
    const onDay = (e) => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.shift) {
        S.from = b.dataset.shift === '1' ? addDays(S.from, SPAN) : (addDays(S.from, -SPAN) < S.today ? S.today : addDays(S.from, -SPAN));
        S.day = ''; S.dayPicked = false; S.tabTouched = S.staff && S.staff !== 'any'; $('days').scrollLeft = 0; $('tm').setAttribute('aria-busy', 'true'); loadAvail();
        return;
      }
      if (!b.dataset.day) return;
      S.day = b.dataset.day; S.dayPicked = true; S.tabTouched = S.staff && S.staff !== 'any'; msg(''); S.sig = ''; renderSlot();
      if (e.currentTarget.id === 'sl-none') { const n = $('days').querySelector('[aria-pressed="true"]'); if (n) { n.scrollIntoView({ block: 'nearest', inline: 'center' }); n.focus({ preventScroll: true }); } }
    };
    $('days').addEventListener('click', onDay);
    $('sl-none').addEventListener('click', onDay);
    $('tm').addEventListener('click', (e) => { const b = e.target.closest('button.tm-b'); if (b) pick(b, Number(b.dataset.m), S.staff || 'any'); });
    $('pl-tabs').addEventListener('click', (e) => { const t = e.target.closest('[data-tab]'); if (!t) return; S.tab = Number(t.dataset.tab); S.tabTouched = true; renderSlot(); const n = $('tab-' + S.tab); if (n) n.focus(); });
    $('pl-tabs').addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      e.preventDefault();
      S.tab = (S.tab + (e.key === 'ArrowRight' ? 1 : S.barbers.length - 1)) % S.barbers.length; S.tabTouched = true; renderSlot();
      const n = $('tab-' + S.tab); if (n) n.focus();
    });
    $('pl').addEventListener('click', (e) => { const c = e.target.closest('button.pl-c'); if (c) pick(c, Number(c.dataset.m), c.dataset.b); });
    // the shortcuts around the journey: each one fills steps of the same journey
    const fromNext = (e) => { e.preventDefault(); if (!S.ready) { toJourney(true); return; } prefill(S.next ? { staff: 'any', slot: { day: S.next.day, m: S.next.m } } : {}); };
    $('hero-next').addEventListener('click', fromNext);
    $('hero-live').addEventListener('click', fromNext);
    $('team').addEventListener('click', (e) => {
      const b = e.target.closest('.bb-next'); if (!b || !S.ready) return;
      prefill({ staff: b.dataset.staff, slot: b.dataset.day ? { day: b.dataset.day, m: Number(b.dataset.m) } : null });
    });
    $('carte-list').addEventListener('click', (e) => {
      const b = e.target.closest('[data-svc]'); if (!b) return;
      const sv = S.services.find((x) => x.id === b.dataset.svc); if (sv) prefill({ svc: sv });
    });
    document.addEventListener('click', (e) => {
      const a = e.target.closest('a[href="#reserver"]'); if (!a || a.id === 'hero-next' || a.classList.contains('skip')) return;
      e.preventDefault(); toJourney(true);
    });
    form.addEventListener('submit', submit);
    ['first', 'phone', 'email'].forEach((id) => $('f-' + id).addEventListener('input', () => { if ($('f-' + id).hasAttribute('aria-invalid')) fieldErr(id, ''); }));
    $('done-close').addEventListener('click', () => { resetJourney(); go('svc'); });
    document.addEventListener('visibilitychange', () => { if (!document.hidden && S.ready) loadAvail(); });
    setInterval(() => { if (!document.hidden && S.ready && !S.picking && !S.sending) loadAvail(); }, 30000);
    // a hold is released when the page is left, so the chair does not stay taken for nobody
    window.addEventListener('pagehide', () => { if (S.hold && !S.sim) { try { fetch('/api/public/holds/' + encodeURIComponent(S.hold.id), { method: 'DELETE', keepalive: true }); } catch (e) { /* the hold expires by itself */ } } });
  }

  /* ---------- boot ---------- */
  function shut(text) { const t = $('svc-list'); t.textContent = ''; t.appendChild(el('p', 'pl-shut', text)); }
  async function boot() {
    bootHero();
    bootChrome();
    bootEvents();
    let salon;
    try { salon = await Real.salon(); }
    catch (e) {
      if (e.code !== 'network') { shut(e.message); return; }
      Api = makeSim(); S.sim = true;
      salon = await Api.salon();
      const b = $('demo-b'); b.hidden = false; b.textContent = 'Mode démo : le salon n’est pas joignable d’ici. Le planning est simulé, rien n’est réservé.';
    }
    S.salon = salon;
    S.services = (salon.services || []).filter((x) => x.online !== false && !x.pack);
    S.barbers = salon.barbers || [];
    S.today = salon.today; S.from = salon.today;
    S.skew = (salon.now || Date.now()) - Date.now();
    if (salon.hoursText) $('ft-hours').textContent = salon.hoursText + '.' + (salon.closedText ? ' Fermé ' + salon.closedText + '.' : '');
    if (salon.shop && salon.shop.mapsUrl) { $('ft-maps').href = salon.shop.mapsUrl; document.querySelectorAll('[data-maps]').forEach((a) => { a.href = salon.shop.mapsUrl; }); $('pv-link').href = salon.shop.mapsUrl; $('done-map').href = salon.shop.mapsUrl; }
    renderCarte();
    if (salon.booking && salon.booking.enabled === false) { shut('La réservation en ligne est momentanément fermée.'); return; }
    if (!S.services.length || !S.barbers.length) { shut('La réservation en ligne est momentanément fermée.'); return; }
    renderJourney();
    await loadAvail();
  }
  boot();
})();
