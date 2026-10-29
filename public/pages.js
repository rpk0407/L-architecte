/* The site's static pages read the salon from /api/public/salon, so what the owner saves in
   Réglages › Le salon and › Réservation is what the mentions légales, the privacy page and the CGV say.
     data-f="path"        text of that value (shop.siret, cgvDate, cancelH, …); data-link="tel|mail|url" also sets href
     data-opt             a line hidden while every data-f inside it is empty
     data-if / data-unless="path"   shown when the value is set (not '', 0, false, 'none'), or when it is not
     data-list="services" the price list (data-list-note: shown with it);  data-list="plans" the membership's formules
     (/api/public/memberships, read only by a page that has such a list or a data-if on membership.*)
     data-footer  the shared footer (with « Mon espace » while the salon has the client space open);  data-forget  clears what the site keeps on this phone
   Without the API (offline, blocked), the text written in the page stays: the defaults.
   Everything goes in through textContent, never as HTML. */
(function () {
  'use strict';
  var MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
  var NB = ' ';

  function get(o, path) { return String(path).split('.').reduce(function (x, k) { return x == null ? undefined : x[k]; }, o); }
  function set(v) { return !(v == null || v === '' || v === 0 || v === false || v === 'none'); }
  function eur(c) { var e = Math.round(Number(c) || 0) / 100; return (e % 1 ? e.toFixed(2).replace('.', ',') : String(e)) + NB + '€'; }
  function dayLong(k) { var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(k || ''); return m ? Number(m[3]) + (m[3] === '01' ? 'er' : '') + ' ' + MONTHS[Number(m[2]) - 1] + ' ' + m[1] : ''; }
  // 512 923 475 00028, as on a Kbis; non-breaking spaces so a phone never wraps in the middle of a number
  function siret(s) { var d = String(s || '').replace(/\D/g, ''); return d.length === 14 ? [d.slice(0, 3), d.slice(3, 6), d.slice(6, 9), d.slice(9)].join(NB) : String(s || ''); }
  function phone(s) { var d = String(s || '').replace(/[^\d+]/g, ''); return /^0\d{9}$/.test(d) ? d.replace(/(\d{2})(?=\d)/g, '$1' + NB) : String(s || '').trim().replace(/ /g, NB); }
  function newer(a, b) { return String(a || '') > String(b || '') ? String(a || '') : String(b || ''); }
  function https(u) { return /^https:\/\/[^\s"'<>]+$/.test(String(u || '')) ? String(u) : ''; }
  function plain(u) { return String(u || '').replace(/^https:\/\/(www\.)?/, '').replace(/\/$/, ''); }

  /** What the pages show, from the salon's public answer (and its memberships' when the page asked for them). */
  function view(s, mb) {
    var sh = s.shop || {}, b = s.booking || {}, d = s.deposits || {};
    var editor = sh.legalName || sh.name || '';
    // the carnet is sold at the salon (not booked online): the memberships' answer names it
    var hasPack = function (x) { return x.pack && x.pack.credits; };
    var pack = (s.services || []).filter(hasPack)[0] || (mb && mb.carnet ? { name: mb.carnet.name, price: mb.carnet.price, pack: mb.carnet } : null);
    var live = !!(s.payments && s.payments.live);
    // as domain/policy.js depositFor counts it: on the booking's total, rounded to the euro, never more than the price
    var rule = '', of = d.percent + NB + '% du total (arrondi à l’euro, ' + eur(500) + ' au minimum, jamais plus que le prix)';
    if (d.mode === 'all') rule = 'Chaque réservation en ligne demande un acompte d’environ ' + of + '.';
    else if (d.mode === 'threshold') rule = 'Une réservation en ligne dont le total atteint ' + eur(d.thresholdCents) + ' demande un acompte d’environ ' + of + ' ; en dessous, aucun' + (d.riskBased ? ', sauf pour un client qui a déjà manqué un rendez-vous sans prévenir : le même acompte peut alors lui être demandé quel que soit le montant.' : '.');
    // the CGV in force: the salon's version, or this page's own text when it is newer (server/settings/shop.js CGV_TEXT)
    var cgv = newer(sh.cgvVersion, document.documentElement.getAttribute('data-cgv-text'));
    return {
      shop: sh, booking: b, deposits: d,
      editor: editor, brand: sh.legalName && sh.name && sh.legalName !== sh.name ? sh.name : '',
      address: [sh.address, [sh.zip, sh.city].filter(Boolean).join(' ')].filter(Boolean).join(', '),
      siret: siret(sh.siret), ape: String(sh.ape || '').toUpperCase(), phone: phone(sh.phone),
      host: sh.host || {}, mediator: { name: (sh.mediator || {}).name || '', url: https((sh.mediator || {}).url) },
      cgvDate: dayLong(cgv), cancelH: b.cancelUntilHours, maxDays: b.maxDaysAhead, sms: !!s.sms,
      depositRule: s.payments && s.payments.live === false ? '' : rule,
      // a fee is only announced once a card can really be kept for it (online payment live and card saving shipped)
      noShowFee: live && s.payments.cardOnFile === true && d.noShowFeeCents > 0 ? eur(d.noShowFeeCents) : '',
      pack: pack ? { name: pack.name, credits: pack.pack.credits, days: pack.pack.days, price: eur(pack.price) } : null,
      // the monthly membership's clauses show only while it is really sold online (live: on, a real or demo payment, plans)
      // terms: they stay while it is on or a contract still runs (its members' pages and mails link to them)
      membership: { live: !!(mb && mb.live && (mb.plans || []).length), terms: !!(mb && (mb.terms || mb.live)), cgv: mb && mb.cgv ? dayLong(mb.cgv) : '' }
    };
  }

  function fill(root, v) {
    each(root, '[data-f]', function (el) {
      var x = get(v, el.getAttribute('data-f'));
      var t = x == null ? '' : String(x);
      el.textContent = t;
      var kind = el.getAttribute('data-link');
      if (kind && el.tagName === 'A') {
        var href = kind === 'tel' ? (t ? 'tel:' + t.replace(/[^\d+]/g, '') : '') : kind === 'mail' ? (/^[^\s@<>"]+@[^\s@<>"]+$/.test(t) ? 'mailto:' + t : '') : https(t);
        if (href) el.setAttribute('href', href); else el.removeAttribute('href');
        if (kind === 'url' && href) el.textContent = plain(href);
      }
    });
    each(root, '[data-opt]', function (el) {
      var fs = el.querySelectorAll('[data-f]'), any = false;
      for (var i = 0; i < fs.length; i++) if (fs[i].textContent.trim()) any = true;
      el.hidden = !any;
    });
    each(root, '[data-if]', function (el) { el.hidden = !set(get(v, el.getAttribute('data-if'))); });
    each(root, '[data-unless]', function (el) { el.hidden = set(get(v, el.getAttribute('data-unless'))); });
  }
  function each(root, sel, fn) { var l = root.querySelectorAll(sel); for (var i = 0; i < l.length; i++) fn(l[i]); }
  function h(tag, attrs, kids) {
    var el = document.createElement(tag);
    for (var k in attrs) if (Object.prototype.hasOwnProperty.call(attrs, k)) el.setAttribute(k, attrs[k]);
    (kids || []).forEach(function (c) { el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return el;
  }

  function prices(s) {
    each(document, '[data-list="services"]', function (body) {
      var list = (s.services || []).slice().sort(function (a, b) { return (a.order || 0) - (b.order || 0); });
      while (body.firstChild) body.removeChild(body.firstChild);
      list.forEach(function (x) {
        var dur = x.dur >= 60 ? Math.floor(x.dur / 60) + NB + 'h' + (x.dur % 60 ? NB + (x.dur % 60 < 10 ? '0' : '') + (x.dur % 60) : '') : x.dur + NB + 'min';
        body.appendChild(h('tr', {}, [h('td', {}, [x.name, ' ', h('span', { class: 'd' }, ['· ' + dur])]), h('td', {}, [(x.from ? 'dès ' : '') + eur(x.price)])]));
      });
      var table = body.closest('table');
      if (table) table.hidden = !list.length;
    });
    // the public answer lists only what books online: the page says so rather than pass it off as the whole menu
    each(document, '[data-list-note]', function (el) { el.hidden = !(s.services || []).length; });
  }

  /** « Essentiel : 34 € par mois, 2 coupes par mois · Coupe classique », one line per formule sold online. */
  function plans(mb) {
    each(document, '[data-list="plans"]', function (ul) {
      while (ul.firstChild) ul.removeChild(ul.firstChild);
      ((mb && (mb.live || mb.terms) && mb.plans) || []).forEach(function (p) {
        var gap = p.missedWords ? ', ' + p.missedWords.charAt(0).toLowerCase() + p.missedWords.slice(1) : p.cuts && p.minDays ? ', au moins ' + p.minDays + NB + 'jours entre deux coupes' : '';
        ul.appendChild(h('li', {}, [h('b', {}, [p.name]), ' : ' + eur(p.price) + ' par mois, ' + p.words + gap + '.']));
      });
    });
  }

  /** One footer for every page, written here so the pages never drift apart. */
  function footer() {
    each(document, '[data-footer]', function (ft) {
      ft.className = 'ft';
      while (ft.firstChild) ft.removeChild(ft.firstChild);
      var links = [['/', 'Le site'], ['/?reserver', 'Réserver'], ['/mon-rendez-vous', 'Mon rendez-vous'], ['/resilier', 'Résilier mon abonnement'], ['/?visite', 'Comment ça marche' + NB + '?'], ['/mentions-legales', 'Mentions légales'], ['/confidentialite', 'Confidentialité'], ['/cgv', 'CGV']];
      var here = location.pathname.replace(/\.html$/, '').replace(/\/+$/, '') || '/';
      ft.appendChild(h('div', { class: 'ft-g' }, [
        h('div', {}, [
          h('span', { class: 'ft-n', 'data-f': 'shop.name' }, ['Barber L’Architecte']),
          h('address', {}, [
            h('span', { 'data-f': 'address' }, ['16, place Pélabon, 13013 Marseille']),
            // two items of a row that wraps, no « · » between them: a line break can strand no separator (the phone is hidden while the salon has none)
            h('span', { class: 'ft-ways' }, [
              h('span', { 'data-opt': '', hidden: '' }, [h('a', { 'data-f': 'phone', 'data-link': 'tel' })]),
              h('a', { 'data-f': 'shop.email', 'data-link': 'mail', href: 'mailto:larchitectebarber@gmail.com' }, ['larchitectebarber@gmail.com'])
            ])
          ])
        ]),
        h('nav', { 'aria-label': 'Pages du site' }, [h('ul', { class: 'ft-l' }, links.map(function (l) {
          var a = h('a', { href: l[0] }, [l[1]]);
          if (l[0] === here) a.setAttribute('aria-current', 'page');
          return h('li', {}, [a]);
        }))]),
        h('p', { class: 'ft-c' }, ['© ' + new Date().getFullYear() + ' ', h('span', { 'data-f': 'editor' }, ['Barber L’Architecte']), ' ·' + NB + 'Pas de pistage, pas de mesure d’audience.'])
      ]));
    });
  }

  /** "Oublier mes infos sur ce téléphone": what the booking sheet remembers (lx-me) and the last booking shown (lx-focus). */
  function forget() {
    each(document, '[data-forget]', function (btn) {
      var out = document.querySelector('[data-forget-done]');
      function has() { try { return !!(localStorage.getItem('lx-me') || localStorage.getItem('lx-focus')); } catch (e) { return false; } }
      if (!has() && out) { out.textContent = 'Rien n’est gardé sur ce téléphone pour l’instant.'; out.hidden = false; }
      btn.addEventListener('click', function () {
        try { localStorage.removeItem('lx-me'); localStorage.removeItem('lx-focus'); } catch (e) { /* storage off: nothing kept anyway */ }
        if (out) { out.textContent = has() ? 'Ton navigateur bloque l’effacement : efface les données du site dans ses réglages.' : 'C’est fait : ce téléphone ne garde plus rien du salon.'; out.hidden = false; }
      });
    });
  }

  /** « Mon espace » joins the footer's links once the salon has opened the client space (the answer is the site's own, /api/public/account). */
  function space(a) {
    if (!a || !a.enabled) return;
    each(document, '.ft-l', function (ul) {
      if (ul.querySelector('a[href="/moi"]')) return;
      var at = ul.querySelector('a[href="/mon-rendez-vous"]');
      var li = h('li', {}, [h('a', { href: '/moi' }, ['Mon espace'])]);
      if (at && at.parentNode && at.parentNode.parentNode === ul) ul.insertBefore(li, at.parentNode.nextSibling); else ul.appendChild(li);
    });
  }

  footer();
  forget();
  var json = function (u) { return fetch(u).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }); };
  var wantsPlans = !!document.querySelector('[data-list="plans"],[data-if^="membership."],[data-unless^="membership."],[data-if="pack"]');
  Promise.all([json('/api/public/salon'), wantsPlans ? json('/api/public/memberships') : null, json('/api/public/account')]).then(function (x) {
    var s = x[0];
    if (s && s.shop) { fill(document, view(s, x[1])); prices(s); plans(x[1]); }
    space(x[2]);
  }).catch(function () { /* keep the page's own text */ }).then(function () {
    document.documentElement.setAttribute('data-ready', '1');
  });
})();
