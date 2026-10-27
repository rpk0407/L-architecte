/* The site's two forms, /contact and /formations: one request to POST /api/public/inquiries (server/http/routes-inquiries.js),
   which lands in the Comptoir (Relances › Demandes) and e-mails the owner. On /formations, the modules, the sessions to
   come and the certificates come from /api/public/trainings (fixed content: the defaults in server/settings/trainings.js,
   or what an older journal wrote); the page's own text is the fallback.
     form[data-inquiry="contact|formation"]  the form; [data-inquiry-done] the confirmation shown in its place
     [data-trainings]                        the module list, rebuilt from the salon's answer
   What the booking sheet remembers on this phone (lx-me: first name, number, e-mail) fills the fields in.
   Everything goes in through textContent, never as HTML. */
(function () {
  'use strict';
  var NB = ' ';
  var DAYS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
  var MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
  var MAX = 1000;

  function $(sel, root) { return (root || document).querySelector(sel); }
  function each(sel, fn, root) { var l = (root || document).querySelectorAll(sel); for (var i = 0; i < l.length; i++) fn(l[i], i); }
  function h(tag, attrs, kids) {
    var el = document.createElement(tag);
    for (var k in attrs) if (Object.prototype.hasOwnProperty.call(attrs, k) && attrs[k] != null) el.setAttribute(k, attrs[k]);
    (kids || []).forEach(function (c) { if (c != null) el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return el;
  }
  function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); }
  function eur(c) { var e = Math.round(Number(c) || 0) / 100; return (e % 1 ? e.toFixed(2).replace('.', ',') : String(e)) + NB + '€'; }
  function dayLong(k) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(k || '');
    if (!m) return '';
    var wd = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])).getUTCDay();
    return DAYS[wd] + ' ' + Number(m[3]) + (m[3] === '01' ? 'er' : '') + ' ' + MONTHS[+m[2] - 1];
  }
  // as server/lib/util.js normPhone reads it: 06…, +33 6…, 0033 6…, or another country's +…
  function digits(v) { var d = String(v || '').replace(/[^\d+]/g, ''); if (d.indexOf('00') === 0) d = '+' + d.slice(2); if (d.indexOf('+33') === 0) d = '0' + d.slice(3); return d; }
  function phoneOk(v) { var d = digits(v); return /^0[1-9]\d{8}$/.test(d) || /^\+\d{8,15}$/.test(d); }
  function pretty(v) { var d = digits(v); return /^0\d{9}$/.test(d) ? d.replace(/(\d{2})(?=\d)/g, '$1 ') : String(v || '').trim(); }
  function mailOk(v) { return /^[^@\s]{1,64}@[^@\s]{1,190}\.[^@\s]{2,}$/.test(String(v || '').trim()); }
  function me() { try { return JSON.parse(localStorage.getItem('lx-me') || 'null') || {}; } catch (e) { return {}; } }

  /* ---------------- /formations: the modules from the salon ---------------- */

  function sessionsWords(list) {
    return list.slice(0, 4).map(function (x) {
      var d = dayLong(x.date);
      return d.charAt(0).toUpperCase() + d.slice(1) + ' · ' + (x.seats > 0 ? x.seats + ' place' + (x.seats > 1 ? 's' : '') : 'complet');
    });
  }
  function moduleCard(m, i) {
    var facts = [];
    if (m.duration) facts.push(h('div', {}, [h('dt', {}, ['Durée']), h('dd', {}, [m.duration])]));
    facts.push(h('div', {}, [h('dt', {}, ['Tarif']), h('dd', {}, [m.price == null ? 'Sur devis' : eur(m.price)])]));
    var dates = sessionsWords(m.sessions || []);
    facts.push(h('div', {}, [h('dt', {}, ['Prochaines sessions']), h('dd', {}, dates.length ? [h('ul', { class: 'tr-dates' }, dates.map(function (t) { return h('li', {}, [t]); }))] : ['Sur demande, à la date qui t’arrange'])]));
    return h('article', { class: 'tr-mod', id: m.id, 'aria-labelledby': 'tm-' + m.id }, [
      h('span', { class: 'tr-n', 'aria-hidden': 'true' }, [String(i + 1).padStart(2, '0')]),
      h('h2', { id: 'tm-' + m.id }, [m.title]),
      m.points && m.points.length ? h('ul', { class: 'tr-pts' }, m.points.map(function (p) { return h('li', {}, [p]); })) : null,
      h('dl', { class: 'tr-facts' }, facts),
      h('a', { class: 'btn ghost tr-ask', href: '#demande', 'data-module': m.id }, ['Je suis intéressé'])
    ]);
  }
  function trainings(t) {
    var list = $('[data-trainings]');
    if (!list || !t || !Array.isArray(t.modules)) return;
    // the owner's text, even emptied (then the paragraph goes): never the old site's words left behind
    if (typeof t.intro === 'string') each('[data-tr="intro"]', function (el) { el.textContent = t.intro; el.hidden = !t.intro.trim(); });
    clear(list);
    t.modules.forEach(function (m, i) { list.appendChild(moduleCard(m, i)); });
    each('[data-tr="toc"]', function (nav) {
      clear(nav);
      t.modules.forEach(function (m) { nav.appendChild(h('a', { href: '#' + m.id }, [m.title])); });
      nav.hidden = !t.modules.length;
    });
    each('select[name="module"]', function (sel) {
      var keep = sel.value;
      clear(sel);
      sel.appendChild(h('option', { value: '' }, ['Je ne sais pas encore']));
      t.modules.forEach(function (m) { sel.appendChild(h('option', { value: m.id }, [m.title])); });
      sel.value = t.modules.some(function (m) { return m.id === keep; }) ? keep : '';
    });
    each('[data-tr="nda"]', function (el) { el.textContent = t.nda || ''; });
    each('[data-tr-if="nda"]', function (el) { el.hidden = !t.nda; });
    each('[data-tr="qualiopi"]', function (el) { el.textContent = t.qualiopi || ''; });
    // the CPF pays only Qualiopi-certified training: never promised without the certificate
    each('[data-tr-if="cpf"]', function (el) { el.hidden = !t.cpf; });
    each('[data-tr-unless="cpf"]', function (el) { el.hidden = !!t.cpf; });
  }
  function pick(id) {
    var sel = $('select[name="module"]');
    if (sel && id && [].some.call(sel.options, function (o) { return o.value === id; })) sel.value = id;
  }
  document.addEventListener('click', function (e) {
    var a = e.target && e.target.closest ? e.target.closest('a[data-module]') : null;
    if (!a) return;
    e.preventDefault();
    pick(a.getAttribute('data-module'));
    var form = $('#demande');
    if (form) { form.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' }); }
    var first = $('form[data-inquiry] input[name="first"]');
    if (first) setTimeout(function () { first.focus({ preventScroll: true }); }, 350);
  });

  /* ---------------- the form ---------------- */

  function form(f) {
    var kind = f.getAttribute('data-inquiry');
    var done = $('[data-inquiry-done]');
    var btn = $('button[type="submit"]', f);
    var label = btn ? btn.textContent : '';
    var err = $('[data-err]', f);
    var count = $('[data-count]', f);
    var field = function (n) { return f.elements.namedItem(n); };
    var mine = me();
    if (mine.first && !field('first').value) field('first').value = String(mine.first).split(' ')[0];
    if (mine.phone && !field('phone').value) field('phone').value = pretty(mine.phone);
    if (mine.email && field('email') && !field('email').value) field('email').value = mine.email;

    function mark(name) { each('[aria-invalid="true"]', function (el) { el.setAttribute('aria-invalid', 'false'); }, f); if (name && field(name)) field(name).setAttribute('aria-invalid', 'true'); }
    function say(t, name) {
      err.textContent = t || ''; err.hidden = !t; mark(t ? name : null);
      if (t && name && field(name) && field(name).focus) field(name).focus();
    }
    function busy(on) { if (btn) { btn.disabled = on; btn.textContent = on ? 'Envoi…' : label; } }
    function counter() { if (count) { var n = field('message').value.length; count.textContent = n > MAX - 200 ? n + ' / ' + MAX : ''; } }
    field('message').addEventListener('input', counter);
    f.addEventListener('input', function () { if (!err.hidden) say(''); });
    field('phone').addEventListener('blur', function () { if (phoneOk(this.value)) this.value = pretty(this.value); });

    f.addEventListener('submit', function (e) {
      e.preventDefault();
      if (btn && btn.disabled) return;
      var v = { kind: kind, first: field('first').value.trim(), phone: field('phone').value.trim(), email: field('email') ? field('email').value.trim() : '', module: field('module') ? field('module').value : '', message: field('message').value.trim(), website: field('website') ? field('website').value : '' };
      if (!v.first) return say('Donne ton prénom.', 'first');
      if (v.phone && !phoneOk(v.phone)) return say('Vérifie ton numéro : 10 chiffres, comme 06 12 34 56 78.', 'phone');
      if (!v.phone && !v.email) return say('Laisse un numéro ou un e-mail, qu’on puisse te répondre.', 'phone');
      if (v.email && !mailOk(v.email)) return say('Vérifie ton e-mail : il manque quelque chose (comme prenom@exemple.fr).', 'email');
      if (kind === 'contact' && v.message.length < 2) return say('Écris ton message.', 'message');
      if (v.message.length > MAX) return say('Ton message : ' + MAX + ' caractères au plus.', 'message');
      say('');
      busy(true);
      fetch('/api/public/inquiries', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(v), cache: 'no-store' })
        .then(function (r) { return r.json().catch(function () { return null; }).then(function (d) { return { ok: r.ok, d: d }; }); })
        .then(function (x) {
          if (x.ok && x.d && x.d.ok) {
            each('[data-done-first]', function (el) { el.textContent = v.first.split(' ')[0]; });
            f.hidden = true;
            if (done) { done.hidden = false; done.focus(); }
            return;
          }
          var e = x.d && x.d.error;
          say((e && e.message) || 'Ça n’a pas marché. Réessaie dans un instant, ou appelle le salon.', e && e.extra && e.extra.field);
        })
        .catch(function () { say('Pas de connexion. Réessaie dans un instant.'); })
        .then(function () { busy(false); });
    });
    each('[data-inquiry-again]', function (b) {
      b.addEventListener('click', function () { field('message').value = ''; counter(); if (done) done.hidden = true; f.hidden = false; field('message').focus(); });
    });
  }

  each('form[data-inquiry]', form);
  var list = $('[data-trainings]');
  if (list) {
    // /formations#barbe (an old address): that module is the one asked about, already with the page's own list
    pick((location.hash || '').slice(1));
    fetch('/api/public/trainings', { cache: 'no-store' }).then(function (r) { return r.ok ? r.json() : null; }).then(function (t) {
      trainings(t);
      pick((location.hash || '').slice(1));
      // the modules were rebuilt: an anchor from an old address (/formations#barbe) lands on its module again
      var target = location.hash && document.getElementById(location.hash.slice(1));
      if (target) target.scrollIntoView();
    }).catch(function () { /* keep the page's own text */ }).then(function () {
      document.documentElement.setAttribute('data-trainings-ready', '1');
    });
  }
})();
