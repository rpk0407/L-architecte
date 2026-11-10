/* L'Architecte · refonte — shared booking core (no markup, no style).
   Talks to the real salon API (/api/public/*: availability, holds = anti-doublon, bookings).
   If the API is unreachable (file opened by double-click, static preview) it falls back to a
   believable simulation so every design can be demoed offline. window.LA is the whole surface. */
(function () {
  var NB = ' ';
  var SHOP = { name: 'Barber L’Architecte', tagline: 'Votre lieu dédié à l’homme de tout âge.', street: '16, place Pélabon', zip: '13013', city: 'Marseille', email: 'larchitectebarber@gmail.com',
    hours: 'Mardi – samedi · 9 h – 18 h 30', closed: 'Fermé dimanche et lundi', rating: '5,0', reviews: 316,
    ig: 'https://www.instagram.com/barbershoplarchitecte/', fb: 'https://www.facebook.com/pg/barbershop.larchitecte/', yt: 'https://www.youtube.com/channel/UCi2oLstkv0IIucLyd211G8A',
    map: 'https://www.google.com/maps/search/?api=1&query=L%27Architecte%20coiffeur&query_place_id=ChIJJSWkBLy_yRIRbgAQcMwb-JY' };
  /* prices in euros, dur in minutes. cat: coupes | look | barbe */
  var SERVICES = [
    { id: 'cl', name: 'Coupe classique', cat: 'coupes', price: 20, dur: 30, inc: ['Coupe', 'Shampooing', 'Coiffage'] },
    { id: 'cc', name: 'Coupe + contour de barbe', cat: 'coupes', price: 25, dur: 30, inc: ['Coupe', 'Contour de barbe'] },
    { id: 'ct', name: 'Coupe + taille de barbe', cat: 'coupes', price: 30, dur: 30, tag: 'La plus complète', inc: ['Coupe', 'Taille de barbe', 'Shampooing', 'Coiffage', 'Soin cheveux', 'Soin barbe'] },
    { id: 'tr', name: 'Transformation', cat: 'look', price: 50, dur: 60, tag: 'Changement de look', inc: ['Diagnostic', 'Étude de faisabilité', 'Coupe', 'Coiffage et soin'] },
    { id: 'cd', name: 'Coupe + décoloration', cat: 'look', price: 80, from: true, dur: 90, inc: ['Coupe', 'Décoloration'] },
    { id: 'de', name: 'Décoloration', cat: 'look', price: 60, from: true, dur: 60, inc: ['Décoloration', 'Sans coupe'], note: 'Sous condition de faisabilité.' },
    { id: 'co', name: 'Coloration', cat: 'look', price: 30, from: true, dur: 60, inc: ['Coloration', 'Sans coupe'] },
    { id: 'si', name: 'Silver', cat: 'look', price: 100, dur: 60, tag: 'Blanc ou gris', inc: ['Décoloration jusqu’au blanc', 'Coloration grise', 'Soin', 'Produit d’entretien offert'], note: 'Ne pas laver la tête pendant 4 jours minimum.' },
    { id: 'eb', name: 'Entretien barbe', cat: 'barbe', price: 15, dur: 30, inc: ['Contour de barbe', 'Huile'] },
    { id: 'tb', name: 'Taille de barbe', cat: 'barbe', price: 18, dur: 30, inc: ['Taille', 'Mise en forme', 'Huile'] },
    { id: 'cb', name: 'Cover barbe', cat: 'barbe', price: 15, dur: 30, inc: ['Couleur de barbe', 'Soin'] }
  ];
  var BARBERS = [
    { id: 'jkut', name: 'JKut', initials: 'JK', line: 'Dégradés nets, finitions au millimètre.' },
    { id: 'frank', name: 'Frank', initials: 'FR', line: 'Classiques, contours et barbes soignées.' },
    { id: 'soldat', name: 'Le Soldat', initials: 'LS', line: 'Coupes courtes, textures, précision.' },
    { id: 'esteban', name: 'Esteban', initials: 'ES', line: 'Changements de look, couleur et silver.' }
  ];
  var CARNET = { name: 'Carnet 5 coupes', price: 80, per: 16, line: '5 coupes sur 5 semaines, soit 16 € la coupe, sans barbe. Se prend au salon : on fixe tes coupes avec toi.' };

  var state = { api: null, demo: false, shop: SHOP, services: SERVICES, barbers: BARBERS, ids: {}, staffIds: {} };
  var DAYS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
  var MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function iso(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function parseDay(s) { var p = s.split('-'); return new Date(+p[0], +p[1] - 1, +p[2]); }
  function hhmm(m) { return Math.floor(m / 60) + ' h ' + pad(m % 60); }
  function hhmmShort(m) { return Math.floor(m / 60) + ':' + pad(m % 60); }
  function eur(n, from) { return (from ? 'dès ' : '') + String(n).replace('.', ',') + NB + '€'; }
  function dayLabel(s, today) {
    var d = parseDay(s), t = parseDay(today || iso(new Date())), diff = Math.round((d - t) / 864e5);
    if (diff === 0) return 'Aujourd’hui'; if (diff === 1) return 'Demain';
    return DAYS[d.getDay()][0].toUpperCase() + DAYS[d.getDay()].slice(1) + ' ' + d.getDate() + ' ' + MONTHS[d.getMonth()];
  }
  function dayShort(s) { var d = parseDay(s); return { dow: DAYS[d.getDay()].slice(0, 3), n: d.getDate(), mon: MONTHS[d.getMonth()].slice(0, 4) }; }

  function http(method, url, body) {
    return fetch(url, { method: method, headers: body ? { 'content-type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined, credentials: 'same-origin' })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { if (!r.ok) { var e = new Error(j.message || 'Erreur'); e.code = j.code; e.status = r.status; throw e; } return j; }); });
  }

  /* ---------- simulation (offline) ---------- */
  var sim = { taken: {}, holds: {} };
  function rnd(seed) { var x = Math.sin(seed) * 1e4; return x - Math.floor(x); }
  function simDays(from, days, dur, staff) {
    var out = [], now = new Date(), nowDay = iso(now), nowMin = now.getHours() * 60 + now.getMinutes();
    for (var i = 0; i < days; i++) {
      var d = parseDay(from); d.setDate(d.getDate() + i); var key = iso(d), dow = d.getDay(), open = dow >= 2 && dow <= 6, slots = [];
      if (open) BARBERS.forEach(function (b, bi) {
        if (staff !== 'any' && staff !== b.id) return;
        for (var m = 540; m + dur <= 1110; m += 30) {
          if (key === nowDay && m < nowMin + 30) continue;
          var seed = d.getDate() * 97 + bi * 31 + m / 30 * 7 + d.getMonth() * 13, busy = rnd(seed) < (key === nowDay ? .62 : .42) || m === 750 && bi % 2 === 0;
          if (!busy && !sim.taken[key + '|' + b.id + '|' + m]) slots.push({ m: m, s: b.id });
        }
      });
      slots.sort(function (a, b) { return a.m - b.m; });
      out.push({ day: key, open: open, slots: slots });
    }
    return out;
  }

  /* ---------- public surface ---------- */
  var LA = {
    SHOP: SHOP, NB: NB, eur: eur, hhmm: hhmm, hhmmShort: hhmmShort, dayLabel: dayLabel, dayShort: dayShort, iso: iso, parseDay: parseDay, MONTHS: MONTHS, DAYS: DAYS,
    services: function () { return state.services; }, barbers: function () { return state.barbers; }, carnet: CARNET,
    barber: function (id) { return BARBERS.filter(function (b) { return b.id === id; })[0]; },
    service: function (id) { return SERVICES.filter(function (s) { return s.id === id; })[0]; },
    isDemo: function () { return state.demo; },
    /** totals for a list of service ids */
    total: function (ids) { var p = 0, d = 0, from = false; ids.forEach(function (i) { var s = LA.service(i); if (s) { p += s.price; d += s.dur; from = from || !!s.from; } }); return { price: p, dur: d, from: from }; },
    /** boot: tries the API, else simulates. Resolves {demo}. */
    init: function () {
      return http('GET', '/api/public/salon').then(function (j) {
        state.api = j; state.demo = false;
        (j.services || []).forEach(function (s) { if (s.slug) state.ids[s.slug] = s.id; });
        (j.barbers || []).forEach(function (b) { var k = String(b.name).toLowerCase().replace(/^le /, '').replace(/[^a-z]/g, ''); state.staffIds[k] = b.id; });
        return { demo: false, api: j };
      }).catch(function () { state.demo = true; return { demo: true }; });
    },
    /** free slots for services (our ids) from `from` for `days`, staff 'any' or barber id. -> [{day, open, slots:[{m, s}]}] with s = our barber id */
    availability: function (ids, staff, from, days) {
      from = from || iso(new Date()); days = days || 10;
      var dur = LA.total(ids).dur;
      if (state.demo) return Promise.resolve(simDays(from, days, dur, staff || 'any'));
      var real = ids.map(function (i) { return state.ids[i]; }).filter(Boolean);
      var st = staff && staff !== 'any' ? (state.staffIds[staff === 'soldat' ? 'soldat' : staff] || 'any') : 'any';
      var rev = {}; Object.keys(state.staffIds).forEach(function (k) { rev[state.staffIds[k]] = k; });
      return http('GET', '/api/public/availability?from=' + from + '&days=' + days + '&services=' + real.join(',') + '&staff=' + st).then(function (j) {
        return j.days.map(function (d) { return { day: d.day, open: d.open, slots: d.slots.map(function (x) { return { m: x.m, s: rev[x.s] || x.s }; }) }; });
      });
    },
    /** next free slot per barber -> {jkut:{day,m}|null,...}. Used for "prochain créneau" chips. */
    nextByBarber: function (ids) {
      return LA.availability(ids, 'any', iso(new Date()), 14).then(function (days) {
        var out = {}; BARBERS.forEach(function (b) { out[b.id] = null; });
        days.forEach(function (d) { d.slots.forEach(function (s) { if (!out[s.s] || (out[s.s].day === d.day && s.m < out[s.s].m)) { if (!out[s.s]) out[s.s] = { day: d.day, m: s.m }; } }); });
        return out;
      });
    },
    /** reserve the slot for a few minutes so nobody else can take it while the client types (this is what prevents double bookings) */
    hold: function (ids, staff, day, m, replace) {
      if (state.demo) { var id = 'h' + Date.now(); sim.holds[id] = [day, staff, m]; return Promise.resolve({ holdId: id, staff: staff, exp: Date.now() + 6e5 }); }
      var real = ids.map(function (i) { return state.ids[i]; });
      return http('POST', '/api/public/holds', { serviceIds: real, staffId: state.staffIds[staff], day: day, start: m, replace: replace || undefined })
        .then(function (j) { return { holdId: j.holdId, staff: staff, exp: j.exp }; });
    },
    release: function (holdId) { if (state.demo || !holdId) return Promise.resolve(); return http('DELETE', '/api/public/holds/' + holdId).catch(function () {}); },
    /** book. p = {ids, staff, day, m, holdId, first, last, phone, email, note, sms, marketing} -> {code, manage, status, deposit} */
    book: function (p) {
      if (state.demo) { sim.taken[p.day + '|' + p.staff + '|' + p.m] = 1; return new Promise(function (r) { setTimeout(function () { r({ code: 'AR' + Math.floor(1000 + Math.random() * 9000), manage: '#', status: 'confirmed', deposit: 0, demo: true }); }, 700); }); }
      var real = p.ids.map(function (i) { return state.ids[i]; });
      return http('POST', '/api/public/bookings', { holdId: p.holdId, serviceIds: real, staffId: state.staffIds[p.staff], day: p.day, start: p.m, first: p.first, last: p.last || '', phone: p.phone, email: p.email || '', note: p.note || '', sms: p.sms !== false, marketing: p.marketing === true });
    },
    /** nice .ics download for "Ajouter à mon agenda" */
    ics: function (p) {
      var d = LA.parseDay(p.day), s = new Date(d.getTime() + p.m * 6e4), e = new Date(s.getTime() + LA.total(p.ids).dur * 6e4);
      function f(x) { return x.getFullYear() + pad(x.getMonth() + 1) + pad(x.getDate()) + 'T' + pad(x.getHours()) + pad(x.getMinutes()) + '00'; }
      var t = 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Barber Architecte//FR\r\nBEGIN:VEVENT\r\nUID:' + (p.code || Date.now()) + '@larchitecte\r\nDTSTAMP:' + f(new Date()) + '\r\nDTSTART:' + f(s) + '\r\nDTEND:' + f(e) + '\r\nSUMMARY:Rendez-vous Barber L’Architecte\r\nLOCATION:16 place Pélabon 13013 Marseille\r\nEND:VEVENT\r\nEND:VCALENDAR';
      return 'data:text/calendar;charset=utf-8,' + encodeURIComponent(t);
    },
    /** is the shop open right now (local approximation, Tue–Sat 9:00–18:30) */
    openNow: function () { var n = new Date(), m = n.getHours() * 60 + n.getMinutes(), d = n.getDay(); return d >= 2 && d <= 6 && m >= 540 && m < 1110; }
  };
  window.LA = LA;
})();
