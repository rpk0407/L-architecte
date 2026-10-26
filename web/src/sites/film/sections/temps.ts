// 03 · Le temps. The signature shot: one cut ages from J+0 to J+28 under the scroll. A crisp and a softened
// print of the same photo cross-fade (opacity only, no per-frame blur); the dimension line on the fade loses
// its edge the same way; the captions run as subtitles. A returning visitor's counter lands on his own day.
import { AGING } from '../../../site-kit/content';
import { track, span, clamp, reduced } from '../../../site-kit/motion';
import { recall, onRecall } from '../personal';
import { bookAttrs, svc, priceText } from '../data';
import { $, $$, esc, pad2, setText } from '../util';
import './temps.css';

const GROW = 0.4; // mm of regrowth a day, the usual order of magnitude (shown as an approximation)
const stage = (day: number) => (day < 5 ? 0 : day < 12 ? 1 : day < 19 ? 2 : day < 25 ? 3 : 4);

export function mountTemps() {
  const sec = $('#le-temps');
  if (!sec) return;
  const subs = $('[data-aging]', sec)!, ticks = $('.tm-ticks', sec)!;
  subs.innerHTML = AGING.map((t, i) => `<li class="tm-s${i === 4 ? ' tm-s-last' : ''}"><span>${esc(t)}</span></li>`).join('');
  ticks.innerHTML = Array.from({ length: 29 }, (_, d) => `<i class="${d % 7 ? '' : 'wk'}">${d % 7 ? '' : '<b>J+' + d + '</b>'}</i>`).join('');
  const items = $$('.tm-s', sec), b = $('.tm-b', sec)!, dimA = $('.tm-dim-a', sec)!, dimB = $('.tm-dim-b', sec)!;
  const dayEl = $('.tm-day b', sec)!, mm = $('.tm-mm b', sec)!, end = $('.tm-end', sec)!, fill = $('.tm-fill', sec)!, head = $('.tm-head', sec)!;
  const me = $('.tm-me', sec)!, next = $('[data-tm-next]', sec)!;
  let maxDay = 28, st = -1, last = -1;

  const paintDay = (day: number, t: number) => {
    const a = clamp(day / 28);
    b.style.opacity = dimB.style.opacity = a.toFixed(3);
    dimA.style.opacity = (1 - a).toFixed(3);
    fill.style.transform = `scaleX(${clamp(t * maxDay / 28).toFixed(4)})`;
    head.style.transform = `translateX(${(clamp(t * maxDay / 28) * 100).toFixed(2)}cqw)`;
    if (day === last) return;
    last = day;
    dayEl.textContent = pad2(day);
    mm.textContent = (day * GROW).toFixed(1).replace('.', ',');
    const s = stage(day), fin = t > 0.97 && (maxDay !== 28 || s === 4);
    if (s !== st) { st = s; items.forEach((li, i) => li.classList.toggle('is-on', i === s)); }
    sec.classList.toggle('is-end', fin);
    end.style.opacity = fin ? '1' : '0';
  };

  // the closing card and the call to action: the generic "on recoupe", or his own cut, same barber
  const paintRecall = () => {
    const r = recall();
    maxDay = r ? Math.min(r.days, 99) : 28;
    const ref = svc('cl');
    let endHtml: string, nextHtml: string;
    if (r && r.serviceIds.length) {
      me.style.setProperty('--x', String(clamp(r.days / 28)));
      setText(me, 'Toi : J+' + r.days);
      endHtml = `<span>Toi&nbsp;: J+${esc(r.days)}.</span><em>${r.days >= 21 ? 'On recoupe&nbsp;?' : 'Encore net.'}</em>`;
      nextHtml = `<button type="button" class="btn" ${bookAttrs({ serviceIds: r.serviceIds, staffId: r.staffId, source: 'film-temps-rebook' })}>Même coupe${r.staff ? ', même barbier' : ''}</button>
        <p class="next-n">${esc(r.services)}${r.staff ? ' · avec ' + esc(r.staff) : ''}</p>`;
    } else {
      endHtml = '<span>Ça se voit.</span><em>On recoupe&nbsp;?</em>';
      nextHtml = `<button type="button" class="btn" ${bookAttrs({ slug: 'cl', source: 'film-temps' })}>On recoupe · <span data-price="cl">${esc(ref ? priceText(ref) : '20 €')}</span></button>
        <p class="next-n">Un dégradé net se refait toutes les trois à quatre semaines.</p>`;
    }
    me.hidden = !(r && r.serviceIds.length);
    // redrawn only when it changed: the live data repaints often, a focused button must stay put
    if (next.dataset.html === nextHtml) return;
    next.dataset.html = nextHtml;
    next.innerHTML = nextHtml;
    end.innerHTML = endHtml;
    last = -1;
    if (reduced()) paintDay(maxDay, 1);
  };
  onRecall(paintRecall);

  if (reduced()) return;
  track(sec, (p) => { const t = span(p, 0.06, 0.88); paintDay(Math.round(t * maxDay), t); }, 'sticky');
}
