// The visitor's own cut, remembered by his browser (memory.ts): his next appointment near the top, or how long
// since the last one with a one-tap rebook, his first name where it reads naturally. A new visitor sees the next
// free chair instead, never an empty slot. Re-drawn on 'lx:me' (memory changed) and with the live data.
import * as M from '../../site-kit/memory';
import * as S from '../../site-kit/salon';
import { dates, dayWord, plural } from '../../lib/format';
import { bookAttrs, slotWords } from './data';
import { live, onLive } from './live';
import { $, esc, setText, ARROW } from './util';

export type Recall = { days: number; serviceIds: string[]; staffId: string | null; staff: string; services: string };
const subs = new Set<() => void>();
/** The last visit, if any, for the sections that tell time (03 · Le temps). */
export function recall(): Recall | null {
  const v = M.lastVisit();
  if (!v || M.upcoming()) return null;
  const ids = v.serviceIds.filter((id) => !S.getSalon() || S.serviceById(id));
  const staff = v.staffId && (!S.getSalon() || S.barberById(v.staffId)) ? v.staffId : null;
  return { days: Math.max(0, M.daysSince(v.day)), serviceIds: ids, staffId: staff, staff: staff ? v.staff : '', services: v.services };
}
export function onRecall(fn: () => void) { subs.add(fn); fn(); }

function paint() {
  const box = $('[data-me]'), greet = $('[data-greet]');
  if (!box) return;
  const up = M.upcoming(), last = recall(), first = M.firstName();
  if (greet) {
    greet.classList.toggle('is-greet', !!first);
    setText($('.slug-t', greet), first ? (up ? 'Bon retour, ' : 'Content de te revoir, ') + first + '.' : 'Ouverture');
  }
  let html = '';
  if (up) {
    const when = dayWord(up.day, S.today()) + ' · ' + dates.fmtTime(up.start);
    html = `<a class="me-tk" href="${esc(up.manage)}">
      <span class="me-k">${up.status === 'pending' ? 'Acompte à régler' : 'Ta prochaine séance'}</span>
      <span class="me-w">${esc(when)}</span>
      <span class="me-s">${esc(up.services)}${up.staff ? ' · avec ' + esc(up.staff) : ''}</span>
      <span class="me-go">Gérer${ARROW}</span></a>`;
  } else if (last && last.serviceIds.length) {
    html = `<button type="button" class="me-tk" ${bookAttrs({ serviceIds: last.serviceIds, staffId: last.staffId, source: 'film-rebook' })}>
      <span class="me-k">Ta dernière coupe date de ${esc(plural(last.days, 'jour'))}</span>
      <span class="me-w">Même coupe${last.staff ? ', même barbier' : ''}&nbsp;?</span>
      <span class="me-s">${esc(last.services)}${last.staff ? ' · avec ' + esc(last.staff) : ''}</span>
      <span class="me-go">Reprendre${ARROW}</span></button>`;
  } else if (live.next) {
    const b = S.barberById(live.next.staffId);
    html = `<button type="button" class="me-nx" ${bookAttrs({ slug: 'cl', staffId: live.next.staffId, day: live.next.day, start: live.next.start, source: 'film-hero-slot' })}>
      <span class="me-k"><i class="live-dot"></i>Prochain fauteuil libre</span>
      <span class="me-w">${esc(slotWords(live.next.day, live.next.start))}${b ? ' · avec ' + esc(b.name) : ''}</span>
      <span class="me-go" aria-hidden="true">${ARROW}</span></button>`;
  } else if (live.slotsReady || live.label) {
    html = `<p class="me-nt">Réserve en ligne en moins d’une minute, sans compte.${live.wait != null ? ' Sans rendez-vous : environ ' + esc(live.wait) + ' min d’attente.' : ''}</p>`;
  }
  if (box.dataset.html !== html) { box.dataset.html = html; box.innerHTML = html; }

  // the dock tells the same story in a few words
  const dn = $('[data-dock-next]');
  if (dn) setText(dn, up ? dayWord(up.day, S.today()).replace(/^(\S+)\s(\d+).*$/, '$1 $2') + ' · ' + dates.fmtTime(up.start) : live.next ? 'Prochain : ' + slotWords(live.next.day, live.next.start) : 'Sans compte');
  subs.forEach((fn) => fn());
}

export function mountPersonal() {
  onLive(paint);
  addEventListener('lx:me', paint);
  addEventListener('storage', (e) => { if (e.key === 'lx-me-v2') paint(); });
}
