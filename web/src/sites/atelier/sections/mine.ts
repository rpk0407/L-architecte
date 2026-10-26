// "Ton plan": only for someone this browser already knows. His next appointment if he has one; otherwise
// how long since his last cut and the same plan again in one tap, with the next free slot for it.
// A new visitor sees nothing here: the section stays hidden, it never shows an empty frame.
// It also owns the hero's small greeting line ("Bon retour, Karim").
import * as S from '../../../site-kit/salon';
import * as M from '../../../site-kit/memory';
import { openBooking } from '../../../site-kit/booking';
import { SHOP } from '../../../site-kit/content';
import { dates, cap, dur } from '../../../lib/format';
import { $, h, text, freeSlots, whenLong, onSlots, type Free } from '../util';

type Again = { ids: string[]; staff: string; next: Free | null };
let again: Again | null = null;

function plan(): Again | null {
  const last = M.upcoming() ? null : M.lastVisit();
  if (!last || !S.getSalon()) return null;
  const ids = last.serviceIds.filter((id) => S.serviceById(id));
  return ids.length ? { ids, staff: last.staffId && S.barberById(last.staffId) ? last.staffId : 'any', next: null } : null;
}

export function mountMine() {
  const sec = $('[data-mine]')!, greet = $('[data-greet]')!, base = $('[data-greet-base]')!;
  let sig = '';

  const render = () => {
    const up = M.upcoming(), last = up ? null : M.lastVisit(), first = M.firstName();
    const s = JSON.stringify([up?.token, up?.status, last?.token, first, again?.next, !!S.getSalon()]);
    if (s === sig) return;
    sig = s;

    const hi = first ? 'Bon retour, ' + first : '';
    const line = up ? (hi || 'Bon retour') + ' · ton rendez-vous ' + dates.dayShort(up.day) + ' ' + dates.fmtTime(up.start) : hi ? hi + ' · place Pélabon' : '';
    text(greet, line);
    greet.hidden = !line;
    base.hidden = !!line;

    sec.replaceChildren();
    sec.hidden = !up && !last;
    if (!up && !last) return;
    const head = (title: string) => [
      h('p', { class: 'micro mine-k' }, h('span', { class: 'pl' }, 'Ton plan'), hi || 'Bon retour'),
      h('h2', { class: 'mine-h', id: 'mine-h' }, title)
    ];
    const body: Node[] = [];
    if (up) {
      const pay = up.status === 'pending' && up.payUrl ? up.payUrl : null;
      body.push(
        ...head(cap(dates.dayLong(up.day)) + ' · ' + dates.fmtTime(up.start)),
        h('p', { class: 'mine-s' }, [up.services, up.staff ? 'avec ' + up.staff : '', dur(up.dur), 'code ' + up.code].filter(Boolean).join(' · ')),
        pay ? h('p', { class: 'mine-warn' }, 'Acompte à régler pour confirmer ce créneau.') : null,
        h('div', { class: 'mine-a' },
          pay ? h('a', { class: 'btn', href: pay }, 'Régler l’acompte') : null,
          h('a', { class: pay ? 'btn ghost' : 'btn ink', href: up.manage }, 'Gérer mon rendez-vous'),
          h('a', { class: 'tl', href: S.getSalon()?.shop.mapsUrl || SHOP.maps, target: '_blank', rel: 'noopener' }, 'Itinéraire ', h('span', { 'aria-hidden': 'true' }, '↗')))
      );
    } else if (last) {
      const n = Math.max(0, M.daysSince(last.day));
      body.push(
        ...head(n === 0 ? 'Ta dernière coupe, c’était aujourd’hui.' : n === 1 ? 'Ta dernière coupe date d’hier.' : 'Ta dernière coupe date de ' + n + ' jours.'),
        h('p', { class: 'mine-s' }, [last.services, last.staff ? 'avec ' + last.staff : ''].filter(Boolean).join(' · ')),
        again ? h('div', { class: 'mine-a' },
          h('button', { type: 'button', class: 'btn', 'data-again': '' }, 'Refaire le même plan'),
          again.next ? h('button', { type: 'button', class: 'chip', 'data-again-slot': '' }, h('span', { class: 'micro' }, 'Libre'), whenLong(again.next)) : null) : null
      );
    }
    sec.append(h('div', { class: 'wrap' }, h('div', { class: 'mine-card' }, ...body)));
  };

  sec.addEventListener('click', (e) => {
    const t = e.target as Element, a = again;
    if (!a) return;
    if (t.closest('[data-again]')) openBooking({ serviceIds: a.ids, staffId: a.staff, source: 'atelier-rebook' });
    else if (t.closest('[data-again-slot]') && a.next) openBooking({ serviceIds: a.ids, staffId: a.staff === 'any' ? a.next.staffId || 'any' : a.staff, day: a.next.day, start: a.next.start, source: 'atelier-rebook' });
  });

  // the next free slot for the same plan with the same barber
  const slot = () => {
    again = plan();
    render();
    const a = again;
    if (a) freeSlots(a.ids, a.staff, 1).then(([f]) => { if (again === a) { a.next = f || null; render(); } }, () => {});
  };

  render();
  addEventListener('lx:me', slot);
  onSlots(slot);
}
