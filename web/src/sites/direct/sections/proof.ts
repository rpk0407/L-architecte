// 05 · La preuve. The Google score and the three reviews of content.ts, nothing else. The quotes turn on
// their own only while on screen, with the tab visible, and stop for good once the visitor takes over
// (or never start, for reduced motion: then all three are simply listed).
import { REVIEWS, REVIEW_TAGS } from '../../../site-kit/content';
import { reduced } from '../../../site-kit/motion';
import { $, $$, h, watch } from '../dom';

let i = 0, timer = 0, onScreen = false, manual = false, hover = false;

function show(n: number, announce: boolean) {
  i = (n + REVIEWS.length) % REVIEWS.length;
  $$('.pf-r').forEach((el, k) => { el.classList.toggle('on', k === i); el.setAttribute('aria-hidden', String(k !== i)); });
  $$('.pf-dot').forEach((el, k) => el.setAttribute('aria-current', String(k === i)));
  const box = $('[data-pf-live]');
  if (box) box.setAttribute('aria-live', announce ? 'polite' : 'off');
}
function loop() {
  clearTimeout(timer);
  if (manual || hover || !onScreen || document.hidden || reduced()) return;
  timer = window.setTimeout(() => { show(i + 1, false); loop(); }, 6500);
}

export function initProof() {
  const host = $('[data-reviews]')!;
  const quotes = REVIEWS.map((r, k) => h('figure', { class: 'pf-r' + (k === 0 ? ' on' : '') },
    h('blockquote', {}, '« ' + r.before, h('em', {}, r.em), r.after + ' »'),
    h('figcaption', {}, h('span', { class: 'pf-av', 'aria-hidden': 'true' }, r.initial), h('span', {}, r.name, h('small', {}, 'Avis Google · ' + r.date)))));
  if (reduced()) {
    host.classList.add('all');
    host.replaceChildren(...quotes);
  } else {
    const stage = h('div', { class: 'pf-stage', 'data-pf-live': '', 'aria-live': 'off' }, ...quotes);
    const nav = h('div', { class: 'pf-nav' },
      h('button', { type: 'button', class: 'pf-arr', 'aria-label': 'Avis précédent', 'data-d': '-1' }, '←'),
      ...REVIEWS.map((r, k) => h('button', { type: 'button', class: 'pf-dot', 'aria-label': 'Avis de ' + r.name, 'aria-current': String(k === 0), 'data-k': k })),
      h('button', { type: 'button', class: 'pf-arr', 'aria-label': 'Avis suivant', 'data-d': '1' }, '→'));
    host.replaceChildren(stage, nav);
    show(0, false);
    nav.addEventListener('click', (e) => {
      const b = (e.target as Element).closest<HTMLElement>('button');
      if (!b) return;
      manual = true;
      clearTimeout(timer);
      show(b.dataset.k != null ? Number(b.dataset.k) : i + Number(b.dataset.d), true);
    });
    host.addEventListener('pointerenter', () => { hover = true; clearTimeout(timer); });
    host.addEventListener('pointerleave', () => { hover = false; loop(); });
    host.addEventListener('focusin', () => { hover = true; clearTimeout(timer); });
    host.addEventListener('focusout', () => { hover = false; loop(); });
    watch(host, (on) => { onScreen = on; loop(); });
    document.addEventListener('visibilitychange', loop);
  }
  $('[data-tags]')!.replaceChildren(...REVIEW_TAGS.map((t) => h('li', {}, t)));
}
