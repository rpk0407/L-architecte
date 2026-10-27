/* « Résilier mon abonnement », reachable without an account (Code de la consommation L.215-1-1): a number or an address
   in, the member's page by SMS and e-mail to what the file holds (POST /api/public/memberships/lookup, PAY-03); the
   answer is the same whether a membership exists or not. Without either: first name + the subscription's e-mail
   (POST /api/public/memberships/cancel-request), recorded at once, its time said on screen. */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var form = $('rs'), input = $('rs-v'), err = $('rs-e'), btn = $('rs-b');
  var form2 = $('rs2'), err2 = $('rs2-e'), btn2 = $('rs2-b');
  var done = $('rs-done'), msg = $('rs-m'), lost = $('rs-lost');
  var EMAIL = /^[^@\s]{1,64}@[^@\s]{1,190}\.[^@\s]{2,}$/;

  function digits(v) { var d = String(v || '').replace(/[^\d+]/g, ''); if (d.indexOf('00') === 0) d = '+' + d.slice(2); if (d.indexOf('+33') === 0) d = '0' + d.slice(3); return d; }
  function isPhone(v) { var d = digits(v); return !/@/.test(v) && (/^0[1-9]\d{8}$/.test(d) || /^\+\d{8,15}$/.test(d)); }
  function me() { try { return JSON.parse(localStorage.getItem('lx-me') || 'null') || {}; } catch (e) { return {}; } }
  function say(el, t, field) { el.textContent = t || ''; el.hidden = !t; if (field) field.setAttribute('aria-invalid', t ? 'true' : 'false'); }
  function post(path, body) {
    return fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), cache: 'no-store', credentials: 'same-origin' })
      .then(function (r) { return r.json().catch(function () { return null; }).then(function (d) { return { ok: r.ok, d: d }; }); });
  }
  function show(text, note) {
    msg.textContent = text;
    $('rs-n').hidden = !note;
    form.hidden = true; form2.hidden = true; done.hidden = false;
    done.focus();
  }

  // what this phone typed on the site (the subscribe sheet keeps it, see /confidentialite)
  var mine = me();
  if (!input.value) input.value = mine.email || mine.phone || '';
  input.addEventListener('input', function () { if (!err.hidden) say(err, '', input); });

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    if (btn.disabled) return;
    var v = input.value.trim();
    var body = isPhone(v) ? { phone: v } : EMAIL.test(v.toLowerCase()) ? { email: v.toLowerCase() } : null;
    if (!body) { say(err, v ? 'Vérifie : un numéro comme 06 12 34 56 78, ou un e-mail comme toi@exemple.fr.' : 'Donne ton numéro ou ton e-mail.', input); input.focus(); return; }
    say(err, '', input);
    btn.disabled = true; btn.textContent = 'Envoi…';
    post('/api/public/memberships/lookup', body).then(function (x) {
      if (x.ok && x.d && x.d.ok) show(x.d.message, true);
      else say(err, (x.d && x.d.error && x.d.error.message) || 'Ça n’a pas marché. Réessaie dans un instant.');
    }).catch(function () { say(err, 'Pas de connexion. Réessaie dans un instant.'); }).then(function () { btn.disabled = false; btn.textContent = 'Recevoir mon lien'; });
  });

  lost.addEventListener('click', function () {
    form.hidden = true; form2.hidden = false; lost.setAttribute('aria-expanded', 'true');
    var v = input.value.trim();
    if (EMAIL.test(v.toLowerCase()) && !$('rs2-m').value) $('rs2-m').value = v;
    if (mine.first && !$('rs2-f').value) $('rs2-f').value = mine.first;
    $('rs2-f').focus();
  });
  $('rs2-x').addEventListener('click', function () { form2.hidden = true; form.hidden = false; lost.setAttribute('aria-expanded', 'false'); lost.focus(); });
  form2.addEventListener('submit', function (e) {
    e.preventDefault();
    if (btn2.disabled) return;
    var first = $('rs2-f').value.trim(), email = $('rs2-m').value.trim().toLowerCase(), reply = $('rs2-r').value.trim().toLowerCase();
    if (!first) { say(err2, 'Indique ton prénom.', $('rs2-f')); $('rs2-f').focus(); return; }
    if (!EMAIL.test(email)) { say(err2, 'Indique l’e-mail de ton abonnement.', $('rs2-m')); $('rs2-m').focus(); return; }
    if (reply && !EMAIL.test(reply)) { say(err2, 'Vérifie l’e-mail où te répondre.', $('rs2-r')); $('rs2-r').focus(); return; }
    say(err2, '');
    btn2.disabled = true; btn2.textContent = 'Envoi…';
    post('/api/public/memberships/cancel-request', reply ? { first: first, email: email, replyTo: reply } : { first: first, email: email }).then(function (x) {
      if (x.ok && x.d && x.d.ok) show(x.d.message, false);
      else say(err2, (x.d && x.d.error && x.d.error.message) || 'Ça n’a pas marché. Réessaie dans un instant.');
    }).catch(function () { say(err2, 'Pas de connexion. Réessaie dans un instant.'); }).then(function () { btn2.disabled = false; btn2.textContent = 'Envoyer ma demande de résiliation'; });
  });
  $('rs-again').addEventListener('click', function () { done.hidden = true; form.hidden = false; input.focus(); });

  // signed in to the space: it holds the membership, so it comes first; the demo says what it is
  fetch('/api/public/account', { credentials: 'same-origin', cache: 'no-store' }).then(function (r) { return r.ok ? r.json() : null; }).then(function (a) {
    if (a && a.enabled && a.signedIn) $('rs-space').hidden = false;
    var d = document.querySelector('[data-demo]');
    if (a && a.demo && d) d.hidden = false;
    // the demo never asks for real details: an identity of its own, as the site's sheets do (erased 2 h after use)
    if (a && a.demo && !input.value) { var n = String(Math.floor(Math.random() * 9000) + 1000); input.value = 'demo+' + n.slice(0, 2) + '@exemple.fr'; }
  }).catch(function () { /* the forms work without it */ });
})();
