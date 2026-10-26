// 03 · Au fauteuil. Each barber, his colour, and a status read from his free slots, for the service the
// board shows. Availability says when a chair is bookable, not why it isn't: a barber with nothing left
// today reads "plus rien en ligne aujourd’hui", never "absent" or "complet" (the page can't know which).
import { dates, dur } from '../../../lib/format';
import * as S from '../../../site-kit/salon';
import { $, h, bookAttrs, keepFocus, mono, dayName, whenWords, OUT, svg } from '../dom';
import { barbers, knownPool, shared, svc, type Free } from '../store';

function status(list: Free[] | null): { on: boolean; text: string } | null {
  if (!list) return null;
  const d = S.today(), m = S.nowMin();
  const notice = S.getSalon()?.booking.minNoticeMin ?? 30;
  const today = list.filter((f) => f.day === d);
  const first = list[0];
  const later = (f: Free | undefined) => (f ? (dates.diffDays(d, f.day) === 1 ? 'demain ' : dates.DAYS_SH[dates.dayParts(f.day).wd] + ' ') + dates.fmtTime(f.m) : 'rien sous 14 jours');
  if (today.length) {
    const f = today[0];
    return { on: true, text: f.m - m <= notice + 15 ? 'Libre dès ' + dates.fmtTime(f.m) : 'Prochain créneau · ' + dates.fmtTime(f.m) };
  }
  if (!S.hoursOf(d).length) return { on: false, text: 'Salon fermé aujourd’hui · ' + later(first) };
  if (!first) return { on: false, text: 'Rien en ligne sous 14 jours' };
  return { on: false, text: 'Plus rien en ligne aujourd’hui · ' + later(first) };
}

export function paintChairs() {
  const st = shared();
  const s = svc(st.svc);
  const all = knownPool([st.svc]);
  const lead = $('[data-ch-lead]');
  if (lead && s) lead.textContent = 'Pour ' + (st.svc === 'cl' ? 'une coupe classique' : s.name.toLowerCase().replace(/^coupe/, 'une coupe')) + ' · ' + dur(s.dur);
  const host = $('[data-chairs]')!;
  keepFocus(host, () => host.replaceChildren(...barbers().map((b) => {
    const mine = all ? all.filter((f) => f.key === b.key) : null;
    const stt = status(mine);
    // the day is said once, before the times; a later day is spelled on its own chip
    const d0 = mine?.[0]?.day;
    const slots = (mine || []).slice(0, 3).map((f) => {
      const btn = h('button', { type: 'button', class: 'slot' }, (f.day === d0 ? '' : dayName(f.day, true) + ' ') + dates.fmtTime(f.m));
      bookAttrs(btn, { slugs: [st.svc], staff: b.key, day: f.day, start: f.m, source: 'chairs' });
      btn.dataset.fk = b.key + f.day + f.m;
      btn.setAttribute('aria-label', 'Réserver ' + whenWords(f.day, f.m) + ' avec ' + b.name);
      return btn;
    });
    const all3 = h('button', { type: 'button', class: 'tl ch-more', 'data-fk': b.key }, 'Ses créneaux');
    bookAttrs(all3, { slugs: [st.svc], staff: b.key, source: 'chairs-all' });
    all3.setAttribute('aria-label', 'Tous les créneaux de ' + b.name);
    return h('li', { class: 'ch' + (stt?.on ? ' on' : '') },
      mono(b, 'mono lg'),
      h('div', { class: 'ch-i' },
        h('h3', { class: 'ch-n' }, b.name),
        h('p', { class: 'ch-st' }, h('i', { class: 'live-dot' + (stt?.on ? '' : ' off'), 'aria-hidden': 'true' }), stt ? stt.text : h('span', { class: 'sk sk-t' })),
        b.bio ? h('p', { class: 'ch-bio' }, b.bio) : null),
      h('div', { class: 'ch-a' }, d0 ? h('span', { class: 'ch-day' }, dayName(d0)) : null, ...slots, all3,
        b.instagram ? h('a', { class: 'tl ch-ig', href: b.instagram, target: '_blank', rel: 'noopener', 'data-fk': b.key + 'ig' }, 'Instagram', svg(OUT)) : null));
  })), (k) => k.replace(/\d.*$/, ''));
  const any = $('[data-ch-any]');
  if (any) bookAttrs(any, { slugs: [st.svc], staff: 'any', source: 'chairs-any' });
}
