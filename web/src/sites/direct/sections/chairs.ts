// 03 · Au fauteuil. Each barber and a status read from his free slots, for the service the board shows.
// Availability says when a chair is bookable, not why it isn't: a barber with nothing left today reads
// "plus rien en ligne aujourd’hui", never "absent" or "complet" (the page can't know which). Green is kept
// for « Libre dès … », the one status that means "now".
import { dates, dur } from '../../../lib/format';
import * as S from '../../../site-kit/salon';
import { $, h, bookAttrs, keepFocus, mono, dayName, dayShort, whenWords, safeUrl, OUT, svg } from '../dom';
import { barbers, knownPool, shared, svc, type Free } from '../store';

type Status = { today: boolean; now: boolean; text: string };

function status(list: Free[] | null, failed: boolean): Status | null {
  if (!list) return failed ? { today: false, now: false, text: 'Hors ligne · réserve, tout est revérifié' } : null;
  const d = S.today(), m = S.nowMin();
  const notice = S.getSalon()?.booking.minNoticeMin ?? 30;
  const today = list.filter((f) => f.day === d);
  const first = list[0];
  const later = (f: Free | undefined) => {
    if (!f) return 'rien sous 14 jours';
    return dates.diffDays(d, f.day) === 1 ? 'demain ' + dates.fmtTime(f.m) : dayShort(f.day, true) + ' à ' + dates.fmtTime(f.m);
  };
  if (today.length) {
    const f = today[0], soon = f.m - m <= notice + 15;
    return { today: true, now: soon, text: soon ? 'Libre dès ' + dates.fmtTime(f.m) : 'Prochain créneau · ' + dates.fmtTime(f.m) };
  }
  if (!S.hoursOf(d).length) return { today: false, now: false, text: 'Salon fermé aujourd’hui · ' + later(first) };
  if (!first) return { today: false, now: false, text: 'Rien en ligne sous 14 jours' };
  return { today: false, now: false, text: 'Plus rien en ligne aujourd’hui · ' + later(first) };
}

/** Lead line under the title: « Pour une coupe classique · 30 min » */
function forWhat(slug: string) {
  const s = svc(slug);
  if (!s) return '';
  const name = s.name.toLowerCase();
  return 'Pour ' + (slug === 'cl' ? 'une coupe classique' : /^coupe/.test(name) ? name.replace(/^coupe/, 'une coupe') : (/^taille/.test(name) ? 'une ' : '') + name) + ' · ' + dur(s.dur);
}

export function paintChairs(failed = false) {
  const st = shared();
  const all = knownPool([st.svc]);
  const lead = $('[data-ch-lead]');
  if (lead) lead.textContent = forWhat(st.svc);
  const host = $('[data-chairs]')!;
  keepFocus(host, () => host.replaceChildren(...barbers().map((b) => {
    const mine = all ? all.filter((f) => f.key === b.key) : null;
    const stt = status(mine, failed);
    // the day is said once, before the times; a later day is spelled on its own chip
    const d0 = mine?.[0]?.day;
    const slots = (mine || []).slice(0, 3).map((f) => {
      const btn = h('button', { type: 'button', class: 'slot' }, (f.day === d0 ? '' : dayShort(f.day) + ' · ') + dates.fmtTime(f.m));
      bookAttrs(btn, { slugs: [st.svc], staff: b.key, day: f.day, start: f.m, source: 'chairs' });
      btn.dataset.fk = b.key + f.day + f.m;
      btn.setAttribute('aria-label', 'Réserver ' + whenWords(f.day, f.m) + ' avec ' + b.name);
      return btn;
    });
    const all3 = h('button', { type: 'button', class: 'tl ch-more', 'data-fk': b.key }, 'Ses créneaux');
    bookAttrs(all3, { slugs: [st.svc], staff: b.key, source: 'chairs-all' });
    all3.setAttribute('aria-label', 'Tous les créneaux de ' + b.name);
    const ig = safeUrl(b.instagram);
    return h('li', { class: 'ch' + (stt?.today ? ' on' : '') },
      h('div', { class: 'ch-h' },
        mono(b, 'mono lg'),
        h('div', { class: 'ch-i' },
          h('h3', { class: 'ch-n' }, b.name),
          h('p', { class: 'ch-st' }, h('i', { class: 'live-dot' + (stt?.now ? '' : ' off'), 'aria-hidden': 'true' }), stt ? stt.text : h('span', { class: 'sk sk-t' })))),
      h('div', { class: 'ch-a' }, d0 ? h('span', { class: 'ch-day' }, dayName(d0)) : null, ...slots, all3,
        ig ? h('a', { class: 'tl ch-ig', href: ig, target: '_blank', rel: 'noopener', 'data-fk': b.key + 'ig' }, 'Instagram', svg(OUT)) : null),
      b.bio ? h('p', { class: 'ch-bio' }, b.bio) : null);
  })), (k) => k.replace(/\d.*$/, ''));
  const any = $('[data-ch-any]');
  if (any) bookAttrs(any, { slugs: [st.svc], staff: 'any', source: 'chairs-any' });
}
