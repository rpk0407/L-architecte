// Planche 06, the barbers: a monogram in a drafting circle in each one's colour, his own bio, his
// Instagram when he has one, and his next real free slots for a cut; each slot opens the sheet on it.
// While the slots load, three blank chips hold their place; if the salon cannot be reached, a plain
// "Réserver avec …" takes their place (it explains itself when tapped).
import * as S from '../../../site-kit/salon';
import { reveal } from '../../../site-kit/motion';
import { dur } from '../../../lib/format';
import { $, h, svg, text, fr, barbers, svcBySlug, idsOf, freeSlots, whenShort, whenLong, bookAttrs, setBook, onSlots, safeUrl, keepFocus, type Bar } from '../util';
import { book } from '../sheet';

function circle(b: Bar) {
  const ticks = Array.from({ length: 24 }, (_, i) => {
    const a = (i / 24) * Math.PI * 2, r1 = i % 6 ? 55 : 52, r2 = 58;
    return `M${(60 + Math.cos(a) * r1).toFixed(1)} ${(60 + Math.sin(a) * r1).toFixed(1)} L${(60 + Math.cos(a) * r2).toFixed(1)} ${(60 + Math.sin(a) * r2).toFixed(1)}`;
  }).join(' ');
  return svg('svg', { class: 'arch-c', viewBox: '0 0 120 120', 'aria-hidden': 'true', focusable: 'false' },
    svg('path', { class: 'c-x', d: 'M60 0 V120 M0 60 H120' }),
    svg('circle', { class: 'c-o', cx: 60, cy: 60, r: 46 }),
    svg('path', { class: 'c-t', d: ticks }),
    svg('path', { class: 'c-arc', d: 'M60 14 A46 46 0 0 1 106 60', pathLength: 1, style: `stroke:${b.color}` }));
}
const blank = () => [0, 1, 2].map(() => h('span', { class: 'chip sk', 'aria-hidden': 'true' }));

export function mountTeam() {
  const list = $('[data-team]')!, any = $('[data-any-next]');
  let sig = '', built = false;

  const render = () => {
    const team = barbers();
    const s = team.map((b) => b.id + b.name + b.bio + b.instagram + b.color).join('|');
    if (s === sig) return;
    sig = s;
    keepFocus(list, () => list.replaceChildren(...team.map((b, i) => {
      const ig = safeUrl(b.instagram);
      return h('li', { class: 'arch', 'data-reveal': '', 'data-delay': i * 80, 'data-arch': b.id || b.key },
        h('div', { class: 'arch-top' },
          h('div', { class: 'arch-head' }, circle(b), h('span', { class: 'arch-m', 'aria-hidden': 'true' }, b.initials)),
          h('div', null, h('span', { class: 'micro arch-fig' }, 'Fig. 06-' + String.fromCharCode(65 + i)), h('h3', { class: 'arch-n', tabindex: '-1', 'data-fk-home': '' }, b.name))),
        h('p', { class: 'arch-bio' }, fr(b.bio)),
        ig ? h('a', { class: 'tl arch-ig', href: ig, target: '_blank', rel: 'noopener', 'data-fk': 'ig-' + b.key }, 'Instagram ', h('span', { class: 'sr-only' }, 'de ' + b.name), h('span', { 'aria-hidden': 'true' }, '↗')) : null,
        h('div', { class: 'arch-slots' },
          h('p', { class: 'micro', 'data-arch-k': '' }, 'Prochains créneaux'),
          h('div', { class: 'chips', 'data-arch-chips': '' }, ...blank())),
        h('button', { type: 'button', class: 'tl arch-all', 'data-arch-all': '', 'data-fk': 'all-' + b.key }, 'Tout son agenda ', h('span', { 'aria-hidden': 'true' }, '→')));
    })));
    // the first cards are revealed with the page; cards rebuilt with the live team need their own watch
    if (built) reveal(list);
    built = true;
  };

  const slots = () => {
    render();
    const cut = svcBySlug('cl'), ids = cut ? idsOf([cut]) : [];
    if (!cut || !ids.length) return;
    for (const b of barbers()) {
      if (!b.id) continue;
      const card = $(`[data-arch="${b.id}"]`, list);
      if (!card) continue;
      text($('[data-arch-k]', card), 'Prochains créneaux · ' + cut.short.toLowerCase() + ', ' + dur(cut.dur));
      const box = $('[data-arch-chips]', card)!;
      freeSlots(ids, b.id, 3).then((f) => keepFocus(box, () => box.replaceChildren(...(f.length
        ? f.map((x, k) => h('button', { type: 'button', class: 'chip', ...bookAttrs([cut], b, x.day, x.start), 'data-fk': 'slot-' + k, 'aria-label': 'Réserver ' + whenLong(x) + ', avec ' + b.name }, whenShort(x)))
        : [h('span', { class: 'chip ghost' }, 'Complet ces 14 jours')]))), () => box.replaceChildren());
    }
    freeSlots(ids, 'any', 1).then(([f]) => {
      if (!any) return;
      text(any, f ? whenShort(f) : cut.short.toLowerCase());
      setBook(any.closest('[data-book]')!, f ? bookAttrs([cut], 'any', f.day, f.start) : bookAttrs([cut], 'any'));
    }, () => {});
  };

  // the salon does not answer: a plain booking link per barber instead of chips that would never come
  S.loadSalon().catch(() => {
    if (S.getSalon()) return;
    for (const b of barbers()) {
      const box = $(`[data-arch="${b.id || b.key}"] [data-arch-chips]`, list);
      box?.replaceChildren(h('a', { class: 'tl', href: '?reserver', ...bookAttrs([], b) }, 'Réserver avec ' + b.name));
    }
  });

  list.addEventListener('click', (e) => {
    const t = e.target as Element, all = t.closest('[data-arch-all]');
    if (!all) return;
    const id = t.closest<HTMLElement>('[data-arch]')!.dataset.arch!;
    const b = barbers().find((x) => (x.id || x.key) === id);
    if (b) book(b.id ? { staffId: b.id } : { staffKey: b.key }, all);
  });

  render();
  onSlots(slots);
}
