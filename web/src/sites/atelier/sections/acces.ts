// Planche 09, getting there: the salon itself (its photo, the mirror's red LED line traced when it comes
// into view), the week's hours from the salon (today marked), an upcoming exceptional closure if there is
// one, the live state, the final call to book.
import * as S from '../../../site-kit/salon';
import { reduced } from '../../../site-kit/motion';
import { dates, cap } from '../../../lib/format';
import { $, h, text, onSlots } from '../util';
import { onLive } from '../live';
import { decorate, DRAWINGS, PACE } from '../drawing';

const WEEK = [1, 2, 3, 4, 5, 6, 0];

export function mountAcces() {
  const list = $('[data-hours]')!, closure = $('[data-closure]')!, draw = $<HTMLElement>('[data-salon]')!;
  decorate(draw, DRAWINGS.salon, PACE.print);
  if (reduced()) draw.classList.add('go', 'still');
  else new IntersectionObserver((es, o) => { if (es.some((e) => e.isIntersecting)) { draw.classList.add('go'); o.disconnect(); } }, { threshold: 0.5 }).observe(draw);

  let sig = '';
  const render = () => {
    const sal = S.getSalon(), today = sal ? S.today() : '', wd = today ? dates.dayParts(today).wd : -1;
    const rows = WEEK.map((d) => {
      const iv = sal ? sal.hours[String(d)] || [] : d >= 2 && d <= 6 ? [[540, 1110]] : [];
      return { d, txt: iv.length ? iv.map(([a, b]) => dates.fmtTime(a) + ' – ' + dates.fmtTime(b)).join(', ') : 'Fermé', today: d === wd };
    });
    const s = JSON.stringify(rows);
    if (s === sig) return;
    sig = s;
    list.replaceChildren(...rows.map((r) => h('li', { class: (r.today ? 'today ' : '') + (r.txt === 'Fermé' ? 'shut' : '') },
      h('span', null, cap(dates.DAYS_FR[r.d])), h('i', { 'aria-hidden': 'true' }),
      h('b', null, r.txt), r.today ? h('span', { class: 'micro' }, 'Aujourd’hui') : null)));
    const next = sal?.closures.filter((c) => c.to >= today).sort((a, b) => a.from.localeCompare(b.from))[0];
    closure.hidden = !next;
    text(closure, next ? 'Fermeture exceptionnelle' + (next.label ? ' (' + next.label + ')' : '') + ' : ' + (next.from === next.to ? 'le ' + dates.dayLong(next.from) : 'du ' + dates.dayLong(next.from) + ' au ' + dates.dayLong(next.to)) + '.' : '');
  };
  render();
  onSlots(render);
  onLive(render);
}
