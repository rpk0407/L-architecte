(function () {
  var $ = function (id) { return document.getElementById(id); };
  var NB = LA.NB;
  var S = { svc: null, day: null, m: null, barber: null, hold: null, avail: null, tab: 'jkut', exp: 0, timer: null, busy: false };
  var ROWS = []; for (var r = 540; r <= 1080; r += 30) ROWS.push(r);
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function longDay(s) { var d = LA.parseDay(s); return LA.DAYS[d.getDay()] + ' ' + d.getDate() + ' ' + LA.MONTHS[d.getMonth()]; }
  function dur(n) { return n >= 60 ? Math.floor(n / 60) + ' h' + (n % 60 ? ' ' + (n % 60) : '') : n + ' min'; }

  /* ---------- static sections ---------- */
  function renderStatic() {
    var cats = [['coupes', 'Coupes'], ['look', 'Changer de tête'], ['barbe', 'Barbe']], h = '';
    cats.forEach(function (c, i) {
      h += '<div><h3><span>' + c[1] + '</span><span>0' + (i + 1) + '</span></h3>';
      LA.services().filter(function (s) { return s.cat === c[0]; }).forEach(function (s) {
        h += '<div class="row"><div class="l">' + esc(s.name) + '<span class="du">' + dur(s.dur) + '</span><small>' + esc((s.note ? s.note + ' ' : '') + s.inc.join(' · ')) + '</small></div><span class="d"></span><b>' + LA.eur(s.price, s.from) + '</b></div>';
      });
      h += '</div>';
    });
    $('carteg').innerHTML = h;
    var ch = '';
    LA.barbers().forEach(function (b, i) {
      ch += '<article class="chair"><span class="no" aria-hidden="true">' + (i + 1) + '</span><span class="ini" aria-hidden="true">' + b.initials + '</span><h3>' + esc(b.name) + '</h3><p>' + esc(b.line) + '</p><div class="nx" data-nx="' + b.id + '">Prochain créneau…</div><button class="btn ghost" type="button" data-pick="' + b.id + '">Réserver avec ' + esc(b.name) + '</button></article>';
    });
    $('chairs').innerHTML = ch;
    var t = new Date().getDay(), rows = [[2, 'Mardi'], [3, 'Mercredi'], [4, 'Jeudi'], [5, 'Vendredi'], [6, 'Samedi'], [0, 'Dimanche'], [1, 'Lundi']], hh = '';
    rows.forEach(function (x) { var op = x[0] >= 2; hh += '<tr' + (x[0] === t ? ' class="today"' : '') + '><td>' + x[1] + '</td><td>' + (op ? '9 h – 18 h 30' : 'Fermé') + '</td></tr>'; });
    $('hours').firstChild.innerHTML = hh;
    var f = '', last = '';
    LA.services().forEach(function (s) {
      var c = s.cat;
      if (c !== last) { f += '<div class="cat">' + ({ coupes: 'Coupes', look: 'Changer de tête', barbe: 'Barbe seule' })[c] + '</div>'; last = c; }
      f += '<button type="button" class="fm" aria-pressed="false" data-svc="' + s.id + '">' + (s.tag ? '<span class="tg">' + esc(s.tag) + '</span>' : '') + '<span class="nm">' + esc(s.name) + '</span><span class="pr"><b>' + LA.eur(s.price, s.from) + '</b><span>' + dur(s.dur) + '</span></span></button>';
    });
    $('formules').innerHTML = f;
  }
  function liveState() {
    var o = LA.openNow(); $('dot').className = 'dot' + (o ? '' : ' off'); $('livet').textContent = o ? 'Ouvert maintenant' : 'Fermé · rouvre mar. 9 h';
  }

  /* ---------- state -> UI ---------- */
  function lock(id, on) { $(id).classList.toggle('locked', !!on); }
  function fiche() {
    var s = S.svc ? LA.service(S.svc) : null, b = S.barber ? LA.barber(S.barber) : null;
    function set(id, v) { var e = $(id); e.textContent = v || (id === 'f-svc' ? 'à choisir' : '—'); e.classList.toggle('na', !v); }
    set('f-svc', s && s.name); set('f-bar', b && b.name);
    set('f-when', S.day && S.m != null ? LA.dayLabel(S.day).replace(/^./, function (c) { return c.toLowerCase(); }) + ' · ' + LA.hhmm(S.m) : '');
    set('f-dur', s && dur(s.dur));
    $('f-tot').textContent = s ? LA.eur(s.price, s.from) : '—';
    $('fno').textContent = S.m != null ? 'N°' + String(S.m / 30).replace('.', '') + '·' + (S.barber || '').slice(0, 2).toUpperCase() : 'N°—';
    var cta = $('cta'), step = !s ? 1 : S.m == null ? 2 : 3, lab;
    if (step === 1) lab = 'Choisis une formule'; else if (step === 2) lab = 'Touche un créneau libre'; else lab = 'Confirmer mon rendez-vous';
    cta.textContent = lab; cta.disabled = step < 3;
    $('mcta').textContent = step < 3 ? 'Choisir' : 'Confirmer';
    $('mt').innerHTML = '<b>' + (s ? esc(s.name) + ' · ' + LA.eur(s.price, s.from) : 'Réserve ta place') + '</b>' + (step === 3 ? esc(b.name) + ' · ' + LA.dayLabel(S.day).toLowerCase() + ' ' + LA.hhmmShort(S.m) : step === 2 ? 'Touche un créneau libre' : 'Choisis une formule');
    $('st1').textContent = s ? s.name : 'à choisir';
    $('st2').textContent = S.m != null ? b.name + ' · ' + LA.hhmmShort(S.m) : s ? 'touche un point vert' : 'choisis une formule';
    $('st3').textContent = S.m != null ? 'dernière étape' : 'après le créneau';
    lock('s2', !s); lock('s3', S.m == null || !S.hold);
  }
  function holdTimer() {
    clearInterval(S.timer); var h = $('hold');
    if (!S.hold) { h.hidden = true; return; }
    function tick() { var left = Math.max(0, Math.round((S.exp - Date.now()) / 1000)); h.hidden = false; h.textContent = 'Créneau gardé pour toi · ' + Math.floor(left / 60) + ':' + ('0' + left % 60).slice(-2);
      if (!left) { clearInterval(S.timer); toast('Ton créneau a expiré, choisis-en un autre.'); drop(true); } }
    tick(); S.timer = setInterval(tick, 1000);
  }
  function toast(msg) { var e = $('gridwrap'); var d = document.createElement('div'); d.className = 'err'; d.setAttribute('role', 'alert'); d.style.marginBottom = '10px'; d.textContent = msg; e.parentNode.insertBefore(d, e); setTimeout(function () { d.remove(); }, 6000); }
  function drop(refresh) { var old = S.hold; S.hold = null; S.m = null; S.barber = null; if (old) LA.release(old); holdTimer(); fiche(); if (refresh) loadDays(true); else renderGrid(); }

  /* ---------- days + grid ---------- */
  function loadDays(keep) {
    if (!S.svc) return;
    $('gridwrap').innerHTML = '<div class="empty">Lecture du planning…</div>';
    LA.availability([S.svc], 'any', LA.iso(new Date()), 10).then(function (days) {
      S.avail = days;
      var cur = days.filter(function (d) { return d.day === S.day; })[0];
      if (!keep || !cur || !cur.open) { var f = days.filter(function (d) { return d.open && d.slots.length; })[0]; S.day = f ? f.day : (days[0] && days[0].day); }
      renderDays(); renderGrid();
    }).catch(function () { $('gridwrap').innerHTML = '<div class="empty">Le planning ne répond pas. Réessaie dans un instant ou écris-nous.</div>'; });
  }
  function renderDays() {
    var h = '';
    S.avail.forEach(function (d) {
      var sd = LA.dayShort(d.day), n = d.slots.length, ok = d.open && n > 0;
      h += '<button type="button" class="dy" data-day="' + d.day + '" aria-pressed="' + (d.day === S.day) + '"' + (ok ? '' : ' disabled') + ' aria-label="' + longDay(d.day) + (ok ? ', ' + n + ' créneaux libres' : (d.open ? ', complet' : ', fermé')) + '"><span class="dw">' + sd.dow + '</span><span class="dn">' + sd.n + '</span><span class="fr">' + (ok ? n + ' libres' : d.open ? 'complet' : 'fermé') + '</span></button>';
    });
    $('days').innerHTML = h;
  }
  function renderGrid() {
    var d = S.avail && S.avail.filter(function (x) { return x.day === S.day; })[0];
    if (!d) return;
    var free = {}, cnt = {}; LA.barbers().forEach(function (b) { cnt[b.id] = 0; });
    d.slots.forEach(function (s) { free[s.s + '|' + s.m] = 1; cnt[s.s] = (cnt[s.s] || 0) + 1; });
    var tabsH = '';
    LA.barbers().forEach(function (b) { tabsH += '<button type="button" role="tab" data-tab="' + b.id + '" aria-selected="' + (S.tab === b.id) + '">' + esc(b.name) + '<small>' + cnt[b.id] + ' libres</small></button>'; });
    $('tabs').innerHTML = tabsH;
    if (!d.open || !d.slots.length) { $('gridwrap').innerHTML = '<div class="empty">' + (d.open ? 'Complet ce jour-là. Choisis un autre jour au-dessus.' : 'Le salon est fermé ce jour-là.') + '</div>'; $('dim').innerHTML = ''; return; }
    var now = new Date(), isToday = S.day === LA.iso(now), nowM = now.getHours() * 60 + now.getMinutes();
    var h = '<div class="grid" data-show="' + S.tab + '" role="group" aria-label="Planning du ' + longDay(S.day) + '"><div class="gh" aria-hidden="true"><span class="ch">Heure</span></div>';
    LA.barbers().forEach(function (b, i) { h += '<div class="gh" data-b="' + b.id + '"><span class="ch">Fauteuil ' + (i + 1) + '</span><span class="bn">' + esc(b.name) + '</span><span class="ct">' + cnt[b.id] + ' libres</span></div>'; });
    ROWS.forEach(function (m) {
      var hr = m % 60 === 0;
      h += '<div class="gt' + (hr ? ' hr' : '') + '">' + LA.hhmmShort(m) + '</div>';
      LA.barbers().forEach(function (b) {
        var isF = free[b.id + '|' + m], sel = S.barber === b.id && S.m === m && S.day === d.day, t = LA.hhmmShort(m);
        if (isF) h += '<button type="button" class="gc free' + (hr ? ' hr' : '') + (sel ? ' sel' : '') + '" data-b="' + b.id + '" data-m="' + m + '" data-t="' + t + '" aria-label="' + esc(b.name) + ', ' + longDay(d.day) + ', ' + LA.hhmm(m) + ', libre" aria-pressed="' + sel + '"></button>';
        else h += '<div class="gc t' + (hr ? ' hr' : '') + '" data-b="' + b.id + '" aria-hidden="true" title="' + (isToday && m < nowM ? 'Passé' : 'Pris') + '"></div>';
      });
    });
    h += '</div>';
    $('gridwrap').innerHTML = h;
    $('dim').textContent = longDay(S.day) + ' · 9 h – 18 h 30 · ' + dur(LA.service(S.svc).dur) + ' le rendez-vous';
  }

  /* ---------- actions ---------- */
  function pickService(id) {
    if (S.hold) drop(false);
    S.svc = id;
    Array.prototype.forEach.call(document.querySelectorAll('.fm'), function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-svc') === id)); });
    fiche(); loadDays(true);
    setTimeout(function () { $('s2').scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 60);
  }
  function pickSlot(b, m, quiet) {
    if (S.busy) return; S.busy = true;
    LA.hold([S.svc], b, S.day, m, S.hold).then(function (h) {
      S.hold = h.holdId; S.exp = h.exp; S.barber = b; S.m = m; S.busy = false;
      holdTimer(); fiche(); renderGrid();
      if (!quiet) setTimeout(function () { $('s3').scrollIntoView({ behavior: 'smooth', block: 'start' }); setTimeout(function () { $('fn').focus({ preventScroll: true }); }, 400); }, 60);
    }).catch(function (e) {
      S.busy = false; S.hold = null; S.m = null; S.barber = null; holdTimer(); fiche();
      toast(e && e.code === 'taken' ? 'Ce créneau vient d’être pris. Ton choix de formule est gardé, prends-en un autre.' : (e && e.message) || 'Impossible de garder ce créneau.');
      loadDays(true);
    });
  }
  function firstFree() {
    var d = S.avail && S.avail.filter(function (x) { return x.open && x.slots.length; })[0]; if (!d) return;
    S.day = d.day; var s = d.slots[0]; S.tab = s.s; renderDays(); renderGrid(); pickSlot(s.s, s.m, true);
  }
  function showErr(m) { var e = $('err'); e.textContent = m; e.hidden = false; e.scrollIntoView({ block: 'nearest' }); }
  function submit(ev) {
    if (ev) ev.preventDefault();
    var fn = $('fn').value.trim(), ph = $('ph').value.trim(), em = $('em').value.trim();
    $('err').hidden = true;
    if (fn.length < 2) { showErr('Indique ton prénom.'); $('fn').focus(); return; }
    if (ph.replace(/\D/g, '').length < 9) { showErr('Indique un numéro de téléphone valide, pour le SMS de confirmation.'); $('ph').focus(); return; }
    if (em && !/^\S+@\S+\.\S+$/.test(em)) { showErr('Cette adresse e-mail n’a pas l’air complète.'); $('em').focus(); return; }
    var btn = $('send'); btn.disabled = true; btn.textContent = 'Réservation…';
    var p = { ids: [S.svc], staff: S.barber, day: S.day, m: S.m, holdId: S.hold, first: fn, last: $('ln').value.trim(), phone: ph, email: em, sms: $('sms').checked, marketing: $('mk').checked };
    LA.book(p).then(function (res) { done(p, res); }).catch(function (e) {
      btn.disabled = false; btn.textContent = 'Confirmer mon rendez-vous';
      if (e && (e.code === 'taken' || e.status === 409)) { S.hold = null; S.m = null; S.barber = null; holdTimer(); fiche(); toast((e.message || 'Ce créneau vient d’être pris.') + ' Tes choix sont gardés.'); loadDays(true); $('s2').scrollIntoView({ behavior: 'smooth' }); }
      else showErr((e && e.message) || 'La réservation a échoué. Réessaie ou appelle le salon.');
    });
  }
  function done(p, res) {
    clearInterval(S.timer); S.hold = null;
    var s = LA.service(p.svc || p.ids[0]), b = LA.barber(p.staff), ics = LA.ics({ day: p.day, m: p.m, ids: p.ids, code: res.code });
    var dep = res.deposit > 0 ? '<li><i>€</i><span>Un acompte de <b>' + LA.eur(res.deposit / 100) + '</b> est demandé : règle-le depuis le lien de ton rendez-vous pour valider la place.</span></li>' : '';
    var h = '<div class="ok" role="status" tabindex="-1" id="okbox"><span class="stamp">Réservé</span><h3>C’est noté, ' + esc(p.first) + '.</h3>' +
      '<p style="font-size:22px;margin:0">' + esc(s.name) + ' avec <b>' + esc(b.name) + '</b><br>' + esc(longDay(p.day)) + ' à <b>' + LA.hhmm(p.m) + '</b> · ' + LA.eur(s.price, s.from) + ' à régler au salon</p>' +
      '<ul>' + dep +
      '<li><i>1</i><span><b>Confirmation par SMS</b> envoyée au ' + esc(p.phone) + (p.sms ? '' : ' (désactivée sur ta demande)') + '.</span></li>' +
      '<li><i>2</i><span><b>Confirmation par e-mail</b> ' + (p.email ? 'envoyée à ' + esc(p.email) + ', avec le rendez-vous à ajouter à ton agenda.' : 'si tu laisses une adresse (tu peux le faire au prochain rendez-vous).') + '</span></li>' +
      '<li><i>3</i><span><b>Rappel par SMS la veille à 18 h</b>, avec le lien pour déplacer ou annuler.</span></li></ul>' +
      '<p class="mono" style="color:var(--ink2)">Réf. ' + esc(res.code || '') + (res.demo ? ' · démo, rien n’a été envoyé' : '') + '</p>' +
      '<div style="display:flex;gap:12px;flex-wrap:wrap;margin-top:18px"><a class="btn" href="' + ics + '" download="rendez-vous-larchitecte.ics">Ajouter à mon agenda</a>' +
      (res.manage && res.manage !== '#' ? '<a class="btn ghost" href="' + esc(res.manage) + '">Déplacer ou annuler</a>' : '') +
      '<a class="btn ghost" href="https://www.google.com/maps/search/?api=1&amp;query=L%27Architecte%20coiffeur&amp;query_place_id=ChIJJSWkBLy_yRIRbgAQcMwb-JY" target="_blank" rel="noopener">Itinéraire ↗</a></div></div>';
    document.querySelector('#reserver .book').hidden = true; $('mbar').hidden = true;
    var d = $('done'); d.innerHTML = h; d.hidden = false;
    d.scrollIntoView({ behavior: 'smooth', block: 'start' }); setTimeout(function () { $('okbox').focus({ preventScroll: true }); }, 300);
  }

  /* ---------- wiring ---------- */
  document.addEventListener('click', function (e) {
    var t = e.target.closest('[data-svc],[data-day],[data-m],[data-tab],[data-pick]'); if (!t) return;
    if (t.hasAttribute('data-svc')) pickService(t.getAttribute('data-svc'));
    else if (t.hasAttribute('data-day')) { if (S.hold) drop(false); S.day = t.getAttribute('data-day'); renderDays(); renderGrid(); }
    else if (t.hasAttribute('data-tab')) { S.tab = t.getAttribute('data-tab'); renderGrid(); }
    else if (t.hasAttribute('data-m')) { S.tab = t.getAttribute('data-b'); pickSlot(t.getAttribute('data-b'), +t.getAttribute('data-m')); }
    else if (t.hasAttribute('data-pick')) { S.tab = t.getAttribute('data-pick'); $('reserver').scrollIntoView({ behavior: 'smooth' }); if (S.svc) renderGrid(); else toast2(); }
  });
  function toast2() { /* chairs buttons: remember barber for the grid tab, ask for a formule first */ }
  $('first').addEventListener('click', firstFree);
  $('form').addEventListener('submit', submit);
  function advance() { if (S.m != null && S.hold) submit(); }
  $('cta').addEventListener('click', function () { if (S.m != null) { $('s3').scrollIntoView({ behavior: 'smooth' }); $('fn').focus({ preventScroll: true }); } });
  $('mcta').addEventListener('click', function () { if (S.m != null) { $('s3').scrollIntoView({ behavior: 'smooth' }); $('fn').focus({ preventScroll: true }); } else document.querySelector(S.svc ? '#s2' : '#s1').scrollIntoView({ behavior: 'smooth' }); });
  $('mcta').disabled = false;
  window.addEventListener('beforeunload', function () { if (S.hold) LA.release(S.hold); });

  /* ---------- boot ---------- */
  renderStatic(); liveState(); fiche();
  $('mcta').disabled = false; $('mcta').textContent = 'Choisir';
  LA.init().then(function (r) {
    if (r.demo) $('demobar').hidden = false;
    LA.nextByBarber(['cl']).then(function (n) {
      LA.barbers().forEach(function (b) { var e = document.querySelector('[data-nx="' + b.id + '"]'); if (!e) return; var x = n[b.id]; e.textContent = x ? 'Libre · ' + LA.dayLabel(x.day).toLowerCase() + ' ' + LA.hhmmShort(x.m) : 'Complet cette quinzaine'; });
    }).catch(function () {});
  });
})();
