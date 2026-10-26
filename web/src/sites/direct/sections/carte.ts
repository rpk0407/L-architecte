// 06 · La carte express. The whole price list on one screen, grouped as the salon groups it. "+" composes
// a basket of up to three services (the sheet's own limit), with the live total and length; "→" books
// one service on its own. Prices and lengths come from the salon once it answers.
import { dates, eur } from '../../../lib/format';
import { $, $$, h, svg, ARROW, PLUS, bookAttrs } from '../dom';
import { services, total } from '../store';

const MAX = 3;
let basket: string[] = [];

function paintBasket() {
  const t = total(basket);
  const sum = $('[data-bask-sum]')!, meta = $('[data-bask-meta]')!, go = $<HTMLButtonElement>('[data-bask-go]')!;
  $('[data-bask]')!.classList.toggle('on', basket.length > 0);
  sum.textContent = basket.length ? (t.from ? 'dès ' : '') + eur(t.price) + ' · ' + dates.fmtDur(t.dur) : 'Ton panier est vide';
  meta.textContent = basket.length ? t.shorts.join(' + ') + (basket.length >= MAX ? ' · trois prestations au plus en ligne' : '') : 'Ajoute une prestation avec +';
  go.disabled = !basket.length;
  if (basket.length) bookAttrs(go, { slugs: basket, source: 'carte-basket' }); else go.removeAttribute('data-book');
  $$<HTMLButtonElement>('.cx-add').forEach((b) => {
    const on = basket.includes(b.dataset.slug!);
    b.setAttribute('aria-pressed', String(on));
    b.disabled = !on && basket.length >= MAX;
  });
}

export function paintCarte() {
  const list = services();
  basket = basket.filter((s) => list.some((x) => x.slug === s));
  const cats = [...new Set(list.map((x) => x.category))];
  $('[data-cx]')!.replaceChildren(...cats.map((c, ci) => h('div', { class: 'cx-g' },
    h('h3', { class: 'cx-h' }, h('span', {}, String(ci + 1).padStart(2, '0')), c),
    h('ul', { class: 'cx-l' }, ...list.filter((x) => x.category === c).map((x) => {
      const add = h('button', { type: 'button', class: 'cx-add', 'data-slug': x.slug, 'aria-pressed': 'false', 'aria-label': 'Ajouter ' + x.name + ' au rendez-vous' }, svg(PLUS));
      const go = h('button', { type: 'button', class: 'cx-go', 'aria-label': 'Réserver ' + x.name + ' seule' }, svg(ARROW));
      bookAttrs(go, { slugs: [x.slug], source: 'carte' });
      return h('li', { class: 'cx-i' },
        h('span', { class: 'cx-n' }, h('b', {}, x.name), h('small', {}, x.includes.slice(0, 3).join(' · '))),
        h('span', { class: 'cx-d' }, dates.fmtDur(x.dur)),
        h('span', { class: 'cx-p' }, x.from ? h('small', {}, 'dès') : null, eur(x.price)),
        add, go);
    })))));
  paintBasket();
}

export function initCarte() {
  $('[data-cx]')!.addEventListener('click', (e) => {
    const b = (e.target as Element).closest<HTMLButtonElement>('.cx-add');
    if (!b) return;
    const s = b.dataset.slug!;
    basket = basket.includes(s) ? basket.filter((x) => x !== s) : basket.length < MAX ? [...basket, s] : basket;
    paintBasket();
  });
  paintCarte();
}
