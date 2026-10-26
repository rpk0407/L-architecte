// 01 · Le direct. The first screen answers before anyone scrolls: open or not and until when, the salon's
// own clock (not the phone's), what is left today, the next free chair, and the walk-in wait when the
// salon publishes one. Every number is read from the salon; when one is unknown, it is not shown.
import { dates, plural } from '../../../lib/format';
import * as S from '../../../site-kit/salon';
import * as M from '../../../site-kit/memory';
import { $, bookAttrs, dayShort, NB } from '../dom';
import { barber, knownPool, svc, type Free } from '../store';

const HERO_SVC = ['cl'];
let wasOpen: boolean | null = null;

/** Cuts that really fit on a day: per barber, starts that don't overlap the previous one kept (a slot
 *  grid finer than the service would otherwise count the same half hour twice). */
function cutsOn(pool: Free[], day: string, len: number) {
  const end = new Map<string, number>();
  let n = 0;
  for (const f of pool) {
    if (f.day !== day || f.m < (end.get(f.key) ?? -1)) continue;
    end.set(f.key, f.m + len);
    n++;
  }
  return n;
}

/** Open now and until when, or when it opens again: the same words the big status and the salon section use. */
export function statusWords() {
  const d = S.today(), m = S.nowMin(), iv = S.hoursOf(d);
  const live = S.knownLive();
  const cur = iv.find(([a, b]) => m >= a && m < b);
  const open = live && live.today === d ? live.open && !!iv.length : !!cur;
  const close = cur ? cur[1] : iv.length ? iv[iv.length - 1][1] : null;
  if (open && close != null) {
    const left = close - m;
    return { open, big: 'Ouvert', sub: left <= 60 ? 'Ferme dans ' + plural(Math.max(1, left), 'minute') + '.' : 'Jusqu’à ' + dates.fmtTime(close) + '.', line: 'Ouvert maintenant · ferme à ' + dates.fmtTime(close) };
  }
  const later = iv.find(([a]) => m < a);
  if (later) return { open: false, big: 'Fermé', sub: 'Ouvre à ' + dates.fmtTime(later[0]) + '.', line: 'Fermé · ouvre à ' + dates.fmtTime(later[0]) };
  const next = S.openDays(1, dates.addDays(d, 1))[0];
  if (!next) return { open: false, big: 'Fermé', sub: 'Réouverture bientôt.', line: 'Fermé pour le moment' };
  const n = dates.diffDays(d, next), at = dates.fmtTime(S.hoursOf(next)[0][0]);
  const when = n === 1 ? 'demain' : n < 7 ? dates.DAYS_FR[dates.dayParts(next).wd] : 'le ' + dates.dayLong(next);
  return { open: false, big: 'Fermé', sub: 'Rouvre ' + when + ' à ' + at + '.', line: 'Fermé · réouverture ' + when + ' ' + at };
}

export function paintClock() {
  const min = dates.localParts(S.now()).min;
  const [hh, mm] = dates.hhmm(min).split(':');
  $('[data-clock-h]')!.textContent = hh;
  $('[data-clock-m]')!.textContent = mm;
  const sr = $('[data-clock-sr]');
  if (sr) sr.textContent = 'Heure du salon : ' + dates.fmtTime(min);
}

function meter(i: number, k: string, v: string | null, s: string) {
  const kk = $('[data-mt-k="' + i + '"]'), vv = $('[data-mt-v="' + i + '"]'), ss = $('[data-mt-s="' + i + '"]');
  if (kk) kk.textContent = k;
  if (vv) { if (v == null) vv.innerHTML = '<i class="sk"></i>'; else vv.textContent = v; }
  if (ss) ss.textContent = s || NB;
}

export function paintHero(failed = false) {
  const st = statusWords();
  $('[data-st-big]')!.textContent = st.big;
  $('[data-st-sub]')!.textContent = st.sub;
  $('[data-dot]')?.classList.toggle('off', !st.open);
  // the open/closed switch is the one change worth saying out loud, and only when it happens
  if (wasOpen !== null && wasOpen !== st.open) $('[data-st-live]')!.textContent = st.line;
  wasOpen = st.open;
  const first = M.firstName();
  $('[data-greet]')!.textContent = first ? 'Salut ' + first + ' · barbier, place Pélabon' : 'Barbier · place Pélabon · en direct';
  paintClock();

  const pool = knownPool(HERO_SVC);
  const d = S.today(), m = S.nowMin(), iv = S.hoursOf(d);
  const nextBtn = $<HTMLButtonElement>('[data-mt-b]')!;
  if (!pool) {
    if (failed) { meter(0, 'Aujourd’hui', '—', 'hors ligne'); meter(1, 'Prochain', 'Réserver', 'tout est revérifié'); }
    else { meter(0, 'Aujourd’hui', null, 'coupes possibles'); meter(1, 'Prochain', null, ''); }
  } else {
    // the rest of today while the salon is open, otherwise the next day it opens
    const stillToday = iv.some(([, b]) => m < b - 15);
    const day = stillToday ? d : S.openDays(1, dates.addDays(d, 1))[0] || d;
    const n = cutsOn(pool, day, svc(HERO_SVC[0])?.dur || 30);
    const label = day === d ? 'Aujourd’hui' : dates.diffDays(d, day) === 1 ? 'Demain' : dates.DAYS_FR[dates.dayParts(day).wd].replace(/^./, (c) => c.toUpperCase());
    meter(0, label, n ? String(n) : 'Complet', n ? (n > 1 ? 'coupes possibles' : 'coupe possible') : 'en ligne');
    const f = pool[0], b = f ? barber(f.key) : null;
    if (f) {
      const today = f.day === d;
      meter(1, 'Prochain', (today ? '' : dayShort(f.day) + ' ') + dates.fmtTime(f.m), b ? 'avec ' + b.name : '');
      bookAttrs(nextBtn, { slugs: HERO_SVC, staff: f.key, day: f.day, start: f.m, source: 'hero-next' });
      nextBtn.setAttribute('aria-label', 'Réserver ' + (today ? 'aujourd’hui' : dates.dayLong(f.day)) + ' à ' + dates.fmtTime(f.m) + (b ? ' avec ' + b.name : '') + ', coupe classique');
    } else {
      meter(1, 'Prochain', '—', 'rien sous 14 j');
      bookAttrs(nextBtn, { slugs: HERO_SVC, source: 'hero-next' });
      nextBtn.setAttribute('aria-label', 'Réserver une coupe classique');
    }
  }
  const live = S.knownLive();
  if (live && st.open && live.waitMin != null) {
    const w = live.waitMin;
    meter(2, 'Sans RDV', w <= 5 ? 'Libre' : '≈' + NB + w + NB + 'min', w <= 5 ? 'moins de 5 min' : live.queued ? plural(live.queued, 'personne') + ' avant toi' : 'attente estimée');
  } else meter(2, 'Google', '5,0', '316 avis');
}
