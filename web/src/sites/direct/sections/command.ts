// The command bar, the page's signature: « Qu’est-ce qu’on te fait ? » in the visitor's own words, read as
// he types (parse.ts), shown back as four editable chips, and answered with real free slots, nearest to
// what he asked. When nothing fits, it says so and offers the closest; Entrée opens the sheet with
// everything filled in. ARIA 1.2 combobox: the input owns a listbox, ↑ ↓ move, Entrée books, Échap clears.
import { dates, eur } from '../../../lib/format';
import * as S from '../../../site-kit/salon';
import * as M from '../../../site-kit/memory';
import { openBooking } from '../../../site-kit/booking';
import { scrollToEl } from '../../../site-kit/motion';
import { parse, type Intent, type Win } from '../parse';
import { $, $$, h, svg, ARROW, dayName, mono, whenWords } from '../dom';
import { barber, barbers, pool, knownPool, services, slugsOf, total, type Free } from '../store';

type Over = { slugs?: string[]; staff?: string; day?: string; time?: string };
type Q = { slugs: string[]; auto: boolean; staff: string; day: string; win: Win | null; asap: boolean; timeLabel: string };
type Item = { f: Free; tag: string };

const TIMES: Record<string, { label: string; win: Win | null; asap?: boolean }> = {
  asap: { label: 'Le plus tôt', win: null, asap: true },
  am: { label: 'Le matin', win: { from: 0, to: 720, target: null } },
  noon: { label: 'Vers midi', win: { from: 720, to: 840, target: 720 } },
  pm: { label: 'L’après-midi', win: { from: 840, to: 1020, target: null } },
  eve: { label: 'Fin de journée', win: { from: 1020, to: 1440, target: null } }
};
for (let t = 540; t <= 1080; t += 60) TIMES['t' + t] = { label: 'Vers ' + dates.fmtTime(t), win: { from: t - 45, to: t + 45, target: t } };

let input: HTMLInputElement, list: HTMLElement, res: HTMLElement, chips: HTMLElement, sug: HTMLElement, sayOut: HTMLElement, live: HTMLElement;
let intent: Intent | null = null, over: Over = {}, items: Item[] = [], active = -1, seq = 0, liveTimer = 0;

const ctx = () => ({ today: S.today(), slugs: services().map((x) => x.slug), staff: barbers().map((b) => b.key) });

/** The query: what was typed, corrected by the chips, completed by memory ("comme d’hab") and defaults. */
function query(): Q {
  const i = intent!;
  const m = M.me();
  const againSlugs = i.again ? slugsOf(m.serviceIds) : [];
  const againStaff = i.again && m.staffId ? barber(m.staffId)?.key || '' : '';
  const slugs = over.slugs || (i.slugs.length ? i.slugs : againSlugs.length ? againSlugs : ['cl']);
  const t = over.time !== undefined ? TIMES[over.time] || null : null;
  return {
    slugs, auto: !over.slugs && !i.slugs.length && !againSlugs.length,
    staff: over.staff !== undefined ? over.staff : i.staff && i.staff !== 'any' ? i.staff : againStaff,
    day: over.day !== undefined ? over.day : i.day || '',
    win: over.time !== undefined ? t?.win || null : i.win,
    asap: over.time !== undefined ? !!t?.asap : i.asap,
    timeLabel: over.time !== undefined ? (t && over.time ? t.label.toLowerCase() : '') : i.timeLabel
  };
}

/* ---------------- matching: real slots, nearest first, honest when nothing fits ---------------- */

function match(all: Free[], q: Q): { items: Item[]; exact: boolean; why: string } {
  const inWin = (f: Free) => !q.win || (f.m >= q.win.from && f.m < q.win.to);
  const near = (a: Free, b: Free) => a.day.localeCompare(b.day) || (q.win?.target != null ? Math.abs(a.m - q.win.target) - Math.abs(b.m - q.win.target) : a.m - b.m);
  const mine = all.filter((f) => !q.staff || f.key === q.staff);
  const exact = mine.filter((f) => (!q.day || f.day === q.day) && inWin(f)).sort(near);
  // at most two barbers on the same minute, so the list shows choice, not repetition
  const cap = (l: Item[]) => { const seen = new Map<string, number>(); return l.filter((x) => { const k = x.f.day + x.f.m; const n = (seen.get(k) || 0) + 1; seen.set(k, n); return n <= 2; }).slice(0, 5); };
  if (exact.length) return { items: cap(exact.map((f) => ({ f, tag: '' }))), exact: true, why: '' };

  const out: Item[] = [];
  const add = (l: Free[], tag: string, n: number) => { for (const f of l) { if (out.length >= 5 || !n) break; if (!out.some((x) => x.f === f)) { out.push({ f, tag }); n--; } } };
  if (q.staff) add(all.filter((f) => f.key !== q.staff && (!q.day || f.day === q.day) && inWin(f)).sort(near), 'Autre barbier', 2);
  if (q.day) {
    const t = q.win ? (q.win.target ?? q.win.from) : 0;
    add(mine.filter((f) => f.day === q.day).sort((a, b) => Math.abs(a.m - t) - Math.abs(b.m - t)), 'Même jour', 2);
    add(mine.filter((f) => f.day > q.day && inWin(f)), 'Un autre jour', 2);
  }
  add(mine, '', 5 - out.length);
  const day = q.day ? dayPhrase(q.day) : '';
  let why = 'Rien de libre ' + [day, q.timeLabel, q.staff ? 'avec ' + (barber(q.staff)?.name || '') : ''].filter(Boolean).join(' ') + '.';
  if (q.day && !S.hoursOf(q.day).length) why = 'Le salon est fermé ' + (dates.diffDays(S.today(), q.day) < 7 ? 'le ' + dates.DAYS_FR[dates.dayParts(q.day).wd] : dates.dayLong(q.day)) + '.';
  else if (q.day && dates.diffDays(S.today(), q.day) > 13) why = 'Les créneaux en ligne s’affichent sur 14 jours.';
  else if (q.day && q.day < S.today()) why = 'Cette date est passée.';
  return { items: out, exact: false, why: why + (out.length ? ' Au plus près :' : '') };
}
function dayPhrase(day: string) {
  const n = dates.diffDays(S.today(), day);
  return n === 0 ? 'aujourd’hui' : n === 1 ? 'demain' : n === 2 ? 'après-demain' : 'le ' + dates.dayLong(day);
}

/* ---------------- drawing ---------------- */

function select(k: string, label: string, value: string, opts: [string, string][], auto = false) {
  const sel = h('select', { 'aria-label': k }) as HTMLSelectElement;
  for (const [v, t] of opts) sel.append(h('option', { value: v }, t));
  sel.value = value;
  sel.dataset.k = k;
  return h('label', { class: 'chip' + (auto ? ' auto' : '') + (value ? ' set' : '') }, h('span', { class: 'chip-k' }, k), h('span', { class: 'chip-v' }, label), sel, svg('<path d="M7 10l5 5 5-5"/>', 'chip-ic'));
}

function drawChips(q: Q) {
  const sv = services();
  const cur = q.slugs.join(',');
  const svcOpts: [string, string][] = sv.map((x) => [x.slug, x.name]);
  if (q.slugs.length > 1) svcOpts.unshift([cur, total(q.slugs).names.join(' + ')]);
  const staffOpts: [string, string][] = [['', 'Sans préférence'], ...barbers().map((b): [string, string] => [b.key, b.name])];
  const days = S.openDays(10);
  if (q.day && !days.includes(q.day)) days.unshift(q.day);
  const dayOpts: [string, string][] = [['', 'Dès que possible'], ...days.map((d): [string, string] => [d, dayName(d) + (S.hoursOf(d).length ? '' : ' · fermé')])];
  let tv = over.time !== undefined ? over.time : q.asap ? 'asap' : '';
  const timeOpts: [string, string][] = [['', 'Peu importe'], ...Object.entries(TIMES).map(([v, t]): [string, string] => [v, t.label])];
  if (over.time === undefined && q.win) { tv = 'x'; timeOpts.unshift(['x', q.timeLabel.replace(/^./, (c) => c.toUpperCase())]); }
  const b = barber(q.staff);
  chips.replaceChildren(
    select('Prestation', total(q.slugs).shorts.join(' + ') || 'Coupe', cur, svcOpts, q.auto),
    select('Barbier', b ? b.name : 'Sans préférence', q.staff, staffOpts),
    select('Jour', q.day ? dayName(q.day) : 'Dès que possible', q.day, dayOpts),
    select('Heure', tv === 'x' ? q.timeLabel : TIMES[tv]?.label || 'Peu importe', tv, timeOpts)
  );
}

function option(it: Item, i: number, slugs: string[]) {
  const b = barber(it.f.key), t = total(slugs);
  const li = h('li', { role: 'option', id: 'q-o' + i, class: 'opt', 'aria-selected': 'false', 'data-i': i },
    h('span', { class: 'opt-w' }, h('small', {}, dayName(it.f.day)), h('b', {}, dates.fmtTime(it.f.m))),
    h('span', { class: 'opt-s' }, h('span', { class: 'opt-n' }, t.shorts.join(' + ') + ' · ' + (t.from ? 'dès ' : '') + eur(t.price)),
      h('span', { class: 'opt-b' }, b ? mono(b, 'mono xs') : null, b ? 'avec ' + b.name : '', it.tag ? h('em', {}, it.tag) : null)),
    svg(ARROW, 'opt-go'));
  li.setAttribute('aria-label', whenWords(it.f.day, it.f.m) + (b ? ', avec ' + b.name : '') + ', ' + t.names.join(' + ') + (it.tag ? ', ' + it.tag.toLowerCase() : ''));
  return li;
}

function setActive(i: number) {
  active = items.length ? (i + items.length) % items.length : -1;
  $$('.opt', list).forEach((el, k) => el.setAttribute('aria-selected', String(k === active)));
  if (active >= 0) { input.setAttribute('aria-activedescendant', 'q-o' + active); $('#q-o' + active)?.scrollIntoView({ block: 'nearest' }); }
  else input.removeAttribute('aria-activedescendant');
}
function expand(on: boolean) { input.setAttribute('aria-expanded', String(on)); }
function announce(text: string) { clearTimeout(liveTimer); liveTimer = window.setTimeout(() => { live.textContent = text; }, 700); }

async function run() {
  const text = input.value;
  $('[data-q-clear]')!.hidden = !text;
  const empty = !text.trim() && !Object.keys(over).length;
  sug.hidden = !empty;
  chips.hidden = res.hidden = empty;
  if (empty) { items = []; list.replaceChildren(); expand(false); setActive(-1); return; }
  const q = query();
  drawChips(q);
  const my = ++seq;
  let all = knownPool(q.slugs);
  if (!all) {
    sayOut.textContent = 'On regarde les fauteuils…';
    list.replaceChildren(...[0, 1, 2].map(() => h('li', { class: 'opt sk-opt', 'aria-hidden': 'true' })));
    try { all = await pool(q.slugs); } catch {
      if (my !== seq) return;
      items = []; list.replaceChildren(); expand(false);
      sayOut.textContent = 'Le salon ne répond pas pour l’instant. Touche → : la feuille de réservation revérifie tout.';
      announce(sayOut.textContent);
      return;
    }
    if (my !== seq) return;
  } else pool(q.slugs).then(() => { if (my === seq) paintFrom(q); }, () => {});
  paintFrom(q, all);
}
function paintFrom(q: Q, all = knownPool(q.slugs) || []) {
  const r = match(all, q);
  items = r.items;
  list.replaceChildren(...items.map((it, i) => option(it, i, q.slugs)));
  const n = items.length;
  sayOut.textContent = !n ? (r.why || 'Aucun créneau en ligne sous 14 jours.') + ' La feuille de réservation te propose la liste d’attente.'
    : r.exact ? (n === 1 ? 'Un créneau colle.' : n + ' créneaux collent.') + ' Le plus proche : ' + whenWords(items[0].f.day, items[0].f.m) + '.'
      : r.why;
  sayOut.classList.toggle('miss', !r.exact);
  expand(n > 0);
  setActive(n ? 0 : -1);
  announce(sayOut.textContent);
}

function book(i = active) {
  const q = intent ? query() : null;
  const it = items[i >= 0 ? i : 0];
  if (it && q) openBooking({ slugs: q.slugs, staffKey: it.f.key, day: it.f.day, start: it.f.m, source: 'command' });
  else if (q) openBooking({ slugs: q.slugs, staffKey: q.staff || undefined, day: q.day || undefined, source: 'command' });
  else openBooking({ source: 'command' });
}

function onText() {
  const next = parse(input.value, ctx());
  // what the new text says wins over an earlier chip edit; what it doesn't say keeps the chip
  if (next.slugs.length) delete over.slugs;
  if (next.staff) delete over.staff;
  if (next.day) delete over.day;
  if (next.win || next.asap) delete over.time;
  if (!input.value.trim()) over = {};
  intent = next;
  run();
}

export function initCommand() {
  input = $<HTMLInputElement>('#q')!;
  list = $('#q-list')!; res = $('[data-res]')!; chips = $('[data-chips]')!; sug = $('[data-sug]')!; sayOut = $('[data-say-out]')!; live = $('[data-q-live]')!;
  intent = parse('', ctx());
  input.addEventListener('input', onText);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { if (!items.length) return; e.preventDefault(); setActive(active + (e.key === 'ArrowDown' ? 1 : -1)); }
    else if (e.key === 'Enter') { e.preventDefault(); if (input.value.trim() || Object.keys(over).length) book(); }
    else if (e.key === 'Escape') { if (input.value || Object.keys(over).length) { e.preventDefault(); input.value = ''; onText(); } }
  });
  // on a phone, the keyboard takes half the screen: bring the bar to the top so the answers stay in view
  input.addEventListener('focus', () => { if (matchMedia('(max-width: 899px)').matches) setTimeout(() => scrollToEl($('#commande'), 72), 260); });
  list.addEventListener('click', (e) => { const li = (e.target as Element).closest<HTMLElement>('.opt[data-i]'); if (li) book(Number(li.dataset.i)); });
  list.addEventListener('mousemove', (e) => { const li = (e.target as Element).closest<HTMLElement>('.opt[data-i]'); if (li && Number(li.dataset.i) !== active) setActive(Number(li.dataset.i)); });
  chips.addEventListener('change', (e) => {
    const sel = e.target as HTMLSelectElement, v = sel.value, k = sel.dataset.k;
    if (k === 'Prestation') over.slugs = v.split(',');
    else if (k === 'Barbier') over.staff = v;
    else if (k === 'Jour') over.day = v;
    else if (k === 'Heure') { if (v !== 'x') over.time = v; }
    run();
  });
  $('[data-q-go]')!.addEventListener('click', () => book());
  $('[data-q-clear]')!.addEventListener('click', () => { input.value = ''; onText(); input.focus(); });
  sug.addEventListener('click', (e) => {
    const b = (e.target as Element).closest<HTMLElement>('[data-say]');
    if (!b) return;
    input.value = b.dataset.say!;
    onText();
    if (matchMedia('(hover: hover)').matches) input.focus();
  });
}
/** New slots (a minute passed, someone booked): redraw the answers without touching what was typed. */
export function refreshCommand() { if (intent && !res.hidden) run(); }
