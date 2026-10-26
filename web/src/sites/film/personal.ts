// The visitor's own cut, remembered by his browser (memory.ts): his next appointment near the top, or how long
// since the last one with a one-tap rebook, his first name where it reads naturally. A new visitor sees the next
// free chair instead, never an empty slot. The phone dock tells the same story in a few words.
// Re-drawn on 'lx:me' (memory changed) and with the live data.
import * as M from '../../site-kit/memory';
import * as S from '../../site-kit/salon';
import { dates, dayWord, plural } from '../../lib/format';
import { bookAttrs, slotWords, dayWords, svc } from './data';
import { live, onLive } from './live';
import { $, esc, setText, swap, safeUrl, ARROW } from './util';

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

const nb = (s: string) => s.replace(/ /g, '\u00a0');

/** "À tout à l’heure, Karim." before his appointment, "Content de te revoir" after a past one. */
function greeting(first: string, up: M.Kept | null, last: Recall | null) {
  if (!first) return 'Ouverture';
  if (up) {
    const d = dates.diffDays(S.today(), up.day);
    return (d === 0 ? 'À tout à l’heure, ' : d === 1 ? 'À demain, ' : d < 7 ? 'À ' + dayWords(up.day) + ', ' : 'À bientôt, ') + first + '.';
  }
  return (last ? 'Content de te revoir, ' : 'Bonjour, ') + first + '.';
}

function paint() {
  const box = $('[data-me]'), greet = $('[data-greet]'), dock = $('[data-dock]');
  if (!box) return;
  const up = M.upcoming(), last = recall(), first = M.firstName();
  const rebook = last && last.days >= 1 && last.serviceIds.length ? last : null;
  if (greet) {
    greet.classList.toggle('is-greet', !!first);
    setText($('.slug-t', greet), greeting(first, up, last));
  }
  let html = '';
  if (up) {
    const when = dayWord(up.day, S.today()) + ' · ' + dates.fmtTime(up.start);
    html = `<a class="me-tk" href="${esc(safeUrl(up.manage, '/site'))}">
      <span class="me-k">${up.status === 'pending' ? 'Acompte à régler' : 'Ta prochaine séance'}</span>
      <span class="me-w">${esc(when)}</span>
      <span class="me-s">${esc(up.services)}${up.staff ? ' · avec ' + esc(nb(up.staff)) : ''}</span>
      <span class="me-go">Gérer${ARROW}</span></a>`;
  } else if (rebook) {
    html = `<button type="button" class="me-tk" ${bookAttrs({ serviceIds: rebook.serviceIds, staffId: rebook.staffId, source: 'film-rebook' })}>
      <span class="me-k">Ta dernière coupe date de ${esc(plural(rebook.days, 'jour'))}</span>
      <span class="me-w">Même coupe${rebook.staff ? ', même barbier' : ''}&nbsp;?</span>
      <span class="me-s">${esc(rebook.services)}${rebook.staff ? ' · avec ' + esc(nb(rebook.staff)) : ''}</span>
      <span class="me-go">Reprendre${ARROW}</span></button>`;
  } else if (live.next) {
    const b = S.barberById(live.next.staffId);
    // the pulse means "live, open now": a closed salon gets a still dot
    html = `<button type="button" class="me-nx" ${bookAttrs({ slug: 'cl', staffId: live.next.staffId, day: live.next.day, start: live.next.start, source: 'film-hero-slot' })}>
      <span class="me-k"><i class="live-dot${live.open ? '' : ' off'}"></i>Prochain fauteuil libre</span>
      <span class="me-w">${esc(slotWords(live.next.day, live.next.start))}${b ? ' · avec ' + esc(nb(b.name)) : ''}</span>
      <span class="me-go" aria-hidden="true">${ARROW}</span></button>`;
  } else if (live.slotsReady || live.label || !S.getSalon()) {
    html = `<p class="me-nt">Réserve en ligne en moins d’une minute, sans compte.${live.wait != null ? ' Sans rendez-vous : environ ' + esc(live.wait) + ' min d’attente.' : ''}</p>`;
  }
  swap(box, html);

  // the dock: his appointment to manage, his usual cut to rebook, or the next free chair
  let dk: string;
  if (up) {
    const d = dayWords(up.day);
    dk = `<a class="btn dk-up" href="${esc(safeUrl(up.manage, '/site'))}"><span data-dock-next>Ta séance · ${esc(d)} ${esc(dates.fmtTime(up.start))}</span><small>Gérer</small></a>`;
  } else if (rebook) {
    const ref = rebook.serviceIds.length === 1 ? S.serviceById(rebook.serviceIds[0]) : null;
    dk = `<button type="button" class="btn" ${bookAttrs({ serviceIds: rebook.serviceIds, staffId: rebook.staffId, source: 'film-dock-rebook' })}><span>Même coupe</span><small data-dock-next>${rebook.staff ? 'avec ' + esc(nb(rebook.staff)) : esc(ref?.short || svc('cl')?.short || '')}</small></button>`;
  } else {
    const n = live.next;
    const today = n && dates.diffDays(S.today(), n.day) === 0;
    // under 380 px only the time is kept when the chair is free today ("16 h")
    const next = n ? `<span class="dk-k">Prochain&nbsp;: </span><span class="dk-d${today ? ' td' : ''}">${esc(dayWords(n.day))} </span>${esc(nb(dates.fmtTime(n.start)))}` : 'Sans compte';
    dk = `<button type="button" class="btn" data-book data-book-source="film-dock"><span>Prendre place</span><small data-dock-next>${next}</small></button>`;
  }
  swap(dock, dk);
  subs.forEach((fn) => fn());
}

export function mountPersonal() {
  onLive(paint);
  addEventListener('lx:me', paint);
  addEventListener('storage', (e) => { if (e.key === 'lx-me-v2') paint(); });
}
