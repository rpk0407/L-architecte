// 03 · Le temps. The signature shot: one cut grows out from J+0 to J+28 under the scroll. A second print of the
// same photo, pre-filtered as regrowth (softer, darker sides) and masked to the hair, cross-fades in: the face
// stays sharp, the cut does not. The dimension line on the fade loses its edge the same way; the captions run
// as subtitles. A returning visitor's counter lands on his own day.
import { AGING } from '../../../site-kit/content';
import { track, span, clamp, reduced } from '../../../site-kit/motion';
import { recall, onRecall } from '../personal';
import { bookAttrs, svc, priceText } from '../data';
import { $, $$, esc, pad2, setText, swap } from '../util';
import './temps.css';

const stage = (day: number) => (day < 5 ? 0 : day < 12 ? 1 : day < 19 ? 2 : day < 25 ? 3 : 4);

export function mountTemps() {
  const sec = $('#le-temps');
  if (!sec) return;
  const subs = $('[data-aging]', sec)!, ticks = $('.tm-ticks', sec)!;
  subs.innerHTML = AGING.map((t, i) => `<li class="tm-s${i === 4 ? ' tm-s-last' : ''}"><span>${esc(t)}</span></li>`).join('');
  ticks.innerHTML = Array.from({ length: 29 }, (_, d) => `<i class="${d % 7 ? '' : 'wk'}">${d % 7 ? '' : '<b>J+' + d + '</b>'}</i>`).join('');
  const items = $$('.tm-s', sec), b = $('.tm-b', sec)!, dimA = $('.tm-dim-a', sec)!, dimB = $('.tm-dim-b', sec)!;
  const dayEl = $('.tm-day b', sec)!, end = $('.tm-end', sec)!, fill = $('.tm-fill', sec)!, head = $('.tm-head', sec)!;
  const me = $('.tm-me', sec)!, next = $('[data-tm-next]', sec)!;
  let maxDay = 28, st = -1, last = '';

  const paintDay = (day: number, t: number) => {
    const a = clamp(day / 28);
    b.style.opacity = dimB.style.opacity = a.toFixed(3);
    dimA.style.opacity = (1 - a).toFixed(3);
    fill.style.transform = `scaleX(${clamp(t * maxDay / 28).toFixed(4)})`;
    head.style.transform = `translateX(${(clamp(t * maxDay / 28) * 100).toFixed(2)}cqw)`;
    // the closing card shows once the scrub reaches its end, whatever day that is (J+3 as well as J+28)
    const s = stage(day), fin = t > 0.97 && (maxDay !== 28 || s === 4);
    const key = day + ':' + fin;
    if (key === last) return;
    last = key;
    dayEl.textContent = pad2(day);
    if (s !== st) { st = s; items.forEach((li, i) => li.classList.toggle('is-on', i === s)); }
    sec.classList.toggle('is-end', fin);
    end.style.opacity = fin ? '1' : '0';
  };

  // the closing card and the call to action: the generic "on recoupe", or his own cut, same barber
  const paintRecall = () => {
    const r = recall();
    const mine = !!(r && r.serviceIds.length);
    maxDay = r && mine ? Math.min(r.days, 99) : 28;
    const ref = svc('cl');
    let endHtml: string, nextHtml: string;
    if (r && mine) {
      me.style.setProperty('--x', String(clamp(r.days / 28)));
      setText(me, 'Toi : J+' + r.days);
      endHtml = `<span>Toi&nbsp;: J+${esc(r.days)}.</span><em>${r.days >= 21 ? 'On recoupe&nbsp;?' : 'Encore net.'}</em>`;
      nextHtml = `<button type="button" class="btn" ${bookAttrs({ serviceIds: r.serviceIds, staffId: r.staffId, source: 'film-temps-rebook' })}>Même coupe${r.staff ? ', même barbier' : ''}</button>
        <p class="next-n">${esc(r.services)}${r.staff ? ' · avec\u00a0' + esc(r.staff) : ''}</p>`;
    } else {
      endHtml = '<span>Ça se voit.</span><em>On recoupe&nbsp;?</em>';
      // one label span: the gap of the button must not split "On recoupe · 20 €"
      nextHtml = `<button type="button" class="btn" ${bookAttrs({ slug: 'cl', source: 'film-temps' })}><span>On recoupe · <span data-price="cl">${esc(ref ? priceText(ref) : '20 €')}</span></span></button>
        <p class="next-n">Un dégradé net se refait toutes les trois à quatre semaines.</p>`;
    }
    me.hidden = !mine;
    // redrawn only when it changed: the live data repaints often, a focused button must stay put
    if (!swap(next, nextHtml) && !swap(end, endHtml)) return;
    swap(end, endHtml);
    last = '';
    if (reduced()) paintDay(maxDay, 1);
  };
  onRecall(paintRecall);

  if (reduced()) return;
  track(sec, (p) => { const t = span(p, 0.06, 0.88); paintDay(Math.round(t * maxDay), t); }, 'sticky');
}
