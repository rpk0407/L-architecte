// Planche 03, the signature: four questions (three for a beard only), then a plan drawn from the live
// catalogue: the services, their real price and duration, a barber matched on what his own bio says
// (or nobody in particular), and the real next free slot for that exact combination. "Réserver ce plan"
// opens the sheet with all of it filled in.
// Native radio groups (arrow keys, Space, labels); a pointer click moves on by itself, the keyboard
// moves on with Enter or "Suivant", so arrowing through the options never skips a question.
import * as S from '../../../site-kit/salon';
import { openBooking } from '../../../site-kit/booking';
import { reduced, scrollToEl } from '../../../site-kit/motion';
import { dates, eur, dur } from '../../../lib/format';
import { $, h, text, services, barbers, svcBySlug, totals, prefill, idsOf, freeSlots, whenLong, whenShort, endOfWeek, type Svc, type Bar, type Free } from '../util';
import { cote } from '../cote';
import { setAction } from './chrome';

type Ans = { goal?: string; beard?: string; color?: string; when?: string };
type Opt = { v: string; t: string; s: string };
type Q = { id: keyof Ans; label: string; title: string; opts: Opt[] };

const incl = (slug: string, alt: string) => svcBySlug(slug)?.includes.slice(0, 3).join(' · ') || alt;

function questions(a: Ans): Q[] {
  const beardOnly = a.goal === 'beard';
  const qs: Q[] = [
    { id: 'goal', label: 'Objectif', title: 'Ton objectif ?', opts: [
      { v: 'keep', t: 'Entretenir ma coupe', s: 'Même ligne, remise au propre' },
      { v: 'change', t: 'Changer de tête', s: 'On étudie ce qui est faisable' },
      { v: 'beard', t: 'M’occuper de la barbe', s: 'Sans toucher aux cheveux' }] },
    beardOnly
      ? { id: 'beard', label: 'Barbe', title: 'Ta barbe, on en fait quoi ?', opts: [
        { v: 'contour', t: 'La contourer', s: incl('eb', 'Contour, huile') },
        { v: 'trim', t: 'La tailler', s: incl('tb', 'Taille, mise en forme, huile') },
        { v: 'cover', t: 'La couvrir', s: incl('cb', 'Couleur de la barbe, soin') }] }
      : { id: 'beard', label: 'Barbe', title: 'Ta barbe ?', opts: [
        { v: 'none', t: 'Pas de barbe', s: 'Rasé ou presque' },
        { v: 'contour', t: 'À contourer', s: 'Des lignes nettes' },
        { v: 'trim', t: 'À tailler', s: 'Longueur et forme' }] }
  ];
  if (!beardOnly) qs.push({ id: 'color', label: 'Couleur', title: 'La couleur ?', opts: [
    { v: 'none', t: 'Non', s: 'Ta couleur naturelle' },
    { v: 'bleach', t: 'Décoloration', s: 'Blond, platine, après avis sur la faisabilité' },
    { v: 'silver', t: 'Silver', s: 'Blanc ou gris' }] });
  qs.push({ id: 'when', label: 'Quand', title: 'Quand ?', opts: [
    { v: 'asap', t: 'Au plus vite', s: 'Le premier créneau libre' },
    { v: 'week', t: 'Cette semaine', s: endOfWeek() === S.today() ? 'D’ici ce soir' : 'D’ici samedi' },
    { v: 'plan', t: 'Je planifie', s: 'Je choisis mon jour' }] });
  return qs;
}

/** Answers → services, by slug. A colour that includes the cut replaces it; the beard rides along. */
function slugsFor(a: Ans): string[] {
  if (a.goal === 'beard') return [a.beard === 'trim' ? 'tb' : a.beard === 'cover' ? 'cb' : 'eb'];
  const addon = a.beard === 'contour' ? 'eb' : a.beard === 'trim' ? 'tb' : null;
  if (a.color === 'bleach') return ['cd', addon].filter(Boolean) as string[];
  if (a.goal === 'change') return ['tr', a.color === 'silver' ? 'si' : null, addon].filter(Boolean) as string[];
  return [a.beard === 'contour' ? 'cc' : a.beard === 'trim' ? 'ct' : 'cl', a.color === 'silver' ? 'si' : null].filter(Boolean) as string[];
}

/** The barber whose own words fit the answers best; null when nobody stands out. */
const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
function matchBarber(a: Ans): Bar | null {
  const wants: [string[], number][] = [];
  if (a.goal === 'keep') wants.push([['degrade', 'fade', 'classique', 'precision'], 2]);
  if (a.goal === 'change') wants.push([['transformation', 'texture', 'boucle'], 2]);
  if (a.beard === 'trim') wants.push([['barbe', 'taill'], 1.5]);
  if (a.beard === 'contour') wants.push([['contour'], 1.5]);
  if (a.beard === 'cover') wants.push([['couleur'], 1.5]);
  if (a.color === 'bleach' || a.color === 'silver') wants.push([['couleur', 'silver', 'decolor'], 3]);
  let best: Bar | null = null, top = 0;
  for (const b of barbers()) {
    const bio = norm(b.bio);
    const score = wants.reduce((t, [kw, w]) => t + (kw.some((k) => bio.includes(k)) ? w : 0), 0);
    if (score > top) { top = score; best = b; }
  }
  return best;
}

export function mountDiagnostic() {
  const root = $('[data-dx]')!;
  const a: Ans = {};
  let step = 0, done = false, who: 'match' | 'any' = 'match', viaKeys = false, tok = 0;
  let found: Free[] = [], note = '', slotErr = false;

  const live = h('p', { class: 'sr-only', role: 'status', 'aria-live': 'polite' });
  const count = h('p', { class: 'micro dx-count' });
  const prog = h('ol', { class: 'dx-prog', 'aria-hidden': 'true' });
  const stage = h('div', { class: 'dx-stage' });
  const prev = h('button', { type: 'button', class: 'tl dx-prev' }, '← Précédent');
  const next = h('button', { type: 'button', class: 'btn ink dx-next' }, 'Suivant');
  const qBox = h('div', { class: 'dx-q' }, h('div', { class: 'dx-top' }, count, prog), stage, h('div', { class: 'dx-nav' }, prev, next));
  const plan = h('div', { class: 'dx-plan' });
  root.append(qBox, plan, live);

  const qs = () => questions(a);
  const list = (): Svc[] => slugsFor(a).map(svcBySlug).filter((s): s is Svc => !!s);
  const barber = () => (who === 'match' ? matchBarber(a) : null);

  function drop() {
    // an answer that no longer fits the questions (beard "cover" after switching away from beard-only)
    for (const q of qs()) { const v = a[q.id]; if (v && !q.opts.some((o) => o.v === v)) delete a[q.id]; }
    if (a.goal === 'beard') delete a.color;
  }

  function renderQ() {
    const all = qs(), q = all[step];
    text(count, done ? 'Plan tracé' : 'Question ' + (step + 1) + ' sur ' + all.length);
    prog.replaceChildren(...all.map((x, i) => h('li', { class: a[x.id] ? 'on' : i === step ? 'cur' : '' })));
    if (done) {
      stage.replaceChildren(h('ol', { class: 'dx-recap' }, ...all.map((x, i) => h('li', null,
        h('span', { class: 'micro' }, 'Q' + (i + 1) + ' · ' + x.label),
        h('b', null, x.opts.find((o) => o.v === a[x.id])?.t || '—'),
        h('button', { type: 'button', class: 'tl', 'data-edit': i, 'aria-label': 'Modifier : ' + x.label }, 'Modifier')))));
      prev.hidden = true; next.hidden = true;
      return;
    }
    const name = 'dx-' + q.id;
    const fs = h('fieldset', { class: 'dx-fs' },
      h('legend', { class: 'dx-leg', tabindex: '-1' }, h('span', { class: 'micro' }, 'Q' + (step + 1) + ' · ' + q.label), h('span', { class: 'dx-lt' }, q.title)),
      h('div', { class: 'dx-opts' }, ...q.opts.map((o, i) => h('label', { class: 'opt' },
        h('input', { type: 'radio', name, value: o.v, checked: a[q.id] === o.v }),
        h('span', { class: 'opt-k', 'aria-hidden': 'true' }, String.fromCharCode(65 + i)),
        h('span', { class: 'opt-t' }, h('b', null, o.t), h('small', null, o.s)),
        h('i', { class: 'opt-c', 'aria-hidden': 'true' })))));
    stage.replaceChildren(fs);
    prev.hidden = step === 0; next.hidden = false;
    next.disabled = !a[q.id];
    text(next, step === all.length - 1 ? 'Tracer mon plan' : 'Suivant');
  }

  function focusQ() {
    const target = viaKeys ? (stage.querySelector('input:checked') || stage.querySelector('input')) as HTMLElement | null : $('.dx-leg', stage);
    target?.focus({ preventScroll: true });
  }

  function go(to: number) {
    const all = qs();
    if (to >= all.length) { finish(); return; }
    step = Math.max(0, to);
    renderQ(); renderPlan(); focusQ();
  }

  function finish() {
    done = true;
    renderQ(); renderPlan();
    fetchSlot();
    // phones: the plan sits under the recap; bring its title to the reading line
    const title = $('.plan-h', plan);
    title?.focus({ preventScroll: true });
    if (matchMedia('(max-width: 899px)').matches) scrollToEl(plan, 84);
  }

  function reset() {
    for (const k of Object.keys(a) as (keyof Ans)[]) delete a[k];
    done = false; who = 'match'; found = []; note = ''; slotErr = false; tok++;
    setAction('diagnostic', null);
    go(0);
    text(live, 'Diagnostic remis à zéro.');
  }

  /* ---------- the plan ---------- */

  const dim = cote();
  function renderPlan() {
    const all = qs();
    plan.classList.toggle('done', done);
    root.classList.toggle('done', done);
    if (!done) {
      plan.replaceChildren(
        h('p', { class: 'micro plan-k' }, h('span', { class: 'pl' }, 'Plan'), 'En cours de tracé'),
        h('ol', { class: 'plan-dims' }, ...all.map((x, i) => h('li', { class: a[x.id] ? 'on' : i === step ? 'cur' : '' },
          h('span', { class: 'n' }, 'Q' + (i + 1)), h('span', null, x.label), h('b', null, x.opts.find((o) => o.v === a[x.id])?.t || '…')))),
        h('p', { class: 'plan-hint' }, 'Le plan se trace au fil de tes réponses.'));
      return;
    }
    const l = list(), t = totals(l), match = matchBarber(a);
    if (!match) who = 'any';
    dim.set(t.dur);
    const whoOpt = (v: 'match' | 'any', title: string, sub: string, mono?: Bar) => h('label', { class: 'who' },
      h('input', { type: 'radio', name: 'dx-who', value: v, checked: who === v }),
      mono ? h('span', { class: 'mono', style: `--c:${mono.color}`, 'aria-hidden': 'true' }, mono.initials) : h('span', { class: 'mono any', 'aria-hidden': 'true' }, '∗'),
      h('span', { class: 'who-t' }, h('b', null, title), h('small', null, sub)));
    plan.replaceChildren(
      h('p', { class: 'micro plan-k' }, h('span', { class: 'pl' }, 'Plan'), 'Tracé le ' + dates.dayShort(S.today())),
      h('h3', { class: 'plan-h', tabindex: '-1' }, l.map((s) => s.name).join(' + ')),
      h('ol', { class: 'plan-lines' }, ...l.map((s, i) => h('li', null,
        h('span', { class: 'n' }, 'Art. ' + (i + 1)), h('span', { class: 'nm' }, s.name), h('span', { class: 'du' }, dur(s.dur)), h('b', null, (s.from ? 'dès ' : '') + eur(s.price))))),
      h('p', { class: 'plan-tot' }, h('span', null, 'Total'), h('b', null, (t.from ? 'dès ' : '') + eur(t.price))),
      dim.el,
      h('fieldset', { class: 'plan-who' }, h('legend', { class: 'micro' }, 'Avec'),
        match ? whoOpt('match', match.name, 'Conseillé · « ' + match.bio + ' »', match) : null,
        whoOpt('any', 'Peu importe', 'Le premier barbier libre')),
      h('div', { class: 'plan-slot', 'data-slot': '' }),
      h('div', { class: 'plan-a' },
        h('button', { type: 'button', class: 'btn', 'data-book-plan': '' }, 'Réserver ce plan'),
        h('button', { type: 'button', class: 'tl', 'data-reset': '' }, 'Recommencer')));
    paintSlot();
    setAction('diagnostic', { label: 'Réserver ce plan', sub: (t.from ? 'dès ' : '') + eur(t.price), run: () => book() });
  }

  function paintSlot() {
    const box = $('[data-slot]', plan);
    if (!box) return;
    const l = list();
    if (!idsOf(l).length || slotErr) { box.replaceChildren(h('p', { class: 'plan-none' }, 'Les créneaux se chargent dans la réservation.')); return; }
    if (!found.length) { box.replaceChildren(h('p', { class: 'micro' }, 'Premier créneau'), h('p', { class: 'plan-wait' }, note || 'On cherche…')); return; }
    if (a.when === 'plan') {
      box.replaceChildren(h('p', { class: 'micro' }, 'Prochains jours libres'),
        h('div', { class: 'chips' }, ...found.map((f) => h('button', { type: 'button', class: 'chip', 'data-slot-at': f.day + '|' + f.start + '|' + f.staffId }, whenShort(f)))));
      return;
    }
    const f = found[0];
    box.replaceChildren(h('p', { class: 'micro' }, 'Premier créneau'),
      h('button', { type: 'button', class: 'slot-big', 'data-slot-at': f.day + '|' + f.start + '|' + f.staffId },
        h('b', null, whenLong(f)), h('small', null, who === 'any' && barbers().find((x) => x.id === f.staffId) ? 'avec ' + barbers().find((x) => x.id === f.staffId)!.name : 'Touche pour le prendre')),
      note ? h('p', { class: 'plan-note' }, note) : null);
  }

  function fetchSlot() {
    const ids = idsOf(list());
    const my = ++tok;
    found = []; note = ''; slotErr = false;
    paintSlot();
    if (!ids.length) return;
    const b = barber(), staff = b?.id || 'any';
    const done_ = (f: Free[], n = '') => {
      if (my !== tok) return;
      found = f; note = n;
      if (!f.length) note = 'Rien de libre en ligne sur 14 jours pour ce plan. Réserve quand même : la liste d’attente te prévient.';
      paintSlot();
      const l = list(), t = totals(l);
      text(live, 'Ton plan : ' + l.map((s) => s.name).join(' + ') + ', ' + (t.from ? 'dès ' : '') + eur(t.price) + ', ' + dur(t.dur) + (b ? ', avec ' + b.name : '') + (f[0] ? '. Premier créneau : ' + whenLong(f[0]) + '.' : '.'));
    };
    const fail = () => { if (my === tok) { slotErr = true; paintSlot(); } };
    if (a.when === 'plan') freeSlots(ids, staff, 4, { perDay: true }).then((f) => done_(f), fail);
    else if (a.when === 'week') {
      const until = endOfWeek();
      freeSlots(ids, staff, 1, { until }).then((f) => f.length ? done_(f) : freeSlots(ids, staff, 1).then((g) => done_(g, g.length ? 'Plus rien cette semaine pour ce plan : voici le premier créneau après.' : '')), fail);
    } else freeSlots(ids, staff, 1).then((f) => done_(f), fail);
  }

  function book(at?: string) {
    const l = list(), b = barber();
    if (at) {
      const [day, start, staffId] = at.split('|');
      const bar = b || barbers().find((x) => x.id === staffId) || 'any';
      openBooking({ ...prefill(l, bar, day, Number(start)), source: 'atelier-diagnostic' });
    } else if (found[0] && a.when !== 'plan') book(found[0].day + '|' + found[0].start + '|' + found[0].staffId);
    else openBooking({ ...prefill(l, b || 'any'), source: 'atelier-diagnostic' });
  }

  /* ---------- events ---------- */

  root.addEventListener('keydown', (e) => {
    viaKeys = true;
    const t = e.target as HTMLInputElement;
    if (e.key === 'Enter' && t.type === 'radio' && t.name !== 'dx-who' && t.checked) { e.preventDefault(); go(step + 1); }
  });
  root.addEventListener('pointerdown', () => { viaKeys = false; });
  root.addEventListener('change', (e) => {
    const t = e.target as HTMLInputElement;
    if (t.name === 'dx-who') { who = t.value as 'match' | 'any'; fetchSlot(); return; }
    const q = qs()[step];
    if (!q || t.name !== 'dx-' + q.id) return;
    a[q.id] = t.value;
    drop();
    next.disabled = false;
    prog.replaceChildren(...qs().map((x, i) => h('li', { class: a[x.id] ? 'on' : i === step ? 'cur' : '' })));
    text(count, 'Question ' + (step + 1) + ' sur ' + qs().length);
    renderPlan();
  });
  root.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    const opt = t.closest('.opt');
    // a click with a pointer (detail > 0) moves on; keyboard "clicks" (arrows, Space) have detail 0
    if (opt && (e as MouseEvent).detail > 0 && !done) {
      const q = qs()[step], cur = step;
      setTimeout(() => { if (step === cur && a[q.id] && !done) go(step + 1); }, reduced() ? 0 : 260);
      return;
    }
    const at = t.closest<HTMLElement>('[data-slot-at]');
    if (at) { book(at.dataset.slotAt); return; }
    if (t.closest('[data-book-plan]')) { book(); return; }
    if (t.closest('[data-reset]')) { reset(); return; }
    const ed = t.closest<HTMLElement>('[data-edit]');
    if (ed) { done = false; setAction('diagnostic', null); go(Number(ed.dataset.edit)); }
  });
  prev.addEventListener('click', () => go(step - 1));
  next.addEventListener('click', () => go(step + 1));
  addEventListener('lx:booked', () => { if (done) fetchSlot(); });
  S.loadSalon().then(() => { if (done) { renderPlan(); fetchSlot(); } else renderQ(); }, () => {});

  renderQ(); renderPlan();
}
