// Planche 08, the specification: every service of the live catalogue as a numbered article (chapter per
// category), each one booking that service; then the FAQ as numbered clauses (an accessible accordion).
import * as S from '../../../site-kit/salon';
import { FAQ, SHOP } from '../../../site-kit/content';
import { eur, dur } from '../../../lib/format';
import { $, $$, h, text, fr, services, svcBySlug, bookAttrs, onSlots } from '../util';

export function mountCahier() {
  const spec = $('[data-spec]')!, faq = $('[data-faq]')!, note = $('[data-spec-note]')!;
  let sig = '';

  const render = () => {
    const list = services();
    const s = JSON.stringify(list.map((x) => [x.id, x.name, x.price, x.dur, x.from, x.category]));
    if (s === sig) return;
    sig = s;
    const cats = [...new Set(list.map((x) => x.category))];
    spec.replaceChildren(...cats.map((c, ci) => h('section', { class: 'chap', 'aria-labelledby': 'chap-' + ci },
      h('h3', { class: 'chap-h', id: 'chap-' + ci }, h('span', { class: 'pl' }, 'Chap. ' + (ci + 1)), c),
      h('ol', { class: 'arts' }, ...list.filter((x) => x.category === c).map((x, i) => h('li', null,
        h('button', { type: 'button', class: 'art', ...bookAttrs([x]) },
          h('span', { class: 'art-n' }, 'Art. ' + (ci + 1) + '.' + (i + 1)),
          h('span', { class: 'art-t' }, h('b', null, x.name), h('small', null, [x.includes.join(' · '), x.description].filter(Boolean).join(' — '))),
          h('span', { class: 'art-d' }, dur(x.dur)),
          h('span', { class: 'art-p' }, x.from ? h('small', null, 'dès') : null, eur(x.price)),
          h('span', { class: 'art-go', 'aria-hidden': 'true' }, 'Réserver →'))))))));
    // the deposit rule, as the salon states it (nothing shown when it asks for none)
    const d = S.getSalon()?.deposits;
    const rule = d && d.mode === 'threshold' ? ' Acompte en ligne de ' + d.percent + ' % à partir de ' + eur(d.thresholdCents) + ' de prestations, déduit au salon.'
      : d && d.mode === 'all' ? ' Acompte en ligne de ' + d.percent + ' %, déduit au salon.' : '';
    text(note, '« dès » : prix de départ, confirmé au salon après un avis sur la faisabilité. Carte bancaire acceptée au salon.' + rule);
    // the prices quoted in buttons elsewhere on the page
    $$<HTMLElement>('[data-price]').forEach((el) => { const v = svcBySlug(el.dataset.price!); if (v) text(el, (v.from ? 'dès ' : '') + eur(v.price)); });
  };

  faq.replaceChildren(...FAQ.map((f, i) => {
    const id = 'faq-' + i;
    const where = /Où se trouve/.test(f.q);
    return h('li', { class: 'clause' },
      h('h4', null, h('button', { type: 'button', class: 'clause-q', 'aria-expanded': 'false', 'aria-controls': id + '-a', id: id + '-q' },
        h('span', { class: 'clause-n' }, 'Art. ' + (i + 1)), h('span', { class: 'clause-t' }, fr(f.q)), h('i', { class: 'pm', 'aria-hidden': 'true' }))),
      h('div', { class: 'clause-a', id: id + '-a', role: 'region', 'aria-labelledby': id + '-q', hidden: true },
        h('p', null, fr(f.a)),
        where ? h('a', { class: 'tl', href: SHOP.maps, target: '_blank', rel: 'noopener' }, 'Voir l’itinéraire ', h('span', { 'aria-hidden': 'true' }, '↗')) : null));
  }));
  faq.addEventListener('click', (e) => {
    const b = (e.target as Element).closest<HTMLButtonElement>('.clause-q');
    if (!b) return;
    const open = b.getAttribute('aria-expanded') !== 'true';
    b.setAttribute('aria-expanded', String(open));
    $('#' + b.getAttribute('aria-controls'))!.hidden = !open;
  });

  render();
  onSlots(render);
}
