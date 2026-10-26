// "Ton plan": only for someone this browser already knows, and inside the hero, where he lands.
// - His next appointment: the hero's first button becomes "Mon rendez-vous" (its page: move, cancel),
//   the card says when, what and with whom, and the dock carries the same link.
// - Otherwise his last visit: how long ago, and the same plan again in one tap, with its next free slot.
// A new visitor sees nothing here: the section stays hidden, it never shows an empty frame.
// It also owns the hero's small greeting line.
import * as S from '../../../site-kit/salon';
import * as M from '../../../site-kit/memory';
import { SHOP } from '../../../site-kit/content';
import { dates, dur } from '../../../lib/format';
import { $, h, text, fr, freeSlots, whenLong, whenShort, onSlots, safeUrl, keepFocus, NB, type Free } from '../util';
import { setAction, avoid } from './chrome';
import { book, whenClosed } from '../sheet';

type Again = { ids: string[]; staff: string; next: Free | null };
let again: Again | null = null;

function plan(): Again | null {
  const last = M.upcoming() ? null : M.lastVisit();
  if (!last || !S.getSalon()) return null;
  const ids = last.serviceIds.filter((id) => S.serviceById(id));
  return ids.length ? { ids, staff: last.staffId && S.barberById(last.staffId) ? last.staffId : 'any', next: null } : null;
}
/** "à tout à l’heure", "à demain", "à jeudi", "à bientôt" */
function seeYou(day: string) {
  const n = dates.diffDays(S.today(), day);
  return n <= 0 ? 'à tout à l’heure' : n === 1 ? 'à demain' : n < 7 ? 'à ' + dates.DAYS_FR[dates.dayParts(day).wd] : 'à bientôt';
}

export function mountMine() {
  const sec = $('[data-mine]')!, greet = $('[data-greet]')!, base = $('[data-greet-base]')!;
  const cta = $('[data-hero-cta]')!, heroBook = $('[data-hero-book]', cta)!, heroDx = $('[data-hero-dx]', cta)!;
  const mineBtn = h('a', { class: 'btn', 'data-hero-mine': '', hidden: true }, 'Mon rendez-vous', h('small', null));
  cta.prepend(mineBtn);
  let sig = '';

  const render = () => {
    const up = M.upcoming(), last = up ? null : M.lastVisit(), first = M.firstName();
    const s = JSON.stringify([up?.token, up?.status, up?.day, last?.token, first, again?.next, !!S.getSalon(), S.getSalon() ? S.today() : '']);
    if (s === sig) return;
    sig = s;

    const line = up ? (first ? first + ' · ' : '') + seeYou(up.day) : first ? (last ? 'Bon retour, ' : 'Salut, ') + first : '';
    text(greet, line);
    greet.hidden = !line;
    base.hidden = !!line;

    // the hero's buttons: his appointment first, booking again second
    const manage = up ? safeUrl(up.manage) : null;
    mineBtn.hidden = !manage;
    if (manage) { mineBtn.href = manage; text($('small', mineBtn), whenShort(up!)); }
    heroBook.classList.toggle('ghost', !!manage);
    heroDx.hidden = !!manage;
    setAction('mine', manage ? { label: 'Mon rendez-vous', sub: whenShort(up!), run: () => location.assign(manage) } : null);

    keepFocus(sec, () => {
      sec.replaceChildren();
      sec.hidden = !up && !last;
      avoid('mine', sec.hidden ? null : sec);
      if (!up && !last) return;
      const head = (k: string, title: string) => [
        h('p', { class: 'micro mine-k' }, h('span', { class: 'pl' }, 'Ton plan'), k),
        h('h2', { class: 'mine-h', id: 'mine-h', tabindex: '-1', 'data-fk-home': '' }, title)
      ];
      const body: (Node | null)[] = [];
      if (up) {
        const pay = up.status === 'pending' ? safeUrl(up.payUrl) : null;
        body.push(
          ...head('Ton rendez-vous', whenLong(up)),
          h('p', { class: 'mine-s' }, fr([up.services, up.staff ? 'avec ' + up.staff : '', dur(up.dur), 'code' + NB + up.code].filter(Boolean).join(' · '))),
          pay ? h('p', { class: 'mine-warn' }, 'Acompte à régler pour confirmer ce créneau.') : null,
          h('div', { class: 'mine-a' },
            pay ? h('a', { class: 'btn sm', href: pay }, 'Régler l’acompte') : null,
            h('a', { class: 'tl', href: safeUrl(S.getSalon()?.shop.mapsUrl) || SHOP.maps, target: '_blank', rel: 'noopener' }, 'Itinéraire ', h('span', { 'aria-hidden': 'true' }, '↗')))
        );
      } else if (last) {
        const n = Math.max(0, M.daysSince(last.day));
        body.push(
          ...head(first ? 'Bon retour, ' + first : 'Bon retour', n === 0 ? 'Ta dernière coupe, c’était aujourd’hui.' : n === 1 ? 'Ta dernière coupe date d’hier.' : 'Ta dernière coupe date de ' + n + ' jours.'),
          h('p', { class: 'mine-s' }, fr([last.services, last.staff ? 'avec ' + last.staff : ''].filter(Boolean).join(' · '))),
          again ? h('div', { class: 'mine-a' },
            h('button', { type: 'button', class: 'btn ink sm', 'data-again': '', 'data-fk': 'again' }, 'Refaire le même plan'),
            again.next ? h('button', { type: 'button', class: 'chip', 'data-again-slot': '', 'data-fk': 'again-slot', 'aria-label': 'Réserver le même plan, ' + whenLong(again.next) }, h('span', { class: 'micro' }, 'Libre'), whenLong(again.next)) : null) : null
        );
      }
      sec.append(h('div', { class: 'mine-card' }, ...body));
    });
  };

  sec.addEventListener('click', (e) => {
    const t = e.target as Element, a = again;
    if (!a) return;
    if (t.closest('[data-again]')) book({ serviceIds: a.ids, staffId: a.staff }, t.closest('button'));
    else if (t.closest('[data-again-slot]') && a.next) book({ serviceIds: a.ids, staffId: a.staff === 'any' ? a.next.staffId || 'any' : a.staff, day: a.next.day, start: a.next.start }, t.closest('button'));
  });

  // the next free slot for the same plan with the same barber
  const slot = () => {
    again = plan();
    render();
    const a = again;
    if (a) freeSlots(a.ids, a.staff, 1).then(([f]) => { if (again === a) { a.next = f || null; whenClosed(render); } }, () => {});
  };

  render();
  addEventListener('lx:me', () => whenClosed(slot));
  onSlots(slot);
}
