/* L'Architecte · évolution C — « Le barbier d'abord ». Pas de script en ligne : la politique du site est script-src 'self'. */
(function () {
  'use strict';
  var LA = window.LA, NB = LA.NB;
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function safe(fn) { try { return fn(); } catch (e) { return null; } }
  var ARROW = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>';

  var S = { open: false, step: 1, barber: 'any', ids: [], day: null, m: null, who: null, holdId: null, days: null, err: '', loading: false, res: null, form: { first: '', phone: '', email: '', note: '' }, opener: null, busy: false };
  var NEXT = {};            // next free slot per barber
  var sheet, ov, body;

  /* ---------- helpers ---------- */
  function nowMin() { var n = new Date(); return n.getHours() * 60 + n.getMinutes(); }
  function nextText(n) {
    if (!n) return { t: 'Complet ces 2 semaines', now: false, none: true };
    var today = LA.iso(new Date());
    if (n.day === today && n.m <= nowMin() + 20) return { t: 'Libre maintenant', now: true };
    return { t: 'Prochain créneau · ' + LA.dayLabel(n.day).toLowerCase().replace(/^./, function (c) { return c.toUpperCase(); }) + ' ' + LA.hhmm(n.m), now: false };
  }
  function earliest() {
    var best = null;
    Object.keys(NEXT).forEach(function (k) { var n = NEXT[k]; if (n && (!best || n.day < best.day || (n.day === best.day && n.m < best.m))) best = { day: n.day, m: n.m, s: k }; });
    return best;
  }
  function cheapest() { var min = Infinity; LA.services().forEach(function (s) { if (s.price < min) min = s.price; }); return min; }
  function priceOf() { return LA.total(S.ids); }
  function barberName(id) { var b = LA.barber(id); return b ? b.name : ''; }

  /* ---------- page ---------- */
  function paintPage() {
    var sh = LA.SHOP;
    $('#mapRev').href = sh.map; $('#mapGo').href = sh.map; $('#ig').href = sh.ig; $('#fb').href = sh.fb; $('#yt').href = sh.yt;
    var mail = $('#mail'); mail.href = 'mailto:' + sh.email; mail.textContent = sh.email;
    $('#ctaFrom').textContent = 'dès ' + String(cheapest()).replace('.', ',') + NB + '€';
    var open = LA.openNow(), t = open ? 'Ouvert maintenant · jusqu’à 18 h 30' : 'Fermé · ouvre mardi – samedi à 9 h';
    ['#openSt', '#mnSt'].forEach(function (id) { var e = $(id); e.classList.toggle('open', open); $('span', e).textContent = t; });
    paintChairs(); paintMenu(); paintNext();
  }
  function paintChairs() {
    $('#chairs').innerHTML = LA.barbers().map(function (b, i) {
      var st = nextText(NEXT[b.id]);
      return '<button class="chair" type="button" role="listitem" data-act="book" data-barber="' + b.id + '" data-rv>' +
        '<span class="ini" aria-hidden="true">' + esc(b.name.replace(/^Le /, '').charAt(0)) + '</span><span class="no" aria-hidden="true">0' + (i + 1) + '</span>' +
        '<h3>' + esc(b.name) + '</h3><p>' + esc(b.line) + '</p>' +
        '<span class="st' + (st.now ? ' now' : '') + (st.none ? ' none' : '') + '"><i></i><span>' + esc(st.t) + '</span></span>' +
        '<span class="vh">Réserver avec ' + esc(b.name) + '</span></button>';
    }).join('');
    observe();
  }
  function paintNext() {
    var e = earliest(), v = $('#heroNextV'), f = $('#firstSt');
    if (!e) { v.textContent = 'Voir le planning'; f.textContent = 'Voir le planning'; return; }
    var lbl = LA.dayLabel(e.day) + ' · ' + LA.hhmm(e.m);
    v.textContent = lbl;
    var st = nextText(e);
    f.textContent = (st.now ? 'Libre maintenant' : lbl) + ' · avec ' + barberName(e.s);
  }
  function paintMenu() {
    var cats = [['coupes', 'Coupes'], ['look', 'Changer de tête'], ['barbe', 'Barbe']];
    var html = cats.map(function (c) {
      var rows = LA.services().filter(function (s) { return s.cat === c[0]; }).map(function (s) {
        return '<button class="row" type="button" data-act="book" data-svc="' + s.id + '"><b>' + esc(s.name) + (s.tag ? '<span class="tg">' + esc(s.tag) + '</span>' : '') + '</b>' +
          '<span class="pr">' + (s.from ? '<small>dès</small>' : '') + String(s.price).replace('.', ',') + NB + '€</span>' +
          '<span class="in">' + esc(s.inc.join(' · ')) + (s.note ? ' — ' + esc(s.note) : '') + '</span><span class="du">' + s.dur + ' min</span></button>';
      }).join('');
      return '<div class="cat"><h3>' + c[1] + '</h3>' + rows + '</div>';
    }).join('');
    html += '<div class="cat"><h3>Carnet</h3><div class="row off"><b>' + esc(LA.carnet.name) + '<span class="tg">' + LA.carnet.per + NB + '€ la coupe</span></b><span class="pr">' + LA.carnet.price + NB + '€</span><span class="in">' + esc(LA.carnet.line) + '</span><span class="du">au salon</span></div></div>';
    $('#menu').innerHTML = html;
    observe();
  }

  /* ---------- sheet ---------- */
  function setStepHead(n, label) { $('#bkN').textContent = n; $('#bkK').textContent = label; }
  function whoChips() {
    var all = [{ id: 'any', name: 'Le premier de libre' }].concat(LA.barbers());
    return '<div class="who" role="group" aria-label="Barbier">' + all.map(function (b) {
      return '<button class="chip" type="button" data-act="who" data-barber="' + b.id + '" aria-pressed="' + (S.barber === b.id) + '">' + esc(b.name) + '</button>';
    }).join('') + '</div>';
  }
  function demoNote() { return LA.isDemo() ? '<p class="bk-note">Mode démo : tout est simulé, aucun SMS ni e-mail ne part.</p>' : ''; }
  function render() {
    var b = $('#bkB'), h;
    if (S.step === 1) {
      setStepHead('1', 'Formule');
      h = '<h2 class="bk-t" id="bkT" tabindex="-1">Quelle formule&#8239;?</h2><p class="bk-s">Avec ' + (S.barber === 'any' ? 'le premier de libre' : esc(barberName(S.barber))) + '.</p>' + whoChips() +
        '<div class="fm">' + LA.services().map(function (s) {
          return '<button class="fm-i" type="button" data-act="svc" data-svc="' + s.id + '"><b>' + esc(s.name) + '</b><span class="p">' + LA.eur(s.price, s.from) + '</span><small>' + s.dur + ' min · ' + esc(s.inc.join(', ')) + '</small></button>';
        }).join('') + '</div>';
    } else if (S.step === 2) {
      setStepHead('2', 'Quand');
      var svc = LA.service(S.ids[0]);
      h = '<h2 class="bk-t" id="bkT" tabindex="-1">Quand&#8239;?</h2><p class="bk-s">' + esc(svc.name) + ' · ' + LA.eur(svc.price, svc.from) + ' · ' + svc.dur + ' min · <button class="tl" type="button" data-act="back1" style="min-height:32px;font-size:15px">changer</button></p>' + whoChips();
      if (S.err) h += '<p class="err" role="alert">' + esc(S.err) + '</p>';
      if (S.loading || !S.days) h += '<p class="none">Je regarde le planning…</p>';
      else {
        var open = S.days.filter(function (d) { return d.open; });
        h += '<div class="days" role="group" aria-label="Jour">' + open.map(function (d) {
          var s = LA.dayShort(d.day), n = uniqueSlots(d).length;
          return '<button class="day" type="button" data-act="day" data-day="' + d.day + '" aria-pressed="' + (S.day === d.day) + '"' + (n ? '' : ' disabled') + '>' + s.dow + '<b>' + s.n + '</b><small>' + (n ? n + ' créneaux' : 'complet') + '</small></button>';
        }).join('') + '</div>';
        var cur = S.days.filter(function (d) { return d.day === S.day; })[0], sl = cur ? uniqueSlots(cur) : [];
        if (!sl.length) h += '<p class="none">Aucun créneau ce jour-là' + (S.barber === 'any' ? '' : ' avec ' + esc(barberName(S.barber))) + '. Essaie un autre jour ou un autre barbier.</p>';
        else {
          var am = sl.filter(function (x) { return x.m < 750; }), pm = sl.filter(function (x) { return x.m >= 750; });
          [['Matin', am], ['Après-midi', pm]].forEach(function (g) {
            if (!g[1].length) return;
            h += '<p class="slots-k">' + g[0] + '</p><div class="slots">' + g[1].map(function (x) {
              return '<button class="slot" type="button" data-act="slot" data-m="' + x.m + '" data-who="' + x.s + '" aria-label="' + LA.hhmm(x.m) + (S.barber === 'any' ? ' avec ' + esc(barberName(x.s)) : '') + '">' + LA.hhmm(x.m) + '</button>';
            }).join('') + '</div>';
          });
        }
      }
    } else if (S.step === 3) {
      setStepHead('3', 'Toi');
      var t = priceOf(), svc3 = LA.service(S.ids[0]);
      h = '<h2 class="bk-t" id="bkT" tabindex="-1">C’est presque fait.</h2><p class="bk-s">Ton créneau est gardé pour toi quelques minutes.</p>' +
        '<div class="tic"><div><span>Quand</span><b>' + esc(LA.dayLabel(S.day)) + ' · ' + LA.hhmm(S.m) + '</b></div><div><span>Avec</span><b>' + esc(barberName(S.who)) + '</b></div><div><span>Formule</span><b>' + esc(svc3.name) + '</b></div><div class="tot"><span>Total</span><b>' + LA.eur(t.price, t.from) + '</b></div></div>';
      if (S.err) h += '<p class="err" role="alert">' + esc(S.err) + '</p>';
      h += '<form id="bkForm" novalidate>' +
        '<div class="fld"><label for="f-first">Prénom</label><input id="f-first" name="first" autocomplete="given-name" required value="' + esc(S.form.first) + '"></div>' +
        '<div class="fld"><label for="f-phone">Téléphone</label><input id="f-phone" name="phone" type="tel" inputmode="tel" autocomplete="tel" placeholder="06 12 34 56 78" required value="' + esc(S.form.phone) + '"></div>' +
        '<div class="fld"><label for="f-email">E-mail <small>(facultatif, pour recevoir la confirmation aussi par e-mail)</small></label><input id="f-email" name="email" type="email" autocomplete="email" value="' + esc(S.form.email) + '"></div>' +
        '<div class="fld"><label for="f-note">Un mot pour le barbier <small>(facultatif)</small></label><textarea id="f-note" name="note" maxlength="200">' + esc(S.form.note) + '</textarea></div>' +
        '<p class="bk-note">Tu reçois la confirmation par SMS, et par e-mail si tu laisses une adresse. Rappel par SMS la veille à 18' + NB + 'h. En continuant, tu acceptes les <a class="tl" style="min-height:0" href="/cgv" target="_blank" rel="noopener">CGV</a>.</p>' + demoNote() +
        '<div class="bk-act"><button class="btn" type="submit" id="bkGo"' + (S.busy ? ' disabled' : '') + '>' + (S.busy ? 'Un instant…' : 'Confirmer · ' + LA.eur(t.price, t.from)) + '</button><button class="btn ghost" type="button" data-act="back2">Changer d’heure</button></div></form>';
    } else {
      setStepHead('✓', 'Réservé');
      var r = S.res, tt = priceOf(), svc4 = LA.service(S.ids[0]);
      var ics = LA.ics({ day: S.day, m: S.m, ids: S.ids, code: r.code });
      var manage = r.manage && r.manage !== '#' ? '<a class="btn ghost" href="' + esc(r.manage) + '" target="_blank" rel="noopener">Déplacer ou annuler</a>' : '<p class="bk-note">Pour déplacer ou annuler, utilise le lien dans ton SMS.</p>';
      h = '<div class="ok-mark" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="#0F0E0D" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg></div>' +
        '<h2 class="bk-t" id="bkT" tabindex="-1">C’est réservé, ' + esc(S.form.first) + '.</h2><p class="code">Réf. ' + esc(r.code) + '</p>' +
        '<div class="tic"><div><span>Quand</span><b>' + esc(LA.dayLabel(S.day)) + ' · ' + LA.hhmm(S.m) + '</b></div><div><span>Avec</span><b>' + esc(barberName(S.who)) + '</b></div><div><span>Formule</span><b>' + esc(svc4.name) + '</b></div><div class="tot"><span>À régler au salon</span><b>' + LA.eur(tt.price, tt.from) + '</b></div></div>' +
        (r.deposit > 0 ? '<p class="err" style="background:#F6E6C8;color:#4A3300">Un acompte de ' + LA.eur(r.deposit) + ' est demandé pour garder ton créneau. Le lien est dans ton SMS et sur la page de ton rendez-vous.</p>' : '') +
        '<p class="bk-note">Tu reçois la confirmation par SMS' + (S.form.email ? ' et par e-mail à ' + esc(S.form.email) : ', et par e-mail si tu laisses une adresse la prochaine fois') + '. Rappel par SMS la veille à 18' + NB + 'h. 16, place Pélabon, Marseille 13e.</p>' + demoNote() +
        '<div class="bk-act"><a class="btn" href="' + ics + '" download="rendez-vous-larchitecte.ics">Ajouter à mon agenda</a>' + manage + '<button class="btn ghost" type="button" data-act="close">Fermer</button></div>';
    }
    b.innerHTML = h;
    b.scrollTop = 0;
  }
  function uniqueSlots(d) {
    var seen = {}, out = [];
    d.slots.forEach(function (x) { if (!seen[x.m]) { seen[x.m] = 1; out.push(x); } });
    return out.sort(function (a, b) { return a.m - b.m; });
  }
  function focusTitle() { setTimeout(function () { var t = $('#bkT'); if (t) t.focus({ preventScroll: true }); }, 30); }

  function openSheet(o) {
    o = o || {};
    S.opener = document.activeElement; S.open = true; S.err = ''; S.res = null; S.holdId = null; S.m = null; S.who = null;
    S.barber = o.barber || 'any'; S.ids = o.svc ? [o.svc] : [];
    sheet.classList.add('on'); ov.classList.add('on'); body.classList.add('lock');
    if (o.svc) { S.step = 2; loadDays(); } else S.step = 1;
    render(); focusTitle();
  }
  function closeSheet() {
    if (!S.open) return;
    S.open = false; LA.release(S.holdId); S.holdId = null;
    sheet.classList.remove('on'); ov.classList.remove('on'); body.classList.remove('lock');
    var o = S.opener; if (o && o.focus) { try { o.focus({ preventScroll: true }); } catch (e) { /* ignore */ } }
    refreshNext();
  }
  function loadDays(keepDay) {
    S.loading = true; S.days = null; render();
    return LA.availability(S.ids, S.barber, LA.iso(new Date()), 14).then(function (days) {
      S.days = days; S.loading = false;
      var has = function (d) { return d && d.open && uniqueSlots(d).length; };
      var cur = days.filter(function (d) { return d.day === S.day; })[0];
      if (!keepDay || !has(cur)) { var first = days.filter(has)[0]; S.day = first ? first.day : null; }
      render();
    }).catch(function () { S.loading = false; S.days = []; S.err = 'Je n’arrive pas à lire le planning. Réessaie dans un instant ou appelle le salon.'; render(); });
  }
  function isTaken(e) { return e && (e.code === 'taken' || e.status === 409); }

  function chooseSlot(m, who) {
    if (S.busy) return;
    S.busy = true; S.err = '';
    LA.hold(S.ids, who, S.day, m, S.holdId).then(function (h) {
      S.busy = false; S.holdId = h.holdId; S.m = m; S.who = who; S.step = 3; render(); focusTitle();
    }).catch(function (e) {
      S.busy = false;
      S.err = isTaken(e) ? 'Ce créneau vient d’être pris. Choisis-en un autre, ta formule est gardée.' : ((e && e.message) || 'Je n’ai pas pu garder ce créneau.');
      loadDays(true);
    });
  }
  function submit(ev) {
    ev.preventDefault();
    var f = ev.target, first = f.first.value.trim(), phone = f.phone.value.trim(), email = f.email.value.trim(), note = f.note.value.trim();
    S.form = { first: first, phone: phone, email: email, note: note };
    var bad = [];
    if (first.length < 2 || /[:/]/.test(first)) bad.push('f-first');
    if ((phone.match(/\d/g) || []).length < 9) bad.push('f-phone');
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) bad.push('f-email');
    if (bad.length) {
      S.err = bad[0] === 'f-first' ? 'Ton prénom, sans « : » ni « / ».' : bad[0] === 'f-phone' ? 'Vérifie ton numéro de téléphone.' : 'Vérifie ton adresse e-mail.';
      render(); bad.forEach(function (id) { var e = $('#' + id); if (e) e.setAttribute('aria-invalid', 'true'); }); var e0 = $('#' + bad[0]); if (e0) e0.focus(); return;
    }
    S.err = ''; S.busy = true; render();
    LA.book({ ids: S.ids, staff: S.who, day: S.day, m: S.m, holdId: S.holdId, first: first, phone: phone, email: email, note: note, sms: true }).then(function (r) {
      S.busy = false; S.holdId = null; S.res = r; S.step = 4; render(); focusTitle();
    }).catch(function (e) {
      S.busy = false;
      if (isTaken(e)) { S.holdId = null; S.m = null; S.step = 2; S.err = 'Ce créneau vient d’être pris. Choisis-en un autre, tes choix sont gardés.'; loadDays(true); focusTitle(); }
      else { S.err = (e && e.message) || 'La réservation n’a pas abouti. Réessaie.'; render(); }
    });
  }

  /* ---------- events (delegation) ---------- */
  document.addEventListener('click', function (e) {
    var t = e.target.closest('[data-act]'); if (!t) return;
    var a = t.getAttribute('data-act');
    if (a === 'book') { closeMenu(); openSheet({ barber: t.getAttribute('data-barber') || 'any', svc: t.getAttribute('data-svc') || null }); }
    else if (a === 'close') closeSheet();
    else if (a === 'who') { var nb = t.getAttribute('data-barber'); if (nb !== S.barber) { S.barber = nb; S.err = ''; if (S.step === 2) loadDays(true); else render(); } }
    else if (a === 'svc') { S.ids = [t.getAttribute('data-svc')]; S.step = 2; S.err = ''; loadDays(); focusTitle(); }
    else if (a === 'back1') { S.step = 1; S.err = ''; render(); focusTitle(); }
    else if (a === 'back2') { LA.release(S.holdId); S.holdId = null; S.step = 2; S.err = ''; loadDays(true); focusTitle(); }
    else if (a === 'day') { S.day = t.getAttribute('data-day'); S.err = ''; render(); var d = $('.day[aria-pressed="true"]'); if (d && d.scrollIntoView) d.scrollIntoView({ inline: 'center', block: 'nearest' }); }
    else if (a === 'slot') chooseSlot(+t.getAttribute('data-m'), t.getAttribute('data-who'));
  });
  document.addEventListener('submit', function (e) { if (e.target.id === 'bkForm') submit(e); });
  document.addEventListener('input', function (e) { if (e.target.getAttribute && e.target.getAttribute('aria-invalid')) e.target.removeAttribute('aria-invalid'); });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') { if (S.open) closeSheet(); else closeMenu(); }
    if (e.key === 'Tab' && S.open) {
      var f = $$('button:not([disabled]),a[href],input,textarea,[tabindex="0"]', sheet).filter(function (x) { return x.offsetParent !== null; });
      if (!f.length) return;
      var first = f[0], last = f[f.length - 1];
      if (e.shiftKey && (document.activeElement === first || document.activeElement === sheet || document.activeElement.id === 'bkT')) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  });

  /* ---------- menu, bar, tip ---------- */
  var mn, tbBtn;
  function closeMenu() { if (!mn || mn.hidden) return; mn.hidden = true; tbBtn.setAttribute('aria-expanded', 'false'); body.classList.remove('lock'); tbSync(); }
  function openMenu() { mn.hidden = false; tbBtn.setAttribute('aria-expanded', 'true'); body.classList.add('lock'); tbSync(); }
  function tbSync() { $('#tb').classList.toggle('dark', !mn.hidden || darkUnder()); }
  function darkUnder() {
    var y = 40, secs = $$('section[data-tone]');
    for (var i = 0; i < secs.length; i++) { var r = secs[i].getBoundingClientRect(); if (r.top <= y && r.bottom > y) return secs[i].getAttribute('data-tone') === 'dark'; }
    return false;
  }
  function onScroll() {
    tbSync();
    var br = $('#fauteuils').getBoundingClientRect();
    $('#cta').classList.toggle('off', S.open || (br.top < innerHeight * 0.5 && br.bottom > innerHeight * 0.3));
  }
  function observe() {
    if (!('IntersectionObserver' in window)) { document.documentElement.classList.add('no-io'); return; }
    if (!observe.io) observe.io = new IntersectionObserver(function (es) { es.forEach(function (x) { if (x.isIntersecting) { x.target.setAttribute('data-in', ''); observe.io.unobserve(x.target); } }); }, { threshold: .12, rootMargin: '0px 0px -6% 0px' });
    $$('[data-rv]:not([data-in])').forEach(function (n) { observe.io.observe(n); });
  }
  function refreshNext() {
    return LA.nextByBarber(['cl']).then(function (n) { NEXT = n || {}; paintChairs(); paintNext(); }).catch(function () { /* the page still works without it */ });
  }

  /* ---------- go ---------- */
  function init() {
    body = document.body; sheet = $('#sheet'); ov = $('#ov'); mn = $('#mn'); tbBtn = $('#tbBtn');
    paintPage();
    tbBtn.addEventListener('click', function () { mn.hidden ? openMenu() : closeMenu(); });
    $$('a', mn).forEach(function (a) { a.addEventListener('click', closeMenu); });
    var tip = $('#tip');
    if (!safe(function () { return sessionStorage.getItem('la-tip'); })) tip.hidden = false;
    var hideTip = function () { tip.hidden = true; safe(function () { sessionStorage.setItem('la-tip', '1'); }); };
    $('#tipX').addEventListener('click', hideTip);
    $('#tipGo').addEventListener('click', function () { hideTip(); var f = $('#fauteuils'); f.scrollIntoView({ behavior: 'smooth', block: 'start' }); });
    addEventListener('scroll', onScroll, { passive: true }); addEventListener('resize', onScroll);
    onScroll(); observe();
    refreshNext();
  }
  LA.init().then(function (r) {
    if (r.demo) document.body.classList.add('is-demo');
    init();
  });
})();
