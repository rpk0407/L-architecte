// 07 · Le salon and 08 · Questions. The week's hours as the salon publishes them (today marked, live),
// the closures it has announced, the way there, and the FAQ as native <details> (keyboard and screen
// readers for free, one open at a time).
import { dates } from '../../../lib/format';
import * as S from '../../../site-kit/salon';
import { FAQ } from '../../../site-kit/content';
import { ease, reduced, span, track } from '../../../site-kit/motion';
import { $, h, bookAttrs, whenWords } from '../dom';
import { barber, knownPool } from '../store';
import { statusWords } from './hero';

const WEEK = [1, 2, 3, 4, 5, 6, 0];

export function paintSalon() {
  const d = S.today(), wd = dates.dayParts(d).wd;
  const sal = S.getSalon();
  const st = statusWords();
  const line = $('[data-sl-st]');
  if (line) {
    line.querySelector('.live-dot')!.classList.toggle('off', !st.open);
    line.querySelector('span:last-child')!.textContent = st.line;
  }
  $('[data-hours]')!.replaceChildren(...WEEK.map((w) => {
    const iv = sal ? sal.hours[String(w)] || [] : w >= 2 && w <= 6 ? [[540, 1110]] : [];
    const today = w === wd;
    return h('tr', { class: (today ? 'today' : '') + (iv.length ? '' : ' shut') },
      h('th', { scope: 'row' }, dates.DAYS_FR[w].replace(/^./, (c) => c.toUpperCase()), today ? h('small', {}, 'aujourd’hui') : null),
      h('td', {}, iv.length ? iv.map(([a, b]) => dates.fmtTime(a) + ' – ' + dates.fmtTime(b)).join(', ') : 'Fermé'));
  }));
  const cl = $('[data-closures]')!;
  const list = sal ? sal.closures.filter((c) => c.to >= d).slice(0, 2) : [];
  cl.hidden = !list.length;
  cl.textContent = list.map((c) => (c.label || 'Fermeture') + ' : ' + (c.from === c.to ? dates.dayLong(c.from) : 'du ' + dates.dayLong(c.from) + ' au ' + dates.dayLong(c.to))).join(' · ');
  // the section's own next step: the first free cut, already chosen
  const b = $('[data-sl-book]');
  const f = (knownPool(['cl']) || [])[0];
  const when = f ? (f.day === d ? '' : dates.DAYS_SH[dates.dayParts(f.day).wd] + ' ') + dates.fmtTime(f.m) : '';
  const who = f ? barber(f.key) : null;
  if (b) { bookAttrs(b, f ? { slugs: ['cl'], staff: f.key, day: f.day, start: f.m, source: 'venir' } : { slugs: ['cl'], source: 'venir' }); b.textContent = f ? 'Réserver · ' + when : 'Réserver'; }
  // and the page's last word: the next free chair, one tap away
  const last = $('[data-last-next]'), sub = $('[data-last-sub]');
  if (last && sub) {
    bookAttrs(last, f ? { slugs: ['cl'], staff: f.key, day: f.day, start: f.m, source: 'last' } : { slugs: ['cl'], source: 'last' });
    sub.textContent = f ? when + (who ? ' · ' + who.name : '') : 'sans compte · 1 min';
    if (f) last.setAttribute('aria-label', 'Réserver une coupe ' + whenWords(f.day, f.m) + (who ? ' avec ' + who.name : '')); else last.removeAttribute('aria-label');
  }
}

export function initSalon() {
  // the photo opens from a framed crop to the full frame as the section arrives (clip-path, one rAF loop)
  const ph = $('[data-sl-ph]');
  if (ph && !reduced()) track($('[data-salon]'), (p) => ph.style.setProperty('--o', ease(span(p, .04, .36)).toFixed(4)), 'through');

  $('[data-faq]')!.replaceChildren(...FAQ.map((f, i) => h('details', { class: 'fq-i', name: 'faq' },
    h('summary', {}, h('span', { class: 'fq-n', 'aria-hidden': 'true' }, String(i + 1).padStart(2, '0')), h('span', { class: 'fq-q' }, f.q), h('span', { class: 'fq-ic', 'aria-hidden': 'true' })),
    h('div', { class: 'fq-a' }, h('p', {}, f.a)))));
}
