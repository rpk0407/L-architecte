// Demo only: a discreet tab on the left edge to switch between the versions of the site during the presentation.
// Invisible in production (the salon's mode decides).
import { loadSalon } from './salon';

const VERSIONS = [
  { id: 'site', label: 'L’original', note: 'Le site actuel, branché sur le salon', href: '/site' },
  { id: 'film', label: 'Le Film', note: 'Le récit, du trottoir au fauteuil', href: '/film' },
  { id: 'atelier', label: 'L’Atelier', note: 'La construction au millimètre', href: '/atelier' },
  { id: 'direct', label: 'En direct', note: 'Le salon en temps réel', href: '/direct' }
];

export function mountVersions(current: string) {
  loadSalon().then((s) => {
    if (s.mode !== 'demo' || document.querySelector('.lxv')) return;
    const el = document.createElement('div');
    el.className = 'lxv';
    el.innerHTML = `<button type="button" class="lxv-tab" aria-expanded="false" aria-controls="lxv-list">Versions</button>
      <nav class="lxv-list" id="lxv-list" aria-label="Versions du site" hidden>
        <p>Démo · 4 versions du site</p>
        ${VERSIONS.map((v) => `<a href="${v.href}"${v.id === current ? ' aria-current="page"' : ''}><b>${v.label}</b><small>${v.note}</small></a>`).join('')}
        <a href="/comptoir" class="ck"><b>Le Comptoir</b><small>L’écran du salon</small></a>
      </nav>`;
    const style = document.createElement('style');
    style.textContent = `
      .lxv { position: fixed; left: 0; top: 50%; z-index: 900; transform: translateY(-50%); font: 500 14px/1.3 'Instrument Sans', system-ui, sans-serif; }
      .lxv-tab { writing-mode: vertical-rl; transform: rotate(180deg); padding: 14px 7px; border-radius: 0 10px 10px 0; background: #EB4639; color: #0F0E0D; font: 600 11px/1 'Instrument Sans', system-ui, sans-serif; letter-spacing: .12em; text-transform: uppercase; border: 0; cursor: pointer; box-shadow: 0 6px 20px rgba(0,0,0,.25); }
      .lxv-list { position: absolute; left: 34px; top: 50%; transform: translateY(-50%); width: 248px; padding: 10px; border-radius: 18px; background: #0F0E0D; color: #ECE8E0; box-shadow: 0 24px 60px rgba(0,0,0,.45); }
      .lxv-list[hidden] { display: none; }
      .lxv-list p { padding: 6px 10px 8px; font: 600 10.5px/1 'Instrument Sans', system-ui, sans-serif; letter-spacing: .1em; text-transform: uppercase; color: #ABA59C; }
      .lxv-list a { display: flex; flex-direction: column; gap: 2px; padding: 9px 10px; border-radius: 12px; color: inherit; text-decoration: none; }
      .lxv-list a:hover { background: #221F1C; }
      .lxv-list a[aria-current] { background: #221F1C; box-shadow: inset 2px 0 0 #EB4639; }
      .lxv-list b { font: 400 20px/1.1 'Instrument Serif', serif; }
      .lxv-list small { font-size: 12px; color: #ABA59C; }
      .lxv-list a.ck { margin-top: 4px; border-top: 1px solid rgba(236,232,224,.14); border-radius: 0 0 12px 12px; padding-top: 12px; }
      @media print { .lxv { display: none; } }`;
    document.head.appendChild(style);
    document.body.appendChild(el);
    const tab = el.querySelector('.lxv-tab') as HTMLButtonElement, list = el.querySelector('.lxv-list') as HTMLElement;
    const set = (open: boolean) => { list.hidden = !open; tab.setAttribute('aria-expanded', String(open)); };
    tab.addEventListener('click', () => set(list.hidden));
    document.addEventListener('click', (e) => { if (!el.contains(e.target as Node)) set(false); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') set(false); });
  }).catch(() => { /* no salon, no switcher */ });
}
