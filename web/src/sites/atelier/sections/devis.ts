// Planche 07, the quote: services ticked lot by lot, with the rules a barber would apply (one cut at a
// time, no beard twice, no bleach twice, three services at most, like the sheet), and a live quote:
// lines, total, duration as a dimension line, the deposit the salon will ask for, the first free slot.
// Under the lots, the house rules ("dès", deposit, card), as the salon states them.
import * as S from '../../../site-kit/salon';
import { eur, dur, dates } from '../../../lib/format';
import { $, $$, h, text, fr, services, totals, prefill, idsOf, freeSlots, whenLong, barberOf, onSlots, keepFocus, type Svc, type Free } from '../util';
import { cote } from '../cote';
import { setAction, avoid } from './chrome';
import { book as openSheet } from '../sheet';

const CUTS = ['cl', 'cc', 'ct', 'tr', 'cd'];
const LOTS = [
  { n: 1, title: 'Coupe', hint: 'Une variante au choix' },
  { n: 2, title: 'Barbe', hint: 'Contour ou taille, la couleur en plus' },
  { n: 3, title: 'Couleur', hint: 'Une couleur au choix' }
];
const MAX = 3;

const keyOf = (s: Svc) => s.id || s.slug || s.name;
function lotOf(s: Svc) {
  if (s.pack) return 0;
  if ((s.slug && CUTS.includes(s.slug)) || s.category === 'Coupes') return 1;
  return s.category === 'Barbe' ? 2 : 3;
}
/** Services of the same group replace each other (radio-like, but the lot can be emptied). */
function group(s: Svc) {
  const l = lotOf(s);
  if (l === 1) return 'cut';
  if (l === 3) return 'color';
  return s.slug === 'eb' || s.slug === 'tb' ? 'beard' : null;
}
/** What a cut already contains, so the same work is never quoted twice. */
function includedIn(s: Svc, sel: Svc[]): Svc | null {
  if (s.slug === 'eb' || s.slug === 'tb') return sel.find((x) => x.slug === 'cc' || x.slug === 'ct') || null;
  if (s.slug === 'de') return sel.find((x) => x.slug === 'cd') || null;
  return null;
}

export function mountDevis() {
  const root = $('[data-dv]')!, rules = $('[data-spec-note]')!;
  let chosen: string[] = ['cl'];  // slugs or ids; the classic cut, so the quote is never an empty form
  let nextFree: Free | null = null, tok = 0, timer = 0;

  const lotsBox = $('[data-dv-lots]')!;
  const lines = h('ol', { class: 'qt-lines' });
  const total = h('b', null);
  const totalSr = h('span', { class: 'sr-only' });
  const dim = cote();
  const dep = h('p', { class: 'qt-dep' });
  const nx = h('div', { class: 'qt-next' });
  const validate = h('button', { type: 'button', class: 'btn', 'data-validate': '' }, 'Valider le devis');
  const clear = h('button', { type: 'button', class: 'tl', 'data-clear': '' }, 'Tout décocher');
  avoid('validate', validate);
  const date = h('span', { class: 'qt-date' });
  const quote = h('aside', { class: 'qt', 'aria-labelledby': 'qt-h' },
    h('div', { class: 'qt-head' }, h('span', { class: 'micro' }, 'Devis · Barber L’Architecte'), date),
    h('h3', { class: 'qt-h', id: 'qt-h' }, 'Ton devis'),
    lines,
    h('p', { class: 'qt-tot', 'aria-live': 'polite', 'aria-atomic': 'true' }, h('span', null, 'Total TTC'), total, totalSr),
    dim.el, dep, nx,
    h('div', { class: 'qt-a' }, validate, clear));
  root.append(quote);

  const all = () => services().filter((s) => lotOf(s) > 0);
  const sel = () => all().filter((s) => chosen.includes(keyOf(s)) || (!!s.slug && chosen.includes(s.slug)));

  function toggle(s: Svc) {
    const cur = sel();
    if (cur.some((x) => keyOf(x) === keyOf(s))) { chosen = cur.filter((x) => keyOf(x) !== keyOf(s)).map(keyOf); return; }
    const g = group(s);
    let next = cur.filter((x) => !(g && group(x) === g));
    next.push(s);
    // a cut that includes the beard (or the bleach) takes the separate line out
    next = next.filter((x) => !includedIn(x, next));
    if (next.length > MAX) return;
    chosen = next.map(keyOf);
  }

  function renderLots() {
    const list = all(), cur = sel();
    keepFocus(lotsBox, () => lotsBox.replaceChildren(...LOTS.map((lot) => {
      const items = list.filter((s) => lotOf(s) === lot.n);
      if (!items.length) return null;
      return h('fieldset', { class: 'lot' },
        h('legend', null, h('span', { class: 'pl' }, 'Lot ' + lot.n), h('b', null, lot.title), h('small', null, lot.hint)),
        h('ol', null, ...items.map((s, i) => {
          const k = keyOf(s), on = cur.some((x) => keyOf(x) === k);
          const inc = on ? null : includedIn(s, cur);
          const full = !on && !inc && cur.filter((x) => !(group(s) && group(x) === group(s))).length >= MAX;
          const why = inc ? fr('Déjà dans « ' + inc.name + ' »') : full ? 'Trois prestations au plus par rendez-vous' : '';
          return h('li', null, h('label', { class: 'item' + (on ? ' on' : '') + (why ? ' off' : '') },
            h('input', { type: 'checkbox', 'data-k': k, 'data-fk': s.slug || s.name, checked: on, disabled: !!why }),
            h('span', { class: 'item-n' }, lot.n + '.' + (i + 1)),
            h('span', { class: 'item-t' }, h('b', null, s.name), h('small', null, why || fr(s.includes.slice(0, 3).join(' · ')))),
            h('span', { class: 'item-d' }, dur(s.dur)),
            h('span', { class: 'item-p' }, (s.from ? 'dès ' : '') + eur(s.price)),
            h('i', { class: 'item-c', 'aria-hidden': 'true' })));
        })));
    }).filter(Boolean) as Node[]));
  }

  function renderQuote() {
    const cur = sel(), t = totals(cur);
    text(date, S.getSalon() ? dates.dayShort(S.today()) : '');
    const num = (s: Svc) => lotOf(s) + '.' + (all().filter((x) => lotOf(x) === lotOf(s)).findIndex((x) => keyOf(x) === keyOf(s)) + 1);
    lines.replaceChildren(...(cur.length ? cur.map((s) => h('li', null,
      h('span', { class: 'n' }, num(s)),
      h('span', { class: 'nm' }, s.name), h('span', { class: 'du' }, dur(s.dur)), h('b', null, (s.from ? 'dès ' : '') + eur(s.price))))
      : [h('li', { class: 'qt-empty' }, 'Aucune prestation cochée.')]));
    text(total, cur.length ? (t.from ? 'dès ' : '') + eur(t.price) : '—');
    text(totalSr, cur.length ? ', durée ' + dur(t.dur) : '');
    dim.set(t.dur);
    const ids = idsOf(cur), d = ids.length ? S.depositFor(ids) : 0;
    text(dep, !cur.length ? '' : fr(d ? 'Acompte demandé en ligne : ' + eur(d) + ', déduit au salon.' : 'Pas d’acompte : tu règles tout au salon.'));
    validate.disabled = !cur.length;
    clear.hidden = !cur.length;
    setAction('devis', cur.length ? { label: 'Valider le devis', sub: (t.from ? 'dès ' : '') + eur(t.price), run: book } : null);
    paintNext();
    clearTimeout(timer);
    timer = window.setTimeout(fetchNext, 300);
  }

  function paintNext() {
    const cur = sel();
    if (!cur.length || !idsOf(cur).length) { nx.replaceChildren(); return; }
    const who = nextFree ? barberOf(nextFree.staffId) : null;
    nx.replaceChildren(h('span', { class: 'micro' }, 'Premier créneau pour ce devis'),
      nextFree ? h('button', { type: 'button', class: 'chip', 'data-at': '', 'data-fk': 'at', 'aria-label': 'Réserver ce devis, ' + whenLong(nextFree) + (who ? ', avec ' + who.name : '') }, whenLong(nextFree) + (who ? ' · ' + who.name : ''))
        : h('span', { class: 'qt-wait' }, '…'));
  }
  function fetchNext() {
    const ids = idsOf(sel()), my = ++tok;
    if (!ids.length) return;
    freeSlots(ids, 'any', 1).then(([f]) => { if (my === tok) { nextFree = f || null; paintNext(); if (!f) text(nx, ''); } }, () => { if (my === tok) nx.replaceChildren(); });
  }

  function book() { const cur = sel(); if (cur.length) openSheet(prefill(cur), validate); }

  /** The house rules under the lots, from the salon's own settings (nothing said when it asks for none). */
  function renderRules() {
    const d = S.getSalon()?.deposits;
    const rule = d && d.mode === 'threshold' ? ' Acompte en ligne de ' + d.percent + ' % à partir de ' + eur(d.thresholdCents) + ' de prestations, déduit au salon.'
      : d && d.mode === 'all' ? ' Acompte en ligne de ' + d.percent + ' %, déduit au salon.' : '';
    text(rules, fr('« dès » : prix de départ, confirmé au fauteuil après un avis sur la faisabilité, avant qu’on commence. Carte bancaire acceptée au salon.' + rule));
  }

  lotsBox.addEventListener('change', (e) => {
    const k = (e.target as HTMLInputElement).dataset.k;
    const s = all().find((x) => keyOf(x) === k);
    if (!s) return;
    toggle(s);
    nextFree = null;
    renderLots(); renderQuote();
  });
  quote.addEventListener('click', (e) => {
    const t = e.target as Element;
    if (t.closest('[data-validate]')) book();
    else if (t.closest('[data-clear]')) { chosen = []; renderLots(); renderQuote(); $$<HTMLInputElement>('input', lotsBox)[0]?.focus(); }
    else if (t.closest('[data-at]') && nextFree) {
      const f = nextFree;
      openSheet(prefill(sel(), barberOf(f.staffId) || 'any', f.day, f.start), t.closest('button'));
    }
  });

  // once the live catalogue is in, the slugs chosen on first paint become the salon's ids
  onSlots(() => { chosen = sel().map(keyOf); nextFree = null; renderLots(); renderQuote(); renderRules(); });
  renderLots(); renderQuote(); renderRules();
}
