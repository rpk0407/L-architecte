/* Refonte 3 « Le barbier d'abord ». La commande suit le parcours que les clients connaissent (docs/refonte-conventions.md) ;
   les cartes des barbiers sont des raccourcis qui en préremplissent une étape. Tout vient du salon (/api/public) : les barbiers, la carte, les créneaux libres.
   Un créneau choisi est tenu (POST /holds) le temps de taper ses coordonnées : deux clients ne prennent jamais le même.
   Sans serveur (fichier ouvert hors ligne), une simulation prend le relais et la page l'affiche : « mode démo ». */
(function () {
  'use strict';
  const NB = ' ';
  const API = '/api/public';
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const pad = (n) => (n < 10 ? '0' : '') + n;
  document.documentElement.classList.add('js');

  /* ---------- dates, in the salon's time (Europe/Paris) ---------- */
  const WD = ['dim.', 'lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.'];
  const WDL = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
  const MO = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
  const dt = (key) => { const p = key.split('-'); return new Date(Date.UTC(+p[0], +p[1] - 1, +p[2])); };
  const keyOf = (d) => d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate());
  const addDays = (key, n) => { const d = dt(key); d.setUTCDate(d.getUTCDate() + n); return keyOf(d); };
  const diffDays = (a, b) => Math.round((dt(b) - dt(a)) / 86400000);
  const dayLong = (key) => { const d = dt(key); return WDL[d.getUTCDay()] + ' ' + d.getUTCDate() + (d.getUTCDate() === 1 ? 'er' : '') + ' ' + MO[d.getUTCMonth()]; };
  const fmtH = (m) => Math.floor(m / 60) + NB + 'h' + (m % 60 ? NB + pad(m % 60) : '');
  // « 14:30 » on the time-slot buttons only (docs/refonte-conventions.md 4); everywhere else the site's « 14 h 30 »
  const hm = (m) => pad(Math.floor(m / 60)) + ':' + pad(m % 60);
  const th = (m) => Math.floor(m / 60) + NB + 'h' + (m % 60 ? NB + pad(m % 60) : '');
  const eur = (cents, from) => (from ? 'dès ' : '') + (cents % 100 ? (cents / 100).toFixed(2).replace('.', ',') : String(cents / 100)) + NB + '€';
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
  let skew = 0;
  function now() {
    const o = {};
    try {
      new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
        .formatToParts(new Date(Date.now() + skew)).forEach((p) => { o[p.type] = p.value; });
      return { day: o.year + '-' + o.month + '-' + o.day, min: (+o.hour % 24) * 60 + +o.minute };
    } catch (e) { const d = new Date(Date.now() + skew); return { day: d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()), min: d.getHours() * 60 + d.getMinutes() }; }
  }
  function dayWord(key) { const dd = diffDays(now().day, key); return dd === 0 ? 'Aujourd’hui' : dd === 1 ? 'Demain' : cap(dayLong(key)); }
  function dayMid(key) { const d = dt(key); return WD[d.getUTCDay()] + ' ' + d.getUTCDate() + ' ' + MO[d.getUTCMonth()]; }
  function dayBrief(key) { const dd = diffDays(now().day, key), d = dt(key); return dd === 0 ? 'aujourd’hui' : dd === 1 ? 'demain' : WD[d.getUTCDay()] + ' ' + d.getUTCDate() + (dd > 25 ? ' ' + MO[d.getUTCMonth()] : ''); }

  /* ---------- the simulation (only when the salon's server cannot be reached) ---------- */
  const SIM = (function () {
    const W = (a, b) => ({ 2: a, 3: a, 4: a, 5: a, 6: b || a });
    // the real team and their portraits (../img/equipe, the illustrations made for the salon); the weeks are simulated
    const staff = [
      { id: 'sim_f', name: 'Frank', initials: 'FR', photo: '../img/equipe/frank.webp', bio: 'Coupes classiques et barbes taillées à l’ancienne.', week: W([[540, 780], [810, 1110]]) },
      { id: 'sim_jk', name: 'JKut', initials: 'JK', photo: '../img/equipe/jkut.webp', bio: 'Dégradés à la précision chirurgicale.', week: W([[540, 750], [780, 1110]]) },
      { id: 'sim_al', name: 'Aland', initials: 'AL', photo: '../img/equipe/aland.webp', bio: 'Nouveau au salon.', week: W([[600, 780], [840, 1110]]) },
      { id: 'sim_e', name: 'Esteban', initials: 'ES', photo: '../img/equipe/esteban.webp', bio: 'Textures, boucles et transformations.', week: { 2: [[540, 810], [840, 1110]], 4: [[540, 810], [840, 1110]], 5: [[540, 810], [840, 1110]], 6: [[540, 810], [840, 1110]] } },
      { id: 'sim_ls', name: 'Le Soldat', initials: 'LS', photo: '../img/equipe/le-soldat.webp', bio: 'Skin fade, contours nets, couleur et silver.', week: W([[570, 720], [750, 1110]], [[540, 1050]]) }
    ];
    // the salon's card and the barbers' own lines (server/domain/seed.js SERVICES, BARBERS)
    const SV = [
      ['cl', 'Coupe classique', 'Coupes', 2000, 30, 0, ['Coupe', 'Shampooing', 'Coiffage'], ''],
      ['cc', 'Coupe + contour de barbe', 'Coupes', 2500, 30, 0, ['Coupe', 'Contour de la barbe'], ''],
      ['ct', 'Coupe + taille de barbe', 'Coupes', 3000, 30, 0, ['Coupe', 'Taille de barbe', 'Shampooing', 'Coiffage', 'Soin cheveux', 'Soin barbe'], 'La plus complète'],
      ['tr', 'Transformation', 'Changer de tête', 5000, 60, 0, ['Diagnostic', 'Étude de faisabilité', 'Coupe', 'Coiffage et soin'], 'Changement de look'],
      ['cd', 'Coupe + décoloration', 'Changer de tête', 8000, 90, 1, ['Coupe', 'Décoloration'], ''],
      ['de', 'Décoloration', 'Changer de tête', 6000, 60, 1, ['Décoloration', 'Sans coupe'], ''],
      ['co', 'Coloration', 'Changer de tête', 3000, 60, 1, ['Coloration', 'Sans coupe'], ''],
      ['si', 'Silver', 'Changer de tête', 10000, 60, 0, ['Décoloration jusqu’au blanc', 'Coloration grise', 'Soin', 'Produit d’entretien offert'], 'Blanc ou gris'],
      ['eb', 'Entretien barbe', 'Barbe', 1500, 30, 0, ['Contour de la barbe', 'Huile'], ''],
      ['tb', 'Taille de barbe', 'Barbe', 1800, 30, 0, ['Taille', 'Mise en forme', 'Huile'], ''],
      ['cb', 'Cover barbe', 'Barbe', 1500, 30, 0, ['Couleur de la barbe', 'Soin'], '']
    ].map((x, i) => ({ id: 'sim_' + x[0], slug: x[0], name: x[1], category: x[2], price: x[3], dur: x[4], from: !!x[5], includes: x[6], tag: x[7], description: '', deposit: 0, online: true, order: i }));
    const taken = new Set();
    let holds = {};
    const hash = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0) / 4294967296; };
    const k = (sid, day, m) => sid + '|' + day + '|' + m;
    function free(st, day, m, dur) {
      const iv = st.week[dt(day).getUTCDay()] || [];
      if (!iv.some((x) => m >= x[0] && m + dur <= x[1])) return false;
      const n = now();
      if (day < n.day || (day === n.day && m < n.min + 30)) return false;
      for (let t = m; t < m + dur; t += 30) {
        if (taken.has(k(st.id, day, t)) || hash(k(st.id, day, t)) < 0.46) return false;
        const h = Object.values(holds).find((x) => x.staffId === st.id && x.day === day && t >= x.start && t < x.start + x.dur && x.exp > Date.now());
        if (h) return false;
      }
      return true;
    }
    function slotsOf(day, dur, staffId) {
      const pool = staffId === 'any' ? staff : staff.filter((x) => x.id === staffId), out = [];
      for (let m = 540; m + dur <= 1110; m += 30) { const st = pool.find((x) => free(x, day, m, dur)); if (st) out.push({ m: m, s: st.id }); }
      return out;
    }
    const fail = (status, code, message) => { const e = new Error(message); e.status = status; e.code = code; return e; };
    function call(method, path, body) {
      const u = new URL(path, 'http://x'), p = u.pathname.replace(API, '');
      if (p === '/salon') {
        return { shop: { name: 'Barber L’Architecte', address: '16, place Pélabon', zip: '13013', city: 'Marseille', mapsUrl: '' }, hours: { 0: [], 1: [], 2: [[540, 1110]], 3: [[540, 1110]], 4: [[540, 1110]], 5: [[540, 1110]], 6: [[540, 1110]] }, hoursText: 'Du mardi au samedi, 9 h – 18 h 30', closures: [],
          booking: { enabled: true, maxDaysAhead: 60, holdMin: 5, cancelUntilHours: 12, pendingPayMin: 15 }, deposits: { mode: 'none' }, services: SV,
          menu: SV.map((x) => ({ slug: x.slug, name: x.name, category: x.category, price: x.price, from: x.from, dur: x.dur, online: true })).concat([{ slug: 'ab', name: 'Carnet 5 coupes', category: 'Carnet', price: 8000, from: false, dur: 30, online: false }]),
          barbers: staff.map((x) => ({ id: x.id, name: x.name, initials: x.initials, bio: x.bio, photo: x.photo, away: null })), sms: false, channel: 'sms', today: now().day, now: Date.now() };
      }
      if (p === '/availability') {
        const sv = SV.find((x) => x.id === u.searchParams.get('services')), from = u.searchParams.get('from') || now().day, n = +u.searchParams.get('days') || 10, days = [];
        for (let i = 0; i < n; i++) { const day = addDays(from, i); if (diffDays(now().day, day) > 60) break; const open = [2, 3, 4, 5, 6].includes(dt(day).getUTCDay()); days.push({ day: day, open: open, slots: open ? slotsOf(day, sv.dur, u.searchParams.get('staff') || 'any') : [] }); }
        return { dur: sv.dur, days: days };
      }
      if (p === '/holds' && method === 'POST') {
        const sv = SV.find((x) => x.id === body.serviceIds[0]);
        if (body.replace) delete holds[body.replace];
        const s = slotsOf(body.day, sv.dur, body.staffId).find((x) => x.m === body.start);
        if (!s) throw fail(409, 'taken', 'Ce créneau vient d’être pris.');
        const id = 'ho_' + Math.random().toString(36).slice(2, 9);
        holds[id] = { staffId: s.s, day: body.day, start: body.start, dur: sv.dur, exp: Date.now() + 300000 };
        return { holdId: id, staffId: s.s, exp: Date.now() + skew + 300000 };
      }
      if (p.indexOf('/holds/') === 0) { delete holds[decodeURIComponent(p.slice(7))]; return { ok: true }; }
      if (p === '/bookings') {
        const sv = SV.find((x) => x.id === body.serviceIds[0]), h = holds[body.holdId];
        let sid = h && h.day === body.day && h.start === body.start ? h.staffId : null;
        if (h) delete holds[body.holdId];
        if (!sid) { const s = slotsOf(body.day, sv.dur, body.staffId).find((x) => x.m === body.start); if (!s) throw fail(409, 'taken', 'Ce créneau vient d’être pris. Choisis-en un autre, tes choix sont gardés.'); sid = s.s; }
        for (let t = body.start; t < body.start + sv.dur; t += 30) taken.add(k(sid, body.day, t));
        return { code: 'DEMO' + Math.floor(10 + Math.random() * 89), token: '', manage: '', status: 'booked', deposit: 0, staffId: sid, payment: null };
      }
      throw fail(404, 'not_found', 'Indisponible en mode démo.');
    }
    return { call: (m, p, b) => new Promise((res, rej) => setTimeout(() => { try { res(call(m, p, b)); } catch (e) { rej(e); } }, 220)) };
  })();

  /* ---------- talking to the salon ---------- */
  let demo = false;
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
  function call(method, path, body) {
    if (demo) return SIM.call(method, path, body);
    const o = { method: method, headers: { accept: 'application/json' }, credentials: 'same-origin', cache: 'no-store' };
    if (body !== undefined) { o.headers['content-type'] = 'application/json'; o.body = JSON.stringify(body); }
    const w = netCall(method, path, body);
    if (w.rid) o.headers['x-request-id'] = w.rid;
    return fetch(w.path, o).then((r) => r.json().catch(() => ({})).then((j) => {
      w.done(r.status);
      if (!r.ok) { const e = new Error((j && j.error && j.error.message) || 'Le salon ne répond pas. Réessaie dans un instant.'); e.code = j && j.error ? j.error.code : 'http'; e.status = r.status; throw e; }
      return j;
    }), () => { const e = new Error('Pas de connexion. Vérifie ton réseau et réessaie.'); e.code = 'network'; throw e; });
  }

  /* ---------- state ---------- */
  /** Until how many hours before the client may cancel for free: the salon's own setting (GET /api/public/salon), null when it says none (the sentence is then left out, never guessed). */
  const cancelH = () => { const n = S.salon && S.salon.booking ? S.salon.booking.cancelUntilHours : null; return typeof n === 'number' && n > 0 ? n : null; };
  const S = {
    salon: null, svc: [], bySvc: {}, barbers: [], byStaff: {}, first: {}, firstAt: 0, hints: {},
    open: false, step: 'svc', who: null, svcId: null, day: null, start: null, hold: null, av: null, avKey: '', avLoading: false, err: '',
    form: { first: '', phone: '', email: '' }, noSms: false, busy: false, result: null, tab: null, opener: null
  };
  try { const f = JSON.parse(window.localStorage.getItem('lx-refonte-me') || 'null'); if (f && typeof f === 'object') ['first', 'phone', 'email'].forEach((k) => { if (typeof f[k] === 'string') S.form[k] = f[k].slice(0, 120); }); } catch (e) { /* ignore */ }
  const whoName = (w) => (w === 'any' ? 'Le premier de libre' : S.byStaff[w] ? S.byStaff[w].name : '');
  const whoPick = (w) => (w === 'any' ? 'Peu importe' : whoName(w));
  const whoIni = (w) => (w === 'any' ? '<span>1<sup>er</sup></span>' : esc(S.byStaff[w] ? S.byStaff[w].initials || S.byStaff[w].name.charAt(0) : ''));
  /* a barber's portrait: the address the salon gives when he shows it on the site (GET /api/public/salon `photo`), or the
     simulation's own file; '' otherwise, and his initials stand in */
  const photoOf = (w) => { const b = S.byStaff[w], u = b && typeof b.photo === 'string' ? b.photo : ''; return /^(\/api\/public\/barbers\/[A-Za-z0-9_-]+\/photo\?v=\d+|\.\.\/img\/equipe\/[a-z-]+\.webp)$/.test(u) ? u : ''; };
  const faceImg = (w) => { const u = photoOf(w); return u ? '<img src="' + esc(u) + '" alt="" decoding="async" data-face>' : ''; };
  /* the barber's face in the round: the portrait over his initials (a portrait that does not load leaves the initials) */
  const face = (w, cls) => '<span class="' + cls + (photoOf(w) ? ' pic' : '') + '" aria-hidden="true">' + whoIni(w) + faceImg(w) + '</span>';
  /* one line per barber: the first sentence of the bio the salon wrote in the Comptoir, nothing invented */
  const lineOf = (b) => { const t = String(b.bio || '').trim().split(/(?<=[.!?])\s+/)[0] || ''; return t ? t.replace(/\.$/, '') : 'Barbier au salon'; };
  function depositOf(sv) {
    const d = S.salon && S.salon.deposits;
    if (!sv) return 0;
    if (typeof sv.deposit === 'number') return sv.deposit > 0 ? Math.min(sv.price, sv.deposit) : 0;
    if (!d || d.mode === 'none' || !d.mode) return 0;
    if (d.mode === 'threshold' && sv.price < d.thresholdCents) return 0;
    return Math.min(sv.price, Math.max(500, Math.round((sv.price * d.percent) / 100 / 100) * 100));
  }

  /* ---------- live status of each barber ---------- */
  function statusOf(w) {
    const b = S.byStaff[w], mk = (cls, k, v) => ({ cls: cls, k: k, v: v || '', t: k + (v ? ' · ' + v : '') });
    if (b && b.away && b.away.note) return mk('off', b.away.note);
    const f = S.first[w];
    if (f === undefined) return mk('load', 'On regarde les créneaux…');
    if (!f) return mk('off', 'Complet ces deux semaines');
    const n = now(), dd = diffDays(n.day, f.day);
    if (dd === 0 && f.m - n.min <= 60) return mk('now', 'Libre maintenant', fmtH(f.m));
    if (dd === 0) return mk('soon', 'Libre aujourd’hui', fmtH(f.m));
    return mk('soon', 'Prochain créneau', dayBrief(f.day) + ' · ' + fmtH(f.m));
  }
  function defaultSvc() { return S.bySvc.cl || S.svc[0] || null; }
  /* the first free slot of everyone: for the cards (the salon's basic cut) and, inside the journey, for the chosen prestation */
  function firsts(svcId) { const def = defaultSvc(); return !svcId || (def && def.id === svcId) ? S.first : S.hints[svcId] || {}; }
  function loadFirst(svcId) {
    const def = defaultSvc(), sv = (svcId && S.bySvc[svcId]) || def;
    if (!sv) return Promise.resolve();
    const main = sv === def, map = main ? S.first : (S.hints[sv.id] = S.hints[sv.id] || {});
    if (main) S.firstAt = Date.now();
    const whos = ['any'].concat(S.barbers.map((b) => b.id));
    return Promise.all(whos.map((w) => call('GET', API + '/availability?services=' + encodeURIComponent(sv.id) + '&staff=' + encodeURIComponent(w) + '&days=14').then((j) => {
      let f = null;
      (j.days || []).some((d) => { if (d.slots && d.slots.length) { f = { day: d.day, m: d.slots[0].m, s: d.slots[0].s }; return true; } return false; });
      map[w] = f;
    }, () => { if (map[w] === undefined) map[w] = null; }))).then(() => { if (main) { renderCards(); renderHeroNext(); } if (S.open && S.step === 'who') renderSheet(); });
  }

  /* ---------- the page ---------- */
  const ARROW = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 12h15M13 6l6 6-6 6"/></svg>';
  const CHECK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
  function card(w, name, line, i) {
    const st = statusOf(w), b = S.byStaff[w], ini = w === 'any' ? '<b>1</b><sup>er</sup>' : whoIni(w), two = b && (b.initials || '').length > 1, pic = w !== 'any' && photoOf(w);
    return '<button type="button" class="bc' + (w === 'any' ? ' any' : '') + (b && b.away ? ' away' : '') + '" data-act="who" data-who="' + esc(w) + '" data-rv style="--d:' + i + '">' +
      '<span class="bc-i' + (two ? ' two' : '') + (pic ? ' pic' : '') + '" aria-hidden="true"><span>' + ini + '</span>' + (pic ? faceImg(w) : '') + '</span>' +
      '<span class="bc-t"><span class="bc-n">' + esc(name) + '</span><span class="bc-s">' + esc(line) + '</span></span>' +
      '<span class="bc-st ' + st.cls + '"><span class="bc-sk"><i aria-hidden="true"></i>' + esc(st.k) + '</span><span class="bc-sv">' + esc(st.v) + '</span></span>' +
      '<span class="bc-go" aria-hidden="true">' + ARROW + '</span></button>';
  }
  function renderCards() {
    const el = $('#cards');
    const seen = el.children.length > 0;
    el.innerHTML = card('any', 'Le premier de libre', 'Peu importe qui : le créneau le plus tôt, chez l’un des ' + (['', '', 'deux', 'trois', 'quatre', 'cinq', 'six'][S.barbers.length] || S.barbers.length) + '.', 0) +
      S.barbers.map((b, i) => card(b.id, b.name, lineOf(b), i + 1)).join('');
    el.setAttribute('aria-busy', S.first.any === undefined ? 'true' : 'false');
    if (seen) $$('[data-rv]', el).forEach((x) => x.setAttribute('data-in', '')); else watchReveals(el);
    const note = $('#avNote');
    if (note) note.textContent = S.first.any === undefined ? '' : 'Disponibilités à jour à ' + fmtH(now().min) + (demo ? ' (simulées)' : '');
  }
  function renderHeroNext() {
    const f = S.first.any;
    $('#nextV').textContent = f ? dayWord(f.day).replace(/^(\S+) (\d+\S*) \S+$/, '$1 $2') + ' · ' + fmtH(f.m) : 'Voir les créneaux';
  }
  function renderCarte() {
    const menu = (S.salon.menu || []).slice();
    const cats = [];
    menu.forEach((x) => { if (cats.indexOf(x.category) < 0) cats.push(x.category); });
    if (!S.tab || cats.indexOf(S.tab) < 0) S.tab = cats[0];
    $('#tabs').innerHTML = cats.map((c) => '<button type="button" role="tab" class="cr-tab" aria-selected="' + (c === S.tab) + '" data-act="tab" data-tab="' + esc(c) + '">' + esc(c) + '</button>').join('');
    $('#menuList').setAttribute('aria-label', S.tab || 'La carte');
    $('#menuList').innerHTML = menu.filter((x) => x.category === S.tab).map((x) => {
      const sv = x.slug ? S.bySvc[x.slug] : null, inc = sv && sv.includes && sv.includes.length ? sv.includes.join(' · ') : '';
      return '<li class="cr-i"><div class="cr-row"><p class="cr-n">' + esc(x.name) + '<small>' + esc(x.dur + ' min' + (inc ? ' · ' + inc : '')) + '</small></p>' +
        '<p class="cr-p">' + (x.from ? '<small>dès</small>' : '') + esc(eur(x.price)) + '</p>' +
        '<div class="cr-b">' + (sv && sv.description ? '<span class="cr-note">' + esc(sv.description) + '</span>' : '<span></span>') +
        (sv && x.online ? '<button type="button" class="btn small" data-act="svc-book" data-svc="' + esc(sv.id) + '" aria-label="Réserver : ' + esc(x.name) + '">Réserver</button>' : '<span class="cr-note">Se prend au salon</span>') + '</div></div></li>';
    }).join('');
  }
  const WORK = [
    { url: '../img/sidepart.jpg', alt: 'Raie marquée sur le côté, dégradé bas, nuque tatouée', n: 'La raie marquée', line: 'Dégradé bas, raie tracée', svc: 'cl', pos: '50% 30%' },
    { url: '../img/curls.jpg', alt: 'Boucles serrées sur le dessus, dégradé net et barbe taillée, face au miroir du salon', n: 'Boucles et barbe', line: 'Contour net, barbe taillée', svc: 'ct', pos: '45% 45%' },
    { url: '../img/fade.jpg', alt: 'Cheveux décolorés et dégradé à blanc derrière l’oreille', n: 'Décoloré, à blanc', line: 'Dégradé à blanc, décoloré', svc: 'cd', pos: '62% 40%' }
  ];
  function renderCuts() {
    $('#cuts').innerHTML = WORK.map((w) => {
      const sv = S.bySvc[w.svc];
      return '<article class="ct"><div class="ct-ph"><img src="' + w.url + '" width="1220" height="1500" alt="' + esc(w.alt) + '" loading="lazy" style="object-position:' + w.pos + '"></div>' +
        '<div class="ct-body"><div><h3 class="ct-n">' + esc(w.n) + '</h3><p class="ct-p">' + esc(w.line) + '</p></div>' + (sv ? '<p class="ct-price">' + (sv.from ? '<small>dès</small>' : '') + esc(eur(sv.price)) + '</p>' : '') + '</div>' +
        (sv ? '<button type="button" class="btn ghost ct-go" data-act="svc-book" data-svc="' + esc(sv.id) + '">Je veux cette coupe</button>' : '') + '</article>';
    }).join('');
  }
  function renderOpen() {
    const s = S.salon, n = now(), iv = (s.hours && s.hours[dt(n.day).getUTCDay()]) || [];
    const closed = (s.closures || []).some((c) => n.day >= c.from && n.day <= c.to);
    const cur = closed ? null : iv.find((x) => n.min >= x[0] && n.min < x[1]);
    $$('[data-open]').forEach((el) => {
      el.classList.toggle('open', !!cur);
      $('[data-open-t]', el).textContent = cur ? 'Ouvert jusqu’à ' + fmtH(cur[1]) : 'Fermé en ce moment';
    });
    if (s.hoursText) $('#hoursLine').textContent = s.hoursText;
    if (s.shop && s.shop.mapsUrl) $$('[data-maps],#mapsRead').forEach((a) => { a.href = s.shop.mapsUrl; });
    const low = Math.min.apply(null, S.svc.map((x) => x.price));
    $('#ctaSub').textContent = isFinite(low) ? 'dès ' + eur(low) : '';
  }

  /* ---------- the booking journey: the order every client already knows ----------
     prestation → barbier (« Peu importe ») → jour et heure → coordonnées → confirmation (docs/refonte-conventions.md).
     The page's shortcuts (a barber's card, the next slot, a line of the carte) only prefill steps of this same journey. */
  const STEPS = ['svc', 'who', 'slot', 'info'];
  const TITLES = { svc: 'Choisis ta prestation', who: 'Choisis ton barbier', slot: 'Choisis le jour et l’heure', info: 'Tes coordonnées' };
  const bk = $('#bk'), body = $('#bkBody'), foot = $('#bkFoot'), rc = $('#bkRc');
  let holdTimer = 0;

  function openSheet(o, opener) {
    if (!S.salon) return;
    if (S.result) { S.result = null; S.day = null; S.start = null; S.svcId = null; S.who = null; S.noSms = false; }
    releaseHold();
    if (o.who !== undefined) S.who = o.who;
    if (o.svc !== undefined) S.svcId = o.svc;
    S.err = ''; S.av = null; S.avKey = ''; S.start = null;
    // the first step that is not filled yet; « Réserver » always starts at step 1
    S.step = o.first || !S.svcId ? 'svc' : !S.who ? 'who' : 'slot';
    if (o.day) { S.day = o.day; }
    S.opener = opener || document.activeElement;
    S.open = true;
    bk.classList.add('open'); $('#veil').classList.add('open'); bk.setAttribute('aria-hidden', 'false');
    $$('main,header,footer,#cta,#menu').forEach((el) => { el.inert = true; });
    document.documentElement.style.overflow = 'hidden';
    closeMenu();
    renderSheet(true);
    if (S.step === 'slot') loadAv();
    if (S.step === 'who') loadFirst(S.svcId);
  }
  function closeSheet() {
    if (!S.open) return;
    S.open = false;
    releaseHold();
    clearInterval(holdTimer);
    bk.classList.remove('open'); $('#veil').classList.remove('open'); bk.setAttribute('aria-hidden', 'true');
    $$('main,header,footer,#cta,#menu').forEach((el) => { el.inert = false; });
    document.documentElement.style.overflow = '';
    if (S.opener && S.opener.isConnected && S.opener.focus) S.opener.focus(); else { const c = $('#cards .bc'); if (c) c.focus(); }
    loadFirst();
  }
  function releaseHold() {
    const h = S.hold;
    S.hold = null;
    if (h && h.id) call('DELETE', API + '/holds/' + encodeURIComponent(h.id)).catch(() => {});
  }
  function go(step) {
    if (S.step === 'info' && step !== 'info') { releaseHold(); clearInterval(holdTimer); S.start = null; }
    S.step = step;
    renderSheet(true);
    if (step === 'slot') loadAv();
    if (step === 'who') loadFirst(S.svcId);
  }
  /* Retour is on every step: from the first one it leaves the journey, choices kept */
  function back() { const i = STEPS.indexOf(S.step); S.err = ''; if (i > 0) go(STEPS[i - 1]); else closeSheet(); }
  function onward() { go(!S.svcId ? 'svc' : !S.who ? 'who' : 'slot'); }

  function avKey() { return S.svcId + '|' + S.who; }
  function loadAv(more) {
    const key = avKey();
    let from = null;
    if (more && S.av && S.avKey === key && S.av.length) from = addDays(S.av[S.av.length - 1].day, 1);
    else { S.av = null; S.avKey = key; }
    S.avLoading = true;
    renderSheet();
    return call('GET', API + '/availability?services=' + encodeURIComponent(S.svcId) + '&staff=' + encodeURIComponent(S.who) + '&days=14' + (from ? '&from=' + from : '')).then((j) => {
      if (S.avKey !== key) return;
      S.av = (from && S.av ? S.av : []).concat(j.days || []);
      S.avLoading = false;
      const cur = S.av.find((d) => d.day === S.day);
      if (!from && (!cur || !cur.slots.length)) { const f = S.av.find((d) => d.slots.length); S.day = f ? f.day : (S.av[0] ? S.av[0].day : null); }
      if (S.step === 'slot') renderSheet();
    }, (e) => { if (S.avKey !== key) return; S.avLoading = false; S.err = e.message; if (S.step === 'slot') renderSheet(); });
  }

  /* a step filled by a shortcut of the page: shown as done, one tap to change it */
  function prefilled(step, label, value) {
    return '<p class="pre"><span class="pre-ck" aria-hidden="true">' + CHECK + '</span><span class="pre-t"><small>' + esc(label) + '</small><b>' + esc(value) + '</b></span>' +
      '<button type="button" class="ed" data-act="go" data-step="' + step + '" aria-label="Modifier : ' + esc(label.toLowerCase()) + '">Modifier</button></p>';
  }
  function stepSvc() {
    const cats = [];
    S.svc.forEach((x) => { if (cats.indexOf(x.category) < 0) cats.push(x.category); });
    return '<div class="st">' + (S.who ? prefilled('who', 'Barbier', whoPick(S.who)) : '') + cats.map((c) => '<div class="sg"><p class="sg-h">' + esc(c) + '</p>' + S.svc.filter((x) => x.category === c).map((x) =>
      '<button type="button" class="so' + (S.svcId === x.id ? ' on' : '') + '" data-act="pick-svc" data-svc="' + esc(x.id) + '" aria-pressed="' + (S.svcId === x.id) + '"><span class="so-l"><span class="so-n">' + esc(x.name) + (x.tag ? '<em>' + esc(x.tag) + '</em>' : '') + '</span><span class="so-d">' + esc((x.includes || []).join(' · ')) + '</span></span><span class="so-r"><b>' + esc(eur(x.price, x.from)) + '</b><small>' + x.dur + ' min</small></span></button>').join('') + '</div>').join('') + '</div>';
  }
  /* the next free slot of each barber, for the chosen prestation: a small hint under the name */
  function hintOf(w) {
    const b = S.byStaff[w], f = firsts(S.svcId)[w];
    if (b && b.away && b.away.note) return { off: true, t: b.away.note };
    if (f === undefined) return { off: true, t: 'On regarde les créneaux…' };
    if (!f) return { off: true, t: 'Complet ces deux semaines' };
    return { off: false, t: 'Prochain créneau : ' + dayBrief(f.day) + ' à ' + th(f.m) };
  }
  function stepWho() {
    const row = (w, name) => { const h = hintOf(w); return '<button type="button" class="wh' + (w === 'any' ? ' any' : '') + (S.who === w ? ' on' : '') + '" data-act="pick-who" data-who="' + esc(w) + '" aria-pressed="' + (S.who === w) + '">' + (w === 'any' ? '<span class="wh-av" aria-hidden="true">' + whoIni(w) + '</span>' : face(w, 'wh-av')) + '<span class="wh-t"><b>' + esc(name) + '</b><small class="' + (h.off ? 'off' : '') + '"><i aria-hidden="true"></i>' + esc(h.t) + '</small></span><span class="wh-ck" aria-hidden="true">' + CHECK + '</span></button>'; };
    return '<div class="st"><div class="whs">' + row('any', 'Peu importe') + S.barbers.map((b) => row(b.id, b.name)).join('') + '</div></div>';
  }
  function stepSlot() {
    let h = '<div class="st">';
    if (S.err) h += '<p class="bk-err" role="alert" id="bkErr" tabindex="-1">' + esc(S.err) + '</p>';
    if (!S.av) return h + (S.avLoading ? '<p class="ld" role="status"><i aria-hidden="true"></i>On regarde les créneaux libres…</p>' : '<button type="button" class="btn ghost wide" data-act="retry">Réessayer</button>') + '</div>';
    const first = S.av.find((d) => d.slots.length);
    const last = S.av[S.av.length - 1], canMore = last && diffDays(now().day, last.day) < ((S.salon.booking && S.salon.booking.maxDaysAhead) || 60) - 1;
    h += '<div class="dstrip" id="dstrip" role="group" aria-label="Choisis un jour">' + S.av.map((d) => {
      const x = dt(d.day), n = d.slots.length, lab = !d.open ? 'fermé' : n ? n + (n > 1 ? ' libres' : ' libre') : 'complet';
      return '<button type="button" class="dc' + (n ? '' : ' none') + (d.day === S.day ? ' on' : '') + '" data-act="day" data-day="' + d.day + '" aria-pressed="' + (d.day === S.day) + '" aria-label="' + esc(cap(dayLong(d.day)) + ', ' + lab) + '"' + (d.open ? '' : ' disabled') + '><small>' + WD[x.getUTCDay()] + '</small><b>' + x.getUTCDate() + '</b><span>' + lab + '</span></button>';
    }).join('') + (canMore ? '<button type="button" class="dc more" data-act="more" aria-label="Voir les jours suivants"><small>Plus tard</small><b aria-hidden="true">›</b><span>' + (S.avLoading ? '…' : 'la suite') + '</span></button>' : '') + '</div>';
    const cur = S.av.find((d) => d.day === S.day);
    // a full day: the next free one is one tap away
    const after = cur ? S.av.find((d) => d.day > cur.day && d.slots.length) || first : first;
    const nextFree = after ? '<button type="button" class="btn ghost wide" data-act="day" data-day="' + after.day + '">Prochain jour libre : ' + esc(dayLong(after.day)) + '</button>' : '';
    if (!first) h += '<div class="full"><p class="full-t">' + (S.who === 'any' ? 'Aucun créneau libre sur ces jours.' : esc(whoName(S.who)) + ' est complet sur ces jours.') + '</p>' + (S.who !== 'any' ? '<button type="button" class="btn ghost wide" data-act="pick-who" data-who="any">Voir avec tous les barbiers</button>' : '') + '</div>';
    else if (cur && !cur.slots.length) h += '<div class="full"><p class="full-t">' + (cur.open ? (S.who === 'any' ? 'Complet ' : esc(whoName(S.who)) + ' est complet ') + esc(dayBrief(cur.day) === 'aujourd’hui' || dayBrief(cur.day) === 'demain' ? dayBrief(cur.day) : 'le ' + dayLong(cur.day)) + '.' : 'Le salon est fermé ' + esc('le ' + dayLong(cur.day)) + '.') + '</p><div class="full-a">' + nextFree + (S.who !== 'any' && cur.open ? '<button type="button" class="btn ghost wide" data-act="pick-who" data-who="any">Voir les autres barbiers ce jour-là</button>' : '') + '</div></div>';
    else if (cur) {
      h += '<p class="day-h" role="status">' + esc(cap(dayLong(cur.day))) + '<span class="vh"> : ' + cur.slots.length + ' créneaux libres</span></p>';
      [['Matin', (m) => m < 720], ['Après-midi', (m) => m >= 720]].forEach((g) => {
        const it = cur.slots.filter((s) => g[1](s.m));
        if (!it.length) return;
        h += '<div class="slg"><p class="slg-h">' + g[0] + '</p><div class="slots">' + it.map((s) => '<button type="button" class="sl' + (S.start === s.m ? ' on' : '') + '" data-act="slot" data-m="' + s.m + '" aria-label="' + esc(cap(dayLong(cur.day)) + ' à ' + hm(s.m)) + '"' + (S.busy ? ' disabled' : '') + '>' + hm(s.m) + '</button>').join('') + '</div></div>';
      });
    }
    return h + '</div>';
  }
  function holdLeft() { return S.hold ? Math.max(0, Math.round((S.hold.exp - (Date.now() + skew)) / 1000)) : 0; }
  function stepInfo() {
    const sv = S.bySvc[S.svcId], dep = depositOf(sv), hrs = cancelH();
    const left = holdLeft();
    return '<form class="st" id="bkForm" novalidate>' +
      (S.err ? '<p class="bk-err" role="alert" id="bkErr" tabindex="-1">' + esc(S.err) + '</p>' : '') +
      '<p class="hold' + (left ? '' : ' gone') + '" id="hold" role="status"><i aria-hidden="true"></i><span>' + (left ? 'Créneau gardé pour toi' : 'Le créneau n’est plus gardé : confirme vite.') + '</span><b id="holdLeft">' + (left ? Math.floor(left / 60) + ':' + pad(left % 60) : '') + '</b></p>' +
      '<div class="fld"><label for="f-first">Prénom</label><input id="f-first" name="first" type="text" autocomplete="given-name" autocapitalize="words" required maxlength="40" value="' + esc(S.form.first) + '" aria-describedby="h-first"><span class="hint warn" id="h-first" hidden></span></div>' +
      '<div class="fld"><label for="f-phone">Téléphone portable</label><input id="f-phone" name="phone" type="tel" inputmode="tel" autocomplete="tel" required placeholder="06 12 34 56 78" value="' + esc(S.form.phone) + '" aria-describedby="h-phone"><span class="hint" id="h-phone">' + PHONE_HINT + '</span></div>' +
      (smsOn() ? '<p class="sms-i"><span>' + esc(reminderDue(S.day) ? 'On t’envoie la confirmation par ' + chan() + ', et un rappel la veille à ' + reminderOf().hour + NB + 'h.' : 'On t’envoie la confirmation par ' + chan() + '.') + '</span><label class="sms-no" for="f-nosms"><input id="f-nosms" name="noSms" type="checkbox"' + (S.noSms ? ' checked' : '') + '><span>' + (chan() === 'SMS' ? 'Je ne veux pas de SMS' : 'Je ne veux pas de message ' + chan()) + '</span></label></p>' : '') +
      '<div class="fld"><label for="f-email">E-mail <span class="opt-l">(facultatif)</span></label><input id="f-email" name="email" type="email" inputmode="email" autocomplete="email" maxlength="120" value="' + esc(S.form.email) + '" aria-describedby="h-email"><span class="hint" id="h-email">Pour recevoir aussi la confirmation par e-mail.</span></div>' +
      (dep ? '<p class="dep">Un acompte de ' + esc(eur(dep)) + ' est demandé pour cette prestation, déduit au salon.' + (hrs ? ' Annulé plus de ' + hrs + NB + 'h avant, il est remboursé.' : '') + '</p>' : '') +
      '<p class="priv">Tes coordonnées servent à ce rendez-vous. <a href="/confidentialite" target="_blank" rel="noopener">Comment elles sont traitées</a></p>' +
      '<p class="priv">' + (dep ? (hrs ? 'En réservant, tu acceptes les conditions d’annulation : gratuite jusqu’à ' + hrs + NB + 'h avant, ensuite l’acompte reste au salon. ' : 'En réservant, tu acceptes les conditions d’annulation du salon. ') : 'En réservant, tu acceptes les conditions du salon. ') + '<a href="/cgv" target="_blank" rel="noopener">Voir les CGV</a></p></form>';
  }
  /* the confirmation and the reminder are service messages of the appointment: sent unless the client says no (never a promotion) */
  const PHONE_HINT = 'Pour ce rendez-vous, rien d’autre.';
  /* the way they reach the client (GET /api/public/salon `channel`): WhatsApp once the salon's number is set and its texts
     leave that way, SMS otherwise; a text really leaves (`sms` false without an SMS provider, unless it goes by WhatsApp) */
  function chan() { return S.salon && S.salon.channel === 'whatsapp' ? 'WhatsApp' : 'SMS'; }
  function smsOn() { return !demo && (S.salon.channel === 'whatsapp' || S.salon.sms !== false); }
  /* the reminder of the eve, from GET /api/public/salon (`reminder`): its hour, and nothing promised when it is off */
  function reminderOf() { const r = S.salon && S.salon.reminder; return r && typeof r.hour === 'number' ? r : { on: true, hour: 18 }; }
  function reminderDue(day) { const R = reminderOf(), n = now(), dd = diffDays(n.day, day); return R.on && (dd > 1 || (dd === 1 && n.min < R.hour * 60)); }
  function placeLine() { const sh = S.salon.shop || {}; return sh.address ? sh.address + ', ' + [sh.zip, sh.city].filter(Boolean).join(' ') : '16, place Pélabon, 13013 Marseille'; }
  function stepDone() {
    const r = S.result, sv = S.bySvc[r.svcId], staff = S.byStaff[r.staffId], pend = r.status === 'pending' && r.deposit > 0, sms = smsOn() && r.sms !== false;
    const li = [];
    if (demo) li.push('<b>Mode démo</b> : rien n’a été envoyé au salon, aucun message ne part.');
    else {
      const pre = pend ? 'Une fois l’acompte réglé : ' : '';
      if (sms) li.push(pre + '<b>' + (pend ? 'confirmation' : 'Confirmation') + ' par ' + chan() + '</b>' + (r.email ? ' et <b>par e-mail</b> à ' + esc(r.email) : '') + '.');
      else if (r.email) li.push(pre + '<b>' + (pend ? 'confirmation' : 'Confirmation') + ' par e-mail</b> à ' + esc(r.email) + '.');
      if (sms && reminderDue(r.day)) li.push('<b>Rappel par ' + chan() + ' la veille à ' + reminderOf().hour + NB + 'h</b>, avec le lien pour déplacer ou annuler.');
      li.push('Un empêchement ? Ta page de rendez-vous te laisse <b>déplacer ou annuler</b>' + (cancelH() ? ' jusqu’à ' + cancelH() + NB + 'h avant' : '') + '.');
    }
    const maps = (S.salon.shop && S.salon.shop.mapsUrl) || $('[data-maps]').href;
    // the salon's WhatsApp number is set (GET /api/public/salon `whatsapp`): the client opens the chat himself, with the
    // booking's code in the message. Not while the deposit is unpaid, nor in the simulation
    const waNum = String(S.salon.whatsapp || '');
    const wa = !demo && !pend && /^\d{8,15}$/.test(waNum) ? 'https://wa.me/' + waNum + '?text=' + encodeURIComponent('Bonjour, je viens de réserver chez L’Architecte : ' + dayLong(r.day) + ' à ' + th(r.start).replace(/[\u00a0\u202f]/g, ' ') + '. Référence ' + r.code + '. Merci de me confirmer ici.') : '';
    const row = (k, v, big) => '<div class="tk-r"><dt>' + k + '</dt><dd' + (big ? ' class="tk-w"' : '') + '>' + v + '</dd></div>';
    return '<div class="st done"><div class="ok"><span class="ok-c" aria-hidden="true"><svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"><path d="M13 25l7.5 7.5L35 17"/></svg></span><p class="ok-code">' + (pend ? 'Rendez-vous en attente de l’acompte' : 'Rendez-vous confirmé') + '<br>Code <b>' + esc(r.code) + '</b></p></div>' +
      '<dl class="tk">' + row('Quoi', esc(sv.name + ' · ' + sv.dur + ' min · ' + eur(sv.price, sv.from))) + row('Avec qui', staff ? '<span class="who-f">' + face(r.staffId, 'tk-av') + esc(staff.name) + '</span>' : 'Un barbier du salon') +
      row('Quand', esc(cap(dayLong(r.day)) + ' à ' + th(r.start)), true) + row('Où', 'Barber L’Architecte<br>' + esc(placeLine())) + '</dl>' +
      (pend && r.payment && r.payment.url ? '<div class="pay-b"><p>Un acompte de ' + esc(eur(r.deposit)) + ' confirme ce créneau. Il est déduit au salon.' + (S.salon.booking && S.salon.booking.pendingPayMin ? ' Tu as ' + S.salon.booking.pendingPayMin + ' minutes pour le régler.' : '') + '</p><a class="btn" href="' + esc(r.payment.url) + '">Régler l’acompte · ' + esc(eur(r.deposit)) + '</a></div>' : '') +
      '<div class="done-act">' + (r.ics ? '<a class="btn' + (pend ? ' ghost' : '') + '" href="' + r.ics + '" download="rdv-larchitecte.ics">Ajouter à mon agenda</a>' : '') + '<a class="btn ghost" href="' + esc(maps) + '" target="_blank" rel="noopener">Itinéraire</a>' + (wa ? '<a class="btn ghost" data-wa href="' + esc(wa) + '" target="_blank" rel="noopener">Recevoir la confirmation sur WhatsApp</a>' : '') + '</div>' +
      (r.manage ? '<a class="mg-l" href="' + esc(r.manage) + '">Déplacer ou annuler ce rendez-vous</a>' : '') +
      '<p class="sg-h after-h">Et maintenant</p><ul class="after">' + li.map((x) => '<li><span>' + x + '</span></li>').join('') + '</ul></div>';
  }
  function icsOf(r) {
    try {
      const sv = S.bySvc[r.svcId], st = S.byStaff[r.staffId], d = r.day.replace(/-/g, '');
      const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
      const ics = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Barber LArchitecte//Reservation//FR', 'BEGIN:VEVENT', 'UID:' + r.code + '@larchitecte', 'DTSTAMP:' + stamp,
        'DTSTART;TZID=Europe/Paris:' + d + 'T' + hm(r.start).replace(':', '') + '00', 'DTEND;TZID=Europe/Paris:' + d + 'T' + hm(r.start + sv.dur).replace(':', '') + '00',
        'SUMMARY:Barber L’Architecte · ' + sv.name, 'LOCATION:16 place Pélabon\\, 13013 Marseille',
        'DESCRIPTION:' + (st ? 'Avec ' + st.name + '. ' : '') + 'Code ' + r.code + '.' + (r.manage ? ' Gérer : ' + r.manage : ''), r.manage ? 'URL:' + r.manage : '', 'END:VEVENT', 'END:VCALENDAR'].filter(Boolean).join('\r\n');
      return URL.createObjectURL(new Blob([ics], { type: 'text/calendar' }));
    } catch (e) { return ''; }
  }

  /* the recap, always in sight: prestation, barbier, date et heure, durée, total.
     One line pair above the button on a phone, a side panel with « Modifier » on a wide screen. */
  function renderRecap() {
    const sv = S.bySvc[S.svcId], dep = depositOf(sv), held = S.step === 'info' && S.hold && S.byStaff[S.hold.staffId];
    const whoT = held ? held.name : S.who ? whoPick(S.who) : '';
    const when = S.day && S.start != null && S.step === 'info';
    const ed = (step, what) => (S.step !== step ? '<button type="button" class="ed" data-act="go" data-step="' + step + '" aria-label="Modifier ' + what + '">Modifier</button>' : '');
    const row = (k, v, e, pre) => '<div class="rc-r"><dt>' + k + '</dt><dd' + (v ? '' : ' class="todo"') + '>' + (v ? (pre || '') + esc(v) : 'À choisir') + '</dd>' + (v ? e : '') + '</div>';
    // the barber in the recap: his face beside his name once he is known (the one chosen, or the one the slot gave)
    const whoId = held ? S.hold.staffId : S.who && S.who !== 'any' ? S.who : '';
    const tot = sv ? esc(eur(sv.price, sv.from)) : '–';
    const note = sv ? (dep ? 'dont ' + eur(dep) + ' d’acompte' : 'à régler au salon') : '';
    rc.innerHTML = '<div class="rc-mini"><p class="rc-m1">' + esc(sv ? sv.name + ' · ' + sv.dur + ' min' : 'Prestation à choisir') + '</p>' +
      '<p class="rc-m2">' + esc((whoT || 'Barbier à choisir') + ' · ' + (when ? dayMid(S.day) + ' · ' + th(S.start) : 'jour et heure à choisir')) + '</p>' +
      '<p class="rc-mt"><span class="vh">Total : </span><b>' + tot + '</b>' + (note ? '<small>' + esc(note) + '</small>' : '') + '</p></div>' +
      '<div class="rc-full"><h3 class="rc-h">Ton rendez-vous</h3><dl class="rc-l">' +
      row('Prestation', sv ? sv.name : '', ed('svc', 'la prestation')) + row('Barbier', whoT, ed('who', 'le barbier'), whoId ? face(whoId, 'rc-av') : '') +
      row('Date et heure', when ? cap(dayLong(S.day)) + ' · ' + th(S.start) : '', ed('slot', 'la date et l’heure')) + row('Durée', sv ? sv.dur + ' min' : '', '') + '</dl>' +
      '<p class="rc-tot"><span>Total</span><b>' + tot + '</b></p>' + (note ? '<p class="rc-note">' + esc(note) + '</p>' : '') + '</div>';
  }
  function renderSheet(focus) {
    if (!S.open) return;
    const done = S.step === 'done', i = STEPS.indexOf(S.step);
    $('#bkK').textContent = done ? (S.result.status === 'pending' ? 'Plus qu’une étape' : 'C’est réservé') : 'Étape ' + (i + 1) + ' sur 4';
    $('#bkT').textContent = done ? (S.result.status === 'pending' ? 'Règle l’acompte' : (S.result.day === now().day ? 'À tout à l’heure' : 'À ' + dayBrief(S.result.day)) + ', ' + S.result.first + '.') : TITLES[S.step];
    const bb = $('#bkBack');
    bb.hidden = done;
    bb.setAttribute('aria-label', i === 0 ? 'Retour au site' : 'Retour à l’étape précédente');
    bk.classList.toggle('fin', done);
    const pr = $('#bkProg');
    pr.classList.toggle('off', done);
    const filled = [!!S.svcId, !!S.who, S.step === 'info', false];
    $$('i', pr).forEach((el, n) => { el.className = n === i ? 'on' : n < i || filled[n] ? 'done' : ''; });
    const keep = S.step === 'slot' && $('#dstrip') ? $('#dstrip').scrollLeft : null;
    const top = body.scrollTop;
    body.innerHTML = done ? stepDone() : S.step === 'who' ? stepWho() : S.step === 'svc' ? stepSvc() : S.step === 'slot' ? stepSlot() : stepInfo();
    if (!focus) { body.scrollTop = top; const st = $('.st', body); if (st) st.style.animation = 'none'; }
    const ds = $('#dstrip');
    if (ds) { if (keep != null && !focus) ds.scrollLeft = keep; else { const on = $('.dc.on', ds); if (on) ds.scrollLeft = Math.max(0, on.offsetLeft - 20 - 78); } }
    // one primary button, at the bottom: it says the action, and the price once it commits
    rc.hidden = done;
    if (!done) renderRecap();
    const sv = S.bySvc[S.svcId];
    let cta = '';
    if (S.step === 'info') cta = '<button type="submit" form="bkForm" class="btn wide" id="bkGo"' + (S.busy ? ' disabled' : '') + '>' + (S.busy ? 'Un instant…' : 'Confirmer le rendez-vous · ' + esc(eur(sv.price, sv.from))) + '</button>';
    else if ((S.step === 'svc' && S.svcId) || (S.step === 'who' && S.who)) cta = '<button type="button" class="btn wide" data-act="cont">Continuer</button>';
    foot.hidden = !cta; foot.innerHTML = cta;
    rc.classList.toggle('last', !cta);
    if (focus) {
      body.scrollTop = 0;
      const err = $('#bkErr');
      (err || $('#bkT')).focus({ preventScroll: true });
    }
  }

  function pickSlot(m) {
    if (S.busy) return;
    S.busy = true; S.err = ''; S.start = m;
    renderSheet();
    const old = S.hold; S.hold = null;
    call('POST', API + '/holds', { serviceIds: [S.svcId], staffId: S.who, day: S.day, start: m, replace: old && old.id ? old.id : undefined }).then((h) => {
      S.busy = false;
      if (!S.open || S.step !== 'slot') { call('DELETE', API + '/holds/' + encodeURIComponent(h.holdId)).catch(() => {}); return; }
      S.hold = { id: h.holdId, staffId: h.staffId, exp: h.exp };
      S.step = 'info';
      renderSheet(true);
      const f = $('#f-first'); if (f && !S.form.first) f.focus({ preventScroll: true });
      clearInterval(holdTimer);
      holdTimer = setInterval(tickHold, 1000);
    }, (e) => {
      S.busy = false; S.start = null;
      S.err = e.code === 'taken' ? 'Ce créneau vient d’être pris. Choisis-en un autre.' : e.message;
      loadAv().then(() => { const el = $('#bkErr'); if (el) el.focus({ preventScroll: true }); });
    });
  }
  function tickHold() {
    const el = $('#hold'), b = $('#holdLeft');
    if (!el || S.step !== 'info') { clearInterval(holdTimer); return; }
    const left = holdLeft();
    if (left > 0) b.textContent = Math.floor(left / 60) + ':' + pad(left % 60);
    else { clearInterval(holdTimer); el.classList.add('gone'); $('span', el).textContent = 'Le créneau n’est plus gardé : confirme vite.'; b.textContent = ''; }
  }
  function phoneOk(v) { const d = v.replace(/[\s.\-()]/g, ''); return /^0[1-9]\d{8}$/.test(d) || /^(\+|00)33[1-9]\d{8}$/.test(d); }
  function setHint(id, input, msg, base) {
    const h = $('#' + id);
    input.setAttribute('aria-invalid', msg ? 'true' : 'false');
    if (!h) return;
    if (msg) { h.textContent = msg; h.hidden = false; h.classList.add('warn'); }
    else if (base) { h.textContent = base; h.classList.remove('warn'); }
    else { h.hidden = true; }
  }
  function submit() {
    if (S.busy) return;
    const f = S.form, first = f.first.trim(), email = f.email.trim();
    const e1 = first.length < 2 ? 'Ton prénom, pour que ton barbier sache qui il attend.' : /[:/]/.test(first) ? 'Ton prénom, sans « : » ni « / ».' : '';
    const e2 = !phoneOk(f.phone) ? 'Un numéro français à 10 chiffres, comme 06 12 34 56 78.' : '';
    const e3 = email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) ? 'Cette adresse a l’air incomplète. Corrige-la ou laisse le champ vide.' : '';
    setHint('h-first', $('#f-first'), e1);
    setHint('h-phone', $('#f-phone'), e2, PHONE_HINT);
    setHint('h-email', $('#f-email'), e3, 'Pour recevoir aussi la confirmation par e-mail.');
    if (e1 || e2 || e3) { $(e1 ? '#f-first' : e2 ? '#f-phone' : '#f-email').focus(); return; }
    S.busy = true; S.err = '';
    const btn = $('#bkGo'); if (btn) { btn.disabled = true; btn.textContent = 'Un instant…'; }
    const req = { serviceIds: [S.svcId], staffId: S.who, day: S.day, start: S.start, holdId: S.hold ? S.hold.id : undefined, first: first, phone: f.phone.trim(), email: email || undefined, sms: !S.noSms };
    call('POST', API + '/bookings', req).then((r) => {
      S.busy = false; S.hold = null; clearInterval(holdTimer);
      try { window.localStorage.setItem('lx-refonte-me', JSON.stringify({ first: first, phone: f.phone.trim(), email: email })); } catch (e) { /* ignore */ }
      S.result = { sms: !S.noSms, code: r.code, manage: r.manage || '', status: r.status, deposit: r.deposit || 0, payment: r.payment || null, staffId: r.staffId, svcId: S.svcId, day: S.day, start: S.start, first: first, email: email };
      S.result.ics = S.result.status === 'pending' ? '' : icsOf(S.result);
      S.step = 'done';
      renderSheet(true);
    }, (e) => {
      S.busy = false;
      if (e.code === 'taken') {
        // back to the time choice: the prestation, the barber, the day and what was typed are kept
        S.hold = null; clearInterval(holdTimer); S.start = null; S.step = 'slot';
        S.err = e.message || 'Ce créneau vient d’être pris. Choisis-en un autre, tes choix sont gardés.';
        renderSheet(true);
        loadAv().then(() => { const el = $('#bkErr'); if (el) el.focus({ preventScroll: true }); });
      } else { S.err = e.message; renderSheet(true); }
    });
  }

  /* ---------- events ---------- */
  document.addEventListener('click', (ev) => {
    const el = ev.target.closest('[data-act]');
    if (!el) return;
    const a = el.dataset.act;
    if (a === 'book') openSheet({ first: true }, el);
    else if (a === 'next') openSheet({ first: true, who: 'any', day: S.first.any ? S.first.any.day : null }, el);
    else if (a === 'who') openSheet({ who: el.dataset.who }, el);
    else if (a === 'svc-book') openSheet({ svc: el.dataset.svc }, el);
    else if (a === 'close') closeSheet();
    else if (a === 'back') back();
    else if (a === 'go') { S.err = ''; go(el.dataset.step); }
    else if (a === 'cont') { S.err = ''; go(S.step === 'svc' ? 'who' : 'slot'); } // « Continuer » is the next step, in order
    else if (a === 'pick-who') { S.who = el.dataset.who; S.err = ''; onward(); }
    else if (a === 'pick-svc') { S.svcId = el.dataset.svc; S.err = ''; onward(); }
    else if (a === 'day') { S.day = el.dataset.day; S.start = null; S.err = ''; renderSheet(); const on = $('.dc.on'); if (on) on.focus({ preventScroll: true }); }
    else if (a === 'more') loadAv(true);
    else if (a === 'retry') { S.err = ''; loadAv(); }
    else if (a === 'slot') pickSlot(+el.dataset.m);
    else if (a === 'tab') { S.tab = el.dataset.tab; renderCarte(); const t = $('#tabs [aria-selected="true"]'); if (t) t.focus(); }
  });
  body.addEventListener('change', (ev) => { if (ev.target.name === 'noSms') S.noSms = ev.target.checked; });
  body.addEventListener('input', (ev) => { const n = ev.target.name; if (n && n in S.form) { S.form[n] = ev.target.value; if (ev.target.getAttribute('aria-invalid') === 'true') ev.target.setAttribute('aria-invalid', 'false'); } });
  body.addEventListener('submit', (ev) => { ev.preventDefault(); submit(); });
  // a portrait that does not load (hidden or archived since the salon answered): the initials under it stay
  document.addEventListener('error', (ev) => {
    const t = ev.target;
    if (t && t.tagName === 'IMG' && t.hasAttribute('data-face')) { if (t.parentNode) t.parentNode.classList.remove('pic'); t.remove(); }
  }, true);
  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape') { if (S.open) closeSheet(); else if (!$('#menu').hidden) { closeMenu(); $('#chBtn').focus(); } return; }
    if (ev.key !== 'Tab' || !S.open) return;
    const f = $$('button:not([disabled]):not([hidden]),a[href],input', bk).filter((x) => x.offsetParent !== null && getComputedStyle(x).visibility !== 'hidden');
    if (!f.length) return;
    const a = document.activeElement, first = f[0], last = f[f.length - 1];
    if (ev.shiftKey && (a === first || !bk.contains(a) || a === $('#bkT'))) { ev.preventDefault(); last.focus(); }
    else if (!ev.shiftKey && (a === last || !bk.contains(a))) { ev.preventDefault(); first.focus(); }
  });

  /* ---------- menu, top bar, reveals ---------- */
  const menu = $('#menu'), chBtn = $('#chBtn'), tb = $('#tb');
  function closeMenu() { if (menu.hidden) return; menu.hidden = true; chBtn.setAttribute('aria-expanded', 'false'); chBtn.setAttribute('aria-label', 'Ouvrir le sommaire'); tb.classList.remove('mo'); document.documentElement.style.overflow = S.open ? 'hidden' : ''; onScroll(); }
  chBtn.addEventListener('click', () => {
    if (!menu.hidden) { closeMenu(); return; }
    menu.hidden = false; chBtn.setAttribute('aria-expanded', 'true'); chBtn.setAttribute('aria-label', 'Fermer le sommaire');
    tb.classList.add('mo'); tb.classList.remove('light'); tb.classList.add('dark'); document.documentElement.style.overflow = 'hidden';
    const cur = $('#chName').dataset.id; $$('.mn-l a', menu).forEach((a) => a.classList.toggle('cur', a.getAttribute('href') === '#' + cur));
  });
  menu.addEventListener('click', (ev) => { if (ev.target.closest('a')) closeMenu(); });
  const tones = $$('[data-tone]').filter((x) => x.tagName === 'SECTION' || x.tagName === 'FOOTER'), chapters = $$('[data-ch]'), hero = $('#frais'), team = $('#barbiers');
  let raf = 0;
  function onScroll() {
    raf = 0;
    const vh = window.innerHeight, y = window.scrollY;
    hero.style.setProperty('--o', Math.max(0, Math.min(1, 1 - team.getBoundingClientRect().top / vh)).toFixed(3));
    if (menu.hidden) {
      let tone = 'light';
      tones.forEach((s) => { const r = s.getBoundingClientRect(); if (r.top <= 38 && r.bottom > 38) tone = s.dataset.tone; });
      tb.classList.toggle('light', tone === 'light'); tb.classList.toggle('dark', tone === 'dark');
    }
    tb.classList.toggle('scrolled', y > 8);
    let cur = null;
    chapters.forEach((s) => { if (s.getBoundingClientRect().top <= vh * 0.45) cur = s; });
    const nm = $('#chName');
    if ((cur ? cur.id : '') !== (nm.dataset.id || '')) { nm.dataset.id = cur ? cur.id : ''; nm.textContent = cur ? cur.dataset.name : 'Sommaire'; $('#chNum').textContent = cur ? cur.dataset.ch : ''; }
    const fc = $('.ft-cta').getBoundingClientRect();
    // the cards are the way in: while they fill the screen the floating button steps aside, as it does over the footer's own
    const cg = $('#cards').getBoundingClientRect();
    $('#cta').classList.toggle('off', (fc.top < vh - 20 && fc.bottom > 0) || (cg.top < vh * 0.7 && cg.bottom > vh * 0.45));
  }
  window.addEventListener('scroll', () => { if (!raf) raf = requestAnimationFrame(onScroll); }, { passive: true });
  let io = null;
  function watchReveals(root) {
    const els = $$('[data-rv]', root || document);
    if (!('IntersectionObserver' in window)) { els.forEach((x) => x.setAttribute('data-in', '')); return; }
    if (!io) io = new IntersectionObserver((en) => en.forEach((e) => { if (e.isIntersecting) { e.target.setAttribute('data-in', ''); io.unobserve(e.target); } }), { rootMargin: '0px 0px -6% 0px' });
    els.forEach((x) => io.observe(x));
  }

  /* ---------- « Frais. » : the fade, drawn in dots (the main site's halftone lettering) ---------- */
  const SERIF = '"Instrument Serif", "Times New Roman", serif';
  function drawHero(f) {
    const cv = $('#heroCv'), box = cv.parentElement, c = cv.getContext('2d');
    const W = Math.max(40, Math.floor(box.clientWidth)), dpr = Math.min(2, window.devicePixelRatio || 1), wide = window.innerWidth >= 1000;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.font = '400 100px ' + SERIF;
    let size = W / (c.measureText('Frais.').width / 100);
    size = Math.min(size, window.innerHeight * (wide ? 0.5 : 0.3));
    c.font = '400 ' + size.toFixed(2) + 'px ' + SERIF;
    const m = c.measureText('Frais.'), asc = m.actualBoundingBoxAscent || size * 0.72, desc = m.actualBoundingBoxDescent || 0, capH = c.measureText('H').actualBoundingBoxAscent || size * 0.7;
    const padT = Math.ceil(size * 0.03) + 3, H = Math.ceil(padT + asc + desc + padT), base = padT + asc;
    cv.style.height = H + 'px'; cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    const cell = Math.max(3.2, Math.min(11, size / 30)), R = cell * 0.6;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, W, H);
    c.fillStyle = '#0F0E0D';
    c.beginPath();
    const bTop = base - capH * f, top = base - asc - 2 - cell;
    if (bTop > top) c.rect(-cell, top, m.width + cell * 2, bTop - top);
    const span = Math.max(1, base - bTop);
    let row = 0;
    for (let y = bTop + cell * 0.3; y < base + desc + 2 + cell; y += cell * 0.866, row++) {
      const t = (y - bTop) / span, rad = t >= 1 ? 0 : R * Math.pow(1 - t, 1.15);
      if (rad < 0.22) continue;
      for (let x = -cell + (row % 2 ? cell / 2 : 0); x < m.width + cell; x += cell) { c.moveTo(x + rad, y); c.arc(x, y, rad, 0, 6.2832); }
    }
    c.fill();
    c.globalCompositeOperation = 'destination-in';
    c.font = '400 ' + size.toFixed(2) + 'px ' + SERIF;
    c.textBaseline = 'alphabetic';
    c.fillText('Frais.', 0, base);
    c.globalCompositeOperation = 'source-over';
  }
  function heroIntro() {
    const rm = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (rm) { drawHero(0.42); return; }
    const t0 = performance.now();
    const step = (t) => { const k = Math.min(1, (t - t0) / 1400), e = 1 - Math.pow(1 - k, 3); drawHero(1.02 * (1 - e) + 0.42 * e); if (k < 1) requestAnimationFrame(step); };
    requestAnimationFrame(step);
  }
  let rz = 0;
  window.addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(() => { drawHero(0.42); onScroll(); }, 120); });

  /* ---------- boot ---------- */
  function apply(j) {
    S.salon = j;
    if (typeof j.now === 'number') skew = j.now - Date.now();
    S.svc = (j.services || []).filter((x) => x.online !== false && x.active !== false).sort((a, b) => (a.order || 0) - (b.order || 0));
    S.bySvc = {}; S.svc.forEach((x) => { S.bySvc[x.id] = x; if (x.slug) S.bySvc[x.slug] = x; });
    S.barbers = j.barbers || [];
    S.byStaff = {}; S.barbers.forEach((b) => { S.byStaff[b.id] = b; });
    renderCards(); renderCarte(); renderCuts(); renderOpen(); renderHeroNext();
    return loadFirst();
  }
  function boot() {
    const ready = document.fonts && document.fonts.load ? Promise.race([document.fonts.load('400 100px "Instrument Serif"'), new Promise((r) => setTimeout(r, 1500))]).catch(() => {}) : Promise.resolve();
    ready.then(heroIntro);
    watchReveals();
    onScroll();
    const offline = location.protocol === 'file:';
    (offline ? Promise.reject(new Error('offline')) : call('GET', API + '/salon').then((j) => { if (!j || !Array.isArray(j.services) || !Array.isArray(j.barbers)) throw new Error('bad'); return j; }))
      .catch(() => { demo = true; $('#demo').hidden = false; document.body.classList.add('is-demo'); return SIM.call('GET', API + '/salon'); })
      .then(apply);
    setInterval(() => { if (!document.hidden && !S.open && S.salon && Date.now() - S.firstAt > 55000) { renderOpen(); loadFirst(); } }, 15000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden && !S.open && S.salon && Date.now() - S.firstAt > 55000) loadFirst(); });
  }
  boot();
})();
