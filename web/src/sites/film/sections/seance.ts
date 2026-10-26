// 06 · La séance. The price list as a cinema programme: one ticket per service, grouped by category, each
// ticket opens the sheet on that service. The subscription gets its own booklet, stated as the salon states it.
import { onChange } from '../../../site-kit/salon';
import { eur } from '../../../lib/format';
import { services, priceText, durText, bookAttrs, type Svc } from '../data';
import { $, esc } from '../util';

const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI'];

function ticket(x: Svc) {
  const inc = x.includes.slice(0, 4).join(' · ') || x.description;
  return `<li><button type="button" class="tk" ${bookAttrs({ slug: x.slug, serviceIds: x.id ? [x.id] : undefined, source: 'film-tarif' })}>
    <span class="sr-only">Réserver : </span>
    <span class="tk-m"><span class="tk-n">${esc(x.name)}</span><span class="tk-i">${esc(inc)}</span></span>
    <span class="tk-d">${esc(durText(x))}</span>
    <span class="tk-p">${x.from ? '<small>dès</small>' : ''}${esc(eur(x.price))}</span>
  </button></li>`;
}

function booklet(x: Svc) {
  const per = x.credits ? eur(Math.round(x.price / x.credits)) : '';
  return `<div class="tk-book">
    <p class="tk-k">Le carnet</p>
    <h3 class="tk-bt">${esc(x.includes[0] || x.name)}</h3>
    <p class="tk-bl">${esc(priceText(x))}${per ? ', soit ' + esc(per) + ' la coupe' : ''}${x.includes.some((t) => /barbe/i.test(t)) ? ', hors barbe' : ''}.</p>
    <p class="tk-bd">Tu réserves la première, le salon fixe les suivantes avec toi.</p>
    <button type="button" class="btn" ${bookAttrs({ slug: x.slug, serviceIds: x.id ? [x.id] : undefined, source: 'film-carnet' })}>Réserver la première · ${esc(priceText(x))}</button>
  </div>`;
}

export function mountSeance() {
  const box = $('[data-prog]');
  if (!box) return;
  const paint = () => {
    const list = services();
    const cats = [...new Set(list.map((x) => x.category))];
    const groups = cats.map((c) => ({ c, items: list.filter((x) => x.category === c) }));
    const plain = groups.filter((g) => !g.items.every((x) => x.credits));
    const packs = list.filter((x) => x.credits);
    const html = `<div class="se-cols">${plain.map((g, i) => `<section class="se-g" aria-labelledby="se-${i}">
        <h3 class="se-gh" id="se-${i}"><span>Séance ${ROMAN[i] || i + 1}</span>${esc(g.c)}</h3>
        <ul class="tk-l">${g.items.filter((x) => !x.credits).map(ticket).join('')}</ul>
      </section>`).join('')}</div>${packs.map(booklet).join('')}`;
    if (box.dataset.html !== html) { box.dataset.html = html; box.innerHTML = html; }
  };
  paint();
  onChange(paint);
}
