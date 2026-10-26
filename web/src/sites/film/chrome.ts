// The projector around the film: timecode HUD, sequence rail and index, progress hairline, the letterbox
// that breathes at each cut, and the thumb-reachable booking dock on phones.
// Everything here runs from one scroll callback (motion.track) and positions measured once per resize.
import { track, clamp, reduced } from '../../site-kit/motion';
import { svc } from './data';
import { $, $$, esc, pad2 } from './util';

export const SEQ = [
  { id: 'ouverture', t: 'Ouverture' }, { id: 'prends-place', t: 'Prends place' }, { id: 'looks', t: 'Les looks' },
  { id: 'le-temps', t: 'Le temps' }, { id: 'preuve', t: 'La preuve' }, { id: 'casting', t: 'Le casting' },
  { id: 'seance', t: 'La séance' }, { id: 'lieu', t: 'Le lieu' }, { id: 'questions', t: 'Questions' }, { id: 'generique', t: 'Générique' }
].map((s, i) => ({ ...s, n: pad2(i) }));

const FPS = 24;
let tops: number[] = [], docMax = 1, vh = 1, cur = -1, k = -1, dockOn = false, paper = false;

/** HH:MM:SS:FF for a position on the page. The film lasts as long as a classic cut (30 min in the catalogue). */
function timecode(p: number) {
  const total = (svc('cl')?.dur || 30) * 60 * FPS;
  const f = Math.round(clamp(p) * total);
  return [f / (3600 * FPS), (f / (60 * FPS)) % 60, (f / FPS) % 60, f % FPS].map(pad2).join(':');
}

function measure() {
  vh = innerHeight;
  docMax = Math.max(1, document.documentElement.scrollHeight - vh);
  tops = SEQ.map((s) => { const el = document.getElementById(s.id); return el ? el.getBoundingClientRect().top + scrollY : 0; });
  $$('[data-seqs] .tc').forEach((el, i) => { el.textContent = timecode(tops[i] / docMax).slice(0, 8); });
}

export function mountChrome() {
  const rail = $('[data-rail]')!, list = $('[data-seqs]')!;
  rail.innerHTML = SEQ.map((s) => `<li><a href="#${s.id}"><span class="n">${s.n}</span><span class="t">${esc(s.t)}</span></a></li>`).join('');
  list.innerHTML = SEQ.map((s) => `<li><a href="#${s.id}"><span class="n">${s.n}</span><span class="t">${esc(s.t)}</span><span class="tc">00:00:00</span></a></li>`).join('');

  const hud = $<HTMLButtonElement>('.hud')!, nav = $('#seqs')!;
  const hudN = $('.hud-n')!, hudT = $('.hud-t')!, hudTc = $('.hud-tc')!;
  const hair = $('.hair i')!, lbT = $('.lb-t')!, lbB = $('.lb-b')!, dock = $('[data-dock]')!;
  const still = reduced();

  /* the index: a disclosure under the HUD */
  const setOpen = (open: boolean, focus = true) => {
    nav.hidden = !open;
    hud.setAttribute('aria-expanded', String(open));
    document.documentElement.classList.toggle('seqs-open', open);
    if (open) { measure(); ($('a[aria-current]', nav) || $('a', nav))?.focus(); }
    else if (focus) hud.focus();
  };
  hud.addEventListener('click', () => setOpen(nav.hidden));
  nav.addEventListener('click', (e) => { if ((e.target as Element).closest('a')) setOpen(false, false); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !nav.hidden) setOpen(false); });
  document.addEventListener('click', (e) => { if (!nav.hidden && !nav.contains(e.target as Node) && !hud.contains(e.target as Node)) setOpen(false, false); });

  const setCurrent = (i: number) => {
    cur = i;
    hudN.textContent = SEQ[i].n;
    hudT.textContent = SEQ[i].t;
    for (const root of [rail, list]) $$('a', root).forEach((a, j) => { if (j === i) a.setAttribute('aria-current', 'true'); else a.removeAttribute('aria-current'); });
  };

  measure();
  addEventListener('resize', measure, { passive: true });
  // the catalogue, the barbers and the FAQ arrive after first paint: lengths change, so do the cuts
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(() => measure()).observe($('.film')!);

  track($('.film'), () => {
    const y = scrollY, p = y / docMax;
    hair.style.transform = `scaleX(${p.toFixed(4)})`;
    hudTc.textContent = timecode(p);
    let i = 0;
    while (i < tops.length - 1 && tops[i + 1] <= y + vh * 0.45) i++;
    if (i !== cur) setCurrent(i);
    // the top bar reads on ink; over the paper programme it switches to paper
    let u = 0;
    while (u < tops.length - 1 && tops[u + 1] <= y + 40) u++;
    const pp = SEQ[u].id === 'seance';
    if (pp !== paper) { paper = pp; document.documentElement.classList.toggle('on-paper', pp); }

    // letterbox: full in the opening shot, opening up as the film starts, closing in briefly at each cut
    if (!still) {
      let kk = 1 - clamp(y / (vh * 0.6));
      for (let j = 1; j < tops.length; j++) {
        const d = Math.abs(tops[j] - (y + vh * 0.5)) / (vh * 0.32);
        if (d < 1) kk = Math.max(kk, (1 - d) * (1 - d) * 0.55);
      }
      if (Math.abs(kk - k) > 0.002) { k = kk; lbT.style.transform = lbB.style.transform = `scaleY(${kk.toFixed(3)})`; }
    }

    // the dock shows once the opening is over and steps aside for the credits (their links stay reachable)
    const on = y > (tops[1] || vh) - vh * 0.5 && y + vh < (tops[tops.length - 1] || docMax + vh) + 60;
    if (on !== dockOn) { dockOn = on; dock.classList.toggle('on', on); }
  }, 'sticky');
}
