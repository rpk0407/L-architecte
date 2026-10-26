// Demo only: a discreet tab on the left edge to switch between the versions of the site during the presentation.
// Shown only when the salon runs in demo mode. The Vite sites load it through site-kit/versions.ts with
// data-mode already known; the original /site loads it directly and asks the salon itself.
(function () {
  var me = document.currentScript;
  var current = (me && me.dataset.current) || '';
  var VERSIONS = [
    { id: 'site', label: 'L’original', note: 'Le site actuel, branché sur le salon', href: '/site' },
    { id: 'film', label: 'Le Film', note: 'Le récit, du trottoir au fauteuil', href: '/film' },
    { id: 'atelier', label: 'L’Atelier', note: 'La construction au millimètre', href: '/atelier' },
    { id: 'direct', label: 'En direct', note: 'Le salon en temps réel', href: '/direct' }
  ];

  function mount() {
    if (document.querySelector('.lxv')) return;
    var el = document.createElement('div');
    el.className = 'lxv';
    el.innerHTML = '<button type="button" class="lxv-tab" aria-expanded="false" aria-controls="lxv-list">Versions</button>' +
      '<nav class="lxv-list" id="lxv-list" aria-label="Versions du site" hidden><p>Démo · 4 versions du site</p>' +
      VERSIONS.map(function (v) { return '<a href="' + v.href + '"' + (v.id === current ? ' aria-current="page"' : '') + '><b>' + v.label + '</b><small>' + v.note + '</small></a>'; }).join('') +
      '<a href="/comptoir" class="ck"><b>Le Comptoir</b><small>L’écran du salon</small></a>' +
      '<a href="/" class="ck"><b>La démo</b><small>Le parcours complet</small></a></nav>';
    var style = document.createElement('style');
    style.textContent =
      '.lxv{position:fixed;left:0;top:50%;z-index:900;transform:translateY(-50%);font:500 14px/1.3 "Instrument Sans",system-ui,sans-serif}' +
      '.lxv-tab{writing-mode:vertical-rl;transform:rotate(180deg);min-width:28px;padding:14px 7px;border-radius:0 10px 10px 0;background:#EB4639;color:#0F0E0D;font:600 11px/1 "Instrument Sans",system-ui,sans-serif;letter-spacing:.12em;text-transform:uppercase;border:0;cursor:pointer;box-shadow:0 6px 20px rgba(0,0,0,.25)}' +
      '.lxv-tab:focus-visible{outline:2px solid #ECE8E0;outline-offset:2px}' +
      '.lxv-list{position:absolute;left:34px;top:50%;transform:translateY(-50%);width:248px;max-height:calc(100vh - 32px);overflow:auto;padding:10px;border-radius:18px;background:#0F0E0D;color:#ECE8E0;box-shadow:0 24px 60px rgba(0,0,0,.45)}' +
      '.lxv-list[hidden]{display:none}' +
      '.lxv-list p{margin:0;padding:6px 10px 8px;font:600 10.5px/1 "Instrument Sans",system-ui,sans-serif;letter-spacing:.1em;text-transform:uppercase;color:#ABA59C}' +
      '.lxv-list a{display:flex;flex-direction:column;gap:2px;padding:9px 10px;border-radius:12px;color:inherit;text-decoration:none}' +
      '.lxv-list a:hover{background:#221F1C}' +
      '.lxv-list a:focus-visible{outline:2px solid #EB4639;outline-offset:-2px}' +
      '.lxv-list a[aria-current]{background:#221F1C;box-shadow:inset 2px 0 0 #EB4639}' +
      '.lxv-list b{font:400 20px/1.1 "Instrument Serif",serif}' +
      '.lxv-list small{font-size:12px;color:#ABA59C}' +
      '.lxv-list a.ck{margin-top:4px;border-top:1px solid rgba(236,232,224,.14);border-radius:0 0 12px 12px;padding-top:12px}' +
      '.lxv-list a.ck+a.ck{margin-top:0}' +
      '@media print{.lxv{display:none}}';
    document.head.appendChild(style);
    document.body.appendChild(el);
    var tab = el.querySelector('.lxv-tab'), list = el.querySelector('.lxv-list');
    function set(open) { list.hidden = !open; tab.setAttribute('aria-expanded', String(open)); }
    tab.addEventListener('click', function () { set(list.hidden); });
    document.addEventListener('click', function (e) { if (!el.contains(e.target)) set(false); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !list.hidden) { set(false); tab.focus(); } });
  }

  function ready(fn) { if (document.body) fn(); else document.addEventListener('DOMContentLoaded', fn); }
  if (me && me.dataset.mode === 'demo') return ready(mount);
  fetch('/api/public/salon', { headers: { accept: 'application/json' }, credentials: 'same-origin' })
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (s) { if (s && s.mode === 'demo') ready(mount); })
    .catch(function () { /* no salon, no switcher */ });
})();
