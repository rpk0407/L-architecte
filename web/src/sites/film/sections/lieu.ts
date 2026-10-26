// 07 · Le lieu, and the credits' "Séances" line: the address, this week's hours from the salon (today marked,
// closures applied), the walk-in wait when the salon reports one, and a booking prefilled with the next day that
// has room.
import * as S from '../../../site-kit/salon';
import { dates } from '../../../lib/format';
import { SHOP } from '../../../site-kit/content';
import { bookAttrs, dayWords } from '../data';
import { live, onLive } from '../live';
import { $, esc, setText, swap, safeUrl, ARROW } from '../util';

const ORDER = [1, 2, 3, 4, 5, 6, 0];
const range = (iv: S.Interval[]) => iv.map(([a, b]) => dates.fmtTime(a) + ' – ' + dates.fmtTime(b)).join(' · ');
/** The usual hours of a weekday (the credits' line), before any closure. */
const weekHours = (wd: number) => {
  const sal = S.getSalon();
  return sal ? sal.hours[String(wd)] || [] : wd >= 2 && wd <= 6 ? ([[540, 1110]] as S.Interval[]) : [];
};

/** "Du mardi au samedi, 9 h – 18 h 30" when the open days run in a row with the same hours. */
function hoursText() {
  const open = ORDER.filter((wd) => weekHours(wd).length);
  if (!open.length) return 'Sur rendez-vous';
  const same = open.every((wd) => range(weekHours(wd)) === range(weekHours(open[0])));
  const row = open.every((wd, i) => i === 0 || ORDER.indexOf(wd) === ORDER.indexOf(open[i - 1]) + 1);
  if (same && row && open.length > 1) return 'Du ' + dates.DAYS_FR[open[0]] + ' au ' + dates.DAYS_FR[open[open.length - 1]] + ', ' + range(weekHours(open[0]));
  return open.map((wd) => dates.DAYS_SH[wd] + ' ' + range(weekHours(wd))).join(' · ');
}

export function mountLieu() {
  const body = $('[data-hours] tbody'), wait = $('[data-wait]'), acts = $('[data-li-acts]');
  if (!body || !wait || !acts) return;
  const paint = () => {
    // this week, Monday to Sunday, as the salon will really open (a holiday closes its day)
    const known = !!S.getSalon(), today = S.today();
    const monday = dates.addDays(today, -((dates.dayParts(today).wd + 6) % 7));
    swap(body, ORDER.map((wd, i) => {
      const day = dates.addDays(monday, i), cur = known && day === today;
      const iv = known ? S.hoursOf(day) : weekHours(wd);
      return `<tr${cur ? ' class="is-today"' : ''}><th scope="row">${esc(dates.DAYS_FR[wd])}${cur ? '<span class="tag">Aujourd’hui</span>' : ''}</th><td>${iv.length ? esc(range(iv)) : 'Fermé'}</td></tr>`;
    }).join(''));
    wait.hidden = live.wait == null;
    setText(wait, live.wait != null ? 'Sans rendez-vous : environ ' + live.wait + ' min d’attente en ce moment.' : '');
    setText($('[data-hours-text]'), hoursText());

    const n = live.next;
    const btn = n
      ? `<button type="button" class="btn" ${bookAttrs({ day: n.day, source: 'film-lieu' })}>Réserver pour ${esc(dayWords(n.day))}</button>`
      : `<button type="button" class="btn" ${bookAttrs({ source: 'film-lieu' })}>Prendre place</button>`;
    swap(acts, btn + `<a class="btn ghost" href="${esc(safeUrl(S.getSalon()?.shop.mapsUrl, SHOP.maps))}" target="_blank" rel="noopener">Itinéraire${ARROW}</a>`);
  };
  onLive(paint);
}
