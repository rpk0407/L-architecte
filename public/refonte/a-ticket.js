/* L’Architecte · « Express » — 3 taps: formule → créneau → prénom + numéro. All booking goes through window.LA (core.js). */
(function () {
  'use strict';
  var LA = window.LA, NB = LA.NB;
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  var CATS = [['coupes', 'Coupes'], ['look', 'Changer de tête'], ['barbe', 'Barbe']];
  var DEF = ['cl'];               // 30 min: the length that sets "prochain créneau" in the hero
  var store = {
    get: function () { try { return JSON.parse(localStorage.getItem('la.last') || 'null'); } catch (e) { return null; } },
    set: function (v) { try { localStorage.setItem('la.last', JSON.stringify(v)); } catch (e) { /* private window */ } }
  };
  var S = { open: false, step: 1, ids: [], staff: 'any', day: null, m: null, slotStaff: null, holdId: null, holdExp: 0, days: [], pre: null, msg: '', err: '', busy: false, res: null, last: store.get(), soonest: null, again: null, timer: null };
  var lastFocus = null;

  function dlabel(day) { return LA.dayLabel(day); }
  function slotText(day, m) { return dlabel(day).toLowerCase() === 'aujourd’hui' || dlabel(day) === 'Demain' ? dlabel(day) + ' · ' + LA.hhmm(m) : dlabel(day).toLowerCase() + ' · ' + LA.hhmm(m); }
  function firstSlot(days, staff) {
    for (var i = 0; i < days.length; i++) for (var j = 0; j < days[i].slots.length; j++) { var s = days[i].slots[j]; if (!staff || staff === 'any' || s.s === staff) return { day: days[i].day, m: s.m, s: s.s }; }
    return null;
  }

  /* ---------- hero, menu, sticky bar ---------- */
  function setInert(on) { ['main', 'tb', 'cta'].forEach(function (id) { var e = document.getElementById(id); if (e) { if (on) e.setAttribute('inert', ''); else e.removeAttribute('inert'); } }); $('.foot').toggleAttribute('inert', on); }
  function toggleMenu(force) {
    var m = $('#menu'), b = $('#menuBtn'), open = force === undefined ? m.hidden : force;
    m.hidden = !open; b.setAttribute('aria-expanded', open ? 'true' : 'false'); $('#tb').classList.toggle('menu', open);
    b.firstElementChild.textContent = open ? 'Fermer' : 'Sommaire'; document.body.style.overflow = open ? 'hidden' : '';
  }

  function loadHero() {
    LA.nextByBarber(DEF).then(function (nb) {
      var best = null; Object.keys(nb).forEach(function (k) { var v = nb[k]; if (v && (!best || v.day < best.day || (v.day === best.day && v.m < best.m))) best = { day: v.day, m: v.m, s: k }; });
      S.soonest = best;
      $('#nextV').textContent = best ? slotText(best.day, best.m) : 'Bientôt, reviens vite';
      $$('[data-next]').forEach(function (e) {
        var v = nb[e.getAttribute('data-next')];
        e.innerHTML = v ? '<i aria-hidden="true"></i>' + esc(slotText(v.day, v.m)) : 'Pas de créneau cette quinzaine';
      });
    }).catch(function () { $('#nextV').textContent = 'Voir les créneaux'; });
    var L = S.last;
    if (L && L.ids && L.ids.length) {
      LA.availability(L.ids, L.staff || 'any', LA.iso(new Date()), 14).then(function (days) {
        var f = firstSlot(days, L.staff);
        if (!f) return;
        S.again = { ids: L.ids, staff: f.s, day: f.day, m: f.m };
        var sv = LA.service(L.ids[0]), b = LA.barber(f.s);
        $('#againV').textContent = (b ? b.name : '') + ' · ' + (sv ? sv.name : '') + ' · ' + slotText(f.day, f.m);
        $('#again').hidden = false;
      }).catch(function () { /* the hero still works without it */ });
    }
  }

  function renderStatic() {
    var h = '';
    CATS.forEach(function (c) {
      h += '<p class="cat">' + c[1] + '</p>';
      LA.services().filter(function (s) { return s.cat === c[0]; }).forEach(function (s) {
        h += '<button type="button" class="cr" data-act="pick-menu" data-id="' + s.id + '"><span class="cr-n">' + esc(s.name) + (s.tag ? '<em>' + esc(s.tag) + '</em>' : '') + '</span><span class="cr-d">' + esc(s.inc.join(' · ')) + '</span><span class="cr-p">' + LA.eur(s.price, s.from) + '<small>' + s.dur + ' min</small></span></button>';
      });
    });
    $('#menuList').innerHTML = h;
    $('#team').innerHTML = LA.barbers().map(function (b) {
      return '<article class="tm"><div class="tm-av" aria-hidden="true">' + esc(b.initials) + '</div><h3>' + esc(b.name) + '</h3><p>' + esc(b.line) + '</p><p class="tm-next" data-next="' + b.id + '">…</p><button type="button" class="btn" data-act="with" data-b="' + b.id + '">Réserver avec ' + esc(b.name) + '</button></article>';
    }).join('');
  }

  /* ---------- sheet ---------- */
  function openSheet(o) {
    o = o || {};
    lastFocus = document.activeElement;
    S.open = true; S.step = 1; S.ids = o.id ? [o.id] : []; S.staff = o.staff || 'any'; S.day = null; S.m = null; S.slotStaff = null; S.holdId = null; S.msg = ''; S.err = ''; S.res = null; S.pre = o.pre || null;
    $('#sheet').classList.add('open'); $('#veil').classList.add('open'); $('#cta').classList.add('off'); setInert(true); toggleMenu(false);
    document.body.style.overflow = 'hidden';
    if (o.id) toStep2(); else render();
    setTimeout(function () { var t = $('#bkT'); if (t) t.focus({ preventScroll: true }); }, 80);
  }
  function closeSheet() {
    if (!S.open) return;
    releaseHold(); clearInterval(S.timer); S.open = false;
    $('#sheet').classList.remove('open'); $('#veil').classList.remove('open'); $('#cta').classList.remove('off'); setInert(false); document.body.style.overflow = '';
    if (lastFocus && lastFocus.focus) { try { lastFocus.focus({ preventScroll: true }); } catch (e) { /* gone */ } }
  }
  function releaseHold() { if (S.holdId) { LA.release(S.holdId); S.holdId = null; } clearInterval(S.timer); }

  function head(k, t, h) {
    $('#bkK').textContent = k; $('#bkT').textContent = t; $('#bkH').textContent = h || '';
    $('#bkBack').classList.toggle('off', S.step === 1 || S.step === 4);
    $$('#bkProg i').forEach(function (e, i) { e.className = i + 1 < S.step ? 'done' : i + 1 === S.step ? 'on' : ''; if (S.step === 4) e.className = 'done'; });
  }
  function render() {
    var b = $('#bkBody'); b.scrollTop = 0;
    if (S.step === 1) step1(b); else if (S.step === 2) step2(b); else if (S.step === 3) step3(b); else step4(b);
  }

  /* 1 · formule */
  function step1(b) {
    head('Étape 1 sur 3', 'Pour quoi faire ?', 'Une touche, et on passe au créneau.');
    var h = '';
    if (S.pre) h += '<div class="pre"><i aria-hidden="true"></i><div>On te garde<b>' + esc(slotText(S.pre.day, S.pre.m)) + '</b></div></div>';
    CATS.forEach(function (c) {
      h += '<div class="sg"><p class="sg-h">' + c[1] + '</p>';
      LA.services().filter(function (s) { return s.cat === c[0]; }).forEach(function (s) {
        h += '<button type="button" class="so' + (S.ids[0] === s.id ? ' on' : '') + '" data-act="pick" data-id="' + s.id + '"><span class="so-l"><span class="so-n">' + esc(s.name) + (s.tag ? '<em>' + esc(s.tag) + '</em>' : '') + '</span><span class="so-d">' + esc(s.inc.join(' · ')) + '</span></span><span class="so-r"><b>' + LA.eur(s.price, s.from) + '</b><small>' + s.dur + ' min</small></span></button>';
      });
      h += '</div>';
    });
    b.innerHTML = '<div class="st">' + h + '</div>';
  }

  /* 2 · créneau */
  function toStep2() { S.step = 2; S.days = []; render(); loadDays(); }
  function step2(b) {
    var sv = LA.service(S.ids[0]);
    head('Étape 2 sur 3', 'Quel créneau ?', (sv ? sv.name + ' · ' + LA.eur(sv.price, sv.from) : ''));
    var chips = '<button type="button" class="chip' + (S.staff === 'any' ? ' on' : '') + '" data-act="barber" data-b="any">Peu importe</button>' +
      LA.barbers().map(function (x) { return '<button type="button" class="chip' + (S.staff === x.id ? ' on' : '') + '" data-act="barber" data-b="' + x.id + '">' + esc(x.name) + '</button>'; }).join('');
    var h = '<div class="st">' + (S.msg ? '<p class="bk-err" role="alert">' + esc(S.msg) + '</p>' : '') + '<div class="chips" role="group" aria-label="Barbier">' + chips + '</div><div id="slotArea"><p class="st-none">Je regarde les créneaux…</p></div></div>';
    b.innerHTML = h; paintSlots();
  }
  function loadDays() {
    LA.availability(S.ids, S.staff, LA.iso(new Date()), 10).then(function (days) {
      S.days = days.filter(function (d) { return d.open; });
      var cur = S.days.filter(function (d) { return d.day === S.day && d.slots.length; })[0];
      if (!cur) { var f = S.days.filter(function (d) { return d.slots.length; })[0]; S.day = f ? f.day : (S.days[0] ? S.days[0].day : null); }
      if (S.step === 2) paintSlots();
    }).catch(function () { var a = $('#slotArea'); if (a) a.innerHTML = '<p class="st-none">Les créneaux ne chargent pas. Réessaie dans un instant.</p>'; });
  }
  function slotsOf(day) {
    var map = {}, out = [];
    ((S.days.filter(function (d) { return d.day === day; })[0] || { slots: [] }).slots).forEach(function (s) { if (!map[s.m]) { map[s.m] = s.s; out.push({ m: s.m, s: s.s }); } });
    return out.sort(function (a, b) { return a.m - b.m; });
  }
  function paintSlots() {
    var a = $('#slotArea'); if (!a) return;
    if (!S.days.length) { a.innerHTML = '<p class="st-none">Je regarde les créneaux…</p>'; return; }
    var f = firstSlot(S.days, S.staff), h = '';
    if (!f) { a.innerHTML = '<p class="st-none">Plus de place ces dix prochains jours' + (S.staff === 'any' ? '' : ' avec ' + esc(LA.barber(S.staff).name)) + '. Essaie « Peu importe ».</p>'; return; }
    h += '<button type="button" class="fast" data-act="slot" data-day="' + f.day + '" data-m="' + f.m + '" data-s="' + f.s + '"><span class="fast-l"><span class="fast-k">Le plus tôt</span><span class="fast-t">' + esc(slotText(f.day, f.m)) + ' · avec ' + esc(LA.barber(f.s).name) + '</span></span><span class="fast-go">Prendre</span></button>';
    h += '<div class="dstrip" role="group" aria-label="Jour">' + S.days.map(function (d) {
      var sh = LA.dayShort(d.day), n = d.slots.length ? (new Set(d.slots.map(function (x) { return x.m; }))).size : 0;
      return '<button type="button" class="dc' + (d.day === S.day ? ' on' : '') + '" data-act="day" data-day="' + d.day + '"' + (n ? '' : ' disabled style="opacity:.45"') + '><small>' + sh.dow + '</small><b>' + sh.n + '</b><span>' + (n ? n + ' libres' : 'Complet') + '</span></button>';
    }).join('') + '</div>';
    var sl = slotsOf(S.day);
    h += '<div class="slg"><p class="sg-h">' + esc(dlabel(S.day)) + '</p>' + (sl.length ? '<div class="slots">' + sl.map(function (s) { return '<button type="button" class="sl" data-act="slot" data-day="' + S.day + '" data-m="' + s.m + '" data-s="' + s.s + '">' + LA.hhmm(s.m) + '</button>'; }).join('') + '</div>' : '<p class="st-none">Complet ce jour-là. Choisis un autre jour.</p>') + '</div>';
    a.innerHTML = h;
  }

  /* 3 · prénom + numéro */
  function takeSlot(day, m, staff) {
    if (S.busy) return; S.busy = true;
    LA.hold(S.ids, staff, day, m, S.holdId).then(function (r) {
      S.holdId = r.holdId; S.holdExp = r.exp || (Date.now() + 6e5); S.day = day; S.m = m; S.slotStaff = staff; S.step = 3; S.msg = ''; S.err = ''; S.busy = false; render(); startTimer();
    }).catch(function (e) {
      S.busy = false; S.holdId = null;
      S.msg = (e && (e.code === 'taken' || e.status === 409)) ? 'Ce créneau vient d’être pris. Choisis-en un autre, ta formule est gardée.' : ((e && e.message) || 'Impossible de garder ce créneau.');
      S.pre = null; S.step = 2; render(); loadDays();
    });
  }
  function startTimer() {
    clearInterval(S.timer);
    S.timer = setInterval(function () {
      var left = Math.max(0, Math.round((S.holdExp - Date.now()) / 1000)), e = $('#holdLeft');
      if (e) e.textContent = Math.floor(left / 60) + ':' + (left % 60 < 10 ? '0' : '') + (left % 60);
      if (left <= 0 && S.step === 3) { clearInterval(S.timer); S.holdId = null; S.msg = 'Le créneau n’est plus gardé. Reprends-en un.'; S.step = 2; render(); loadDays(); }
    }, 1000);
  }
  function summary() {
    var sv = LA.service(S.ids[0]), t = LA.total(S.ids), bb = LA.barber(S.slotStaff);
    return { sv: sv, t: t, bb: bb };
  }
  function ticket(code) {
    var x = summary();
    return '<div class="tkt"><p class="tkt-k">' + (code ? 'Ton rendez-vous' : 'Ton ticket') + '</p><p class="tkt-t">' + esc(x.sv.name) + '</p><div class="tkt-l"><div><span>Quand</span><b>' + esc(dlabel(S.day)) + ' · ' + LA.hhmm(S.m) + '</b></div><div><span>Avec</span><b>' + esc(x.bb ? x.bb.name : '') + '</b></div><div><span>Durée</span><b>' + x.t.dur + ' min</b></div></div><div class="tkt-p"><small>À régler au salon</small><b>' + LA.eur(x.t.price, x.t.from) + '</b></div>' + (code ? '<div class="tkt-code" aria-label="Référence">' + esc(code) + '</div>' : '') + '</div>';
  }
  function step3(b) {
    head('Étape 3 sur 3', 'Ton prénom et ton numéro', 'Pas de compte. C’est tout.');
    var L = S.last || {}, x = summary();
    b.innerHTML = '<form class="st" id="form" novalidate>' + ticket() + '<p class="hold"><i aria-hidden="true"></i><span>On te garde ce créneau <b id="holdLeft">10:00</b></span></p>' +
      (S.err ? '<p class="bk-err" role="alert">' + esc(S.err) + '</p>' : '') +
      '<div class="fld2"><label class="fld"><span>Prénom</span><input type="text" name="first" autocomplete="given-name" required minlength="2" maxlength="40" value="' + esc(L.first || '') + '"></label>' +
      '<label class="fld"><span>Téléphone</span><input type="tel" name="phone" inputmode="tel" autocomplete="tel" required placeholder="06 12 34 56 78" value="' + esc(L.phone || '') + '"></label></div>' +
      '<label class="fld"><span>E-mail (pour la confirmation par mail, facultatif)</span><input type="email" name="email" autocomplete="email" maxlength="120" value="' + esc(L.email || '') + '"></label>' +
      '<p class="note">Tu reçois la confirmation par SMS, et par e-mail si tu donnes une adresse. Rappel par SMS la veille à 18 h. En continuant, tu acceptes les <a href="/cgv" target="_blank" rel="noopener">conditions</a>.</p>' +
      '<div class="bk-go"><button type="submit" class="btn" id="goBtn">Confirmer · ' + LA.eur(x.t.price, x.t.from) + '</button></div></form>';
    var left = Math.max(0, Math.round((S.holdExp - Date.now()) / 1000)), e = $('#holdLeft'); if (e) e.textContent = Math.floor(left / 60) + ':' + (left % 60 < 10 ? '0' : '') + (left % 60);
    var f = $('#form'); f.addEventListener('submit', submit);
    setTimeout(function () { var i = f.elements[L.first ? 'phone' : 'first']; if (i && !L.first) i.focus({ preventScroll: true }); }, 120);
  }
  function submit(ev) {
    ev.preventDefault(); if (S.busy) return;
    var f = ev.target, first = f.first.value.trim(), phone = f.phone.value.trim(), email = f.email.value.trim();
    if (first.length < 2 || /[:\/]/.test(first)) { S.err = 'Entre ton prénom (2 lettres minimum).'; return step3Err(f); }
    if (phone.replace(/\D/g, '').length < 6) { S.err = 'Entre un numéro de téléphone valide.'; return step3Err(f); }
    if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { S.err = 'Cette adresse e-mail ne semble pas correcte.'; return step3Err(f); }
    S.busy = true; $('#goBtn').disabled = true; $('#goBtn').textContent = 'Je réserve…';
    var req = { ids: S.ids, staff: S.slotStaff, day: S.day, m: S.m, holdId: S.holdId, first: first, phone: phone, email: email };
    LA.book(req).then(function (r) {
      S.busy = false; S.res = r; S.holdId = null; clearInterval(S.timer);
      S.last = { ids: S.ids.slice(), staff: S.slotStaff, first: first, phone: phone, email: email }; store.set(S.last);
      S.step = 4; req.code = r.code; S.req = req; render();
    }).catch(function (e) {
      S.busy = false;
      if (e && (e.code === 'taken' || e.status === 409)) { S.holdId = null; clearInterval(S.timer); S.msg = 'Ce créneau vient d’être pris. Choisis-en un autre, tes choix sont gardés.'; S.step = 2; render(); loadDays(); }
      else { S.err = (e && e.message) || 'Ça n’a pas marché. Réessaie ou appelle le salon.'; step3Err(f); }
    });
  }
  function step3Err(f) { var v = { first: f.first.value, phone: f.phone.value, email: f.email.value }; render(); var g = $('#form'); g.first.value = v.first; g.phone.value = v.phone; g.email.value = v.email; }

  /* 4 · confirmation */
  function step4(b) {
    head('C’est réservé', 'À très vite.', '');
    var r = S.res || {}, ck = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
    var hasMail = S.req && S.req.email;
    b.innerHTML = '<div class="st">' + ticket(r.code) +
      '<ul class="ok-list"><li>' + ck + '<span>Confirmation par SMS' + (hasMail ? ' et par e-mail' : '') + (LA.isDemo() ? ' (en démo, rien ne part)' : '') + '.</span></li><li>' + ck + '<span>Rappel par SMS la veille à 18 h.</span></li><li>' + ck + '<span>Un empêchement ? Déplace ou annule depuis le lien du SMS.</span></li></ul>' +
      '<div class="ok-act"><a class="btn" download="rendez-vous-architecte.ics" href="' + LA.ics({ day: S.day, m: S.m, ids: S.ids, code: r.code }) + '">Ajouter à mon agenda</a>' +
      (r.manage && r.manage !== '#' ? '<a class="btn ghost" href="' + esc(r.manage) + '">Déplacer ou annuler</a>' : '') +
      '<button type="button" class="btn ghost" data-act="close">Fermer</button></div></div>';
    loadHero();
  }

  /* ---------- events ---------- */
  document.addEventListener('click', function (ev) {
    var el = ev.target.closest ? ev.target.closest('[data-act]') : null; if (!el) return;
    var a = el.getAttribute('data-act');
    if (a === 'menu') { toggleMenu(); return; }
    if (a === 'nav') { toggleMenu(false); return; }
    if (a === 'open') { openSheet(); return; }
    if (a === 'close') { closeSheet(); return; }
    if (a === 'next') { openSheet({ pre: S.soonest ? { day: S.soonest.day, m: S.soonest.m, s: S.soonest.s } : null }); return; }
    if (a === 'with') { openSheet({ staff: el.getAttribute('data-b') }); return; }
    if (a === 'pick-menu') { openSheet({ id: el.getAttribute('data-id') }); return; }
    if (a === 'again') {
      var g = S.again; if (!g) return; openSheet(); S.ids = g.ids.slice(); S.staff = g.staff; takeSlot(g.day, g.m, g.staff); return;
    }
    if (!S.open) return;
    if (a === 'back') { if (S.step === 3) { releaseHold(); S.step = 2; render(); loadDays(); } else if (S.step === 2) { S.step = 1; S.pre = null; render(); } return; }
    if (a === 'pick') {
      S.ids = [el.getAttribute('data-id')];
      if (S.pre) {            // a slot was kept from the hero: keep it if it still fits this formule
        var pre = S.pre; S.pre = null;
        LA.availability(S.ids, pre.s, pre.day, 1).then(function (days) {
          var ok = days[0] && days[0].slots.some(function (x) { return x.m === pre.m && x.s === pre.s; });
          if (ok) takeSlot(pre.day, pre.m, pre.s); else { S.staff = 'any'; toStep2(); }
        }).catch(function () { toStep2(); });
      } else toStep2();
      return;
    }
    if (a === 'barber') { S.staff = el.getAttribute('data-b'); S.msg = ''; S.days = []; render(); loadDays(); return; }
    if (a === 'day') { S.day = el.getAttribute('data-day'); paintSlots(); return; }
    if (a === 'slot') { takeSlot(el.getAttribute('data-day'), +el.getAttribute('data-m'), el.getAttribute('data-s')); return; }
  });
  document.addEventListener('keydown', function (ev) {
    if (ev.key !== 'Escape') return;
    if (S.open) closeSheet(); else if (!$('#menu').hidden) toggleMenu(false);
  });
  window.addEventListener('scroll', function () { $('#tb').classList.toggle('over', window.scrollY > window.innerHeight * .6); }, { passive: true });
  window.addEventListener('pagehide', function () { if (S.holdId) LA.release(S.holdId); });

  /* ---------- boot ---------- */
  renderStatic();
  LA.init().then(function (r) {
    if (r.demo) $('#demo').hidden = false;
    loadHero();
    if (/[?&]reserver\b/.test(location.search)) openSheet();
  });
})();
