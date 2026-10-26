// 02 · Les départs. The next free starts across every barber, on a split-flap board: heure, jour, barbier,
// and a row that books exactly that. The service is said once, above the rows (every row is the same one).
// Filters by service and by barber. The flaps only turn when a value changes (a minute passed, someone
// booked) and only while the board is on screen.
import { dates, eur, dur } from '../../../lib/format';
import * as S from '../../../site-kit/salon';
import { $, h, svg, ARROW, bookAttrs, watch, whenWords } from '../dom';
import { Flap } from '../flap';
import { barber, barbers, knownPool, pool, setShared, shared, svc } from '../store';

const TABS = [{ slug: 'cl', label: 'Coupe' }, { slug: 'ct', label: 'Coupe + barbe' }, { slug: 'tb', label: 'Barbe' }];
const ROWS = 8;
type Row = { li: HTMLLIElement; btn: HTMLButtonElement; time: Flap; day: Flap; staff: Flap; dot: HTMLElement };

let rows: Row[] = [];
let seen = false, pending = false, failed = false, painted = '';
let onData: () => void = () => {};

/** "AUJ.", "DEMAIN", "JEU 29": six cells */
function flapDay(day: string) {
  const n = dates.diffDays(S.today(), day);
  if (n === 0) return 'AUJ.';
  if (n === 1) return 'DEMAIN';
  const p = dates.dayParts(day);
  return dates.DAYS_SH[p.wd].replace('.', '') + ' ' + p.d;
}

function row(): Row {
  const time = new Flap(5, 'fx-t'), day = new Flap(6, 'fx-s'), staff = new Flap(9, 'fx-s');
  const dot = h('i', { class: 'bd-dot', 'aria-hidden': 'true' });
  const btn = h('button', { type: 'button', class: 'bd-b', disabled: true },
    h('span', { class: 'bd-t' }, time.el),
    h('span', { class: 'bd-d' }, day.el),
    h('span', { class: 'bd-s' }, dot, staff.el),
    h('span', { class: 'bd-go', 'aria-hidden': 'true' }, h('span', {}, 'Réserver'), svg(ARROW)));
  const li = h('li', { class: 'bd-r' }, btn);
  return { li, btn, time, day, staff, dot };
}

function list() {
  const st = shared();
  const all = knownPool([st.svc]);
  return { all, rows: (all || []).filter((f) => st.staff === 'any' || f.key === st.staff).slice(0, ROWS) };
}
/** what the rows say, so a refresh that changes nothing turns nothing */
const signature = () => { const { all, rows: l } = list(); return (all ? 'k' : 'u') + shared().svc + l.map((f) => f.day + f.m + f.key).join('|'); };

function paint(animate: boolean) {
  const st = shared();
  const s = svc(st.svc);
  const { all, rows: l } = list();
  painted = signature();
  const none = !!all && !l.length;
  rows.forEach((r, i) => {
    const f = l[i];
    const b = f ? barber(f.key) : null;
    r.li.classList.toggle('off', !f);
    r.li.hidden = none;
    r.btn.disabled = !f;
    if (f && b) {
      r.time.set(dates.hhmm(f.m), animate, i * 70);
      r.day.set(flapDay(f.day), animate, i * 70 + 60);
      r.staff.set(b.name, animate, i * 70 + 120);
      r.dot.style.setProperty('--c', b.color);
      bookAttrs(r.btn, { slugs: [st.svc], staff: f.key, day: f.day, start: f.m, source: 'board' });
      r.btn.setAttribute('aria-label', 'Réserver ' + whenWords(f.day, f.m) + ', ' + (s?.name || '') + ', avec ' + b.name);
      r.li.removeAttribute('aria-hidden');
    } else {
      r.time.set(all ? '--:--' : '', animate, i * 70);
      r.day.set('', animate);
      r.staff.set('', animate);
      r.dot.style.removeProperty('--c');
      r.btn.removeAttribute('data-book');
      r.btn.removeAttribute('aria-label');
      r.li.setAttribute('aria-hidden', 'true');
    }
  });
  $('[data-rows]')!.classList.toggle('none', none);
  const cap = $('[data-bd-cap]');
  if (cap && s) cap.replaceChildren(h('b', {}, s.name), h('span', {}, (s.from ? 'dès ' : '') + eur(s.price) + ' · ' + dur(s.dur)));
  const empty = $('[data-bd-empty]');
  if (empty) empty.hidden = !none;
  const stamp = $('[data-bd-stamp]');
  if (stamp) stamp.textContent = failed ? 'Le salon ne répond pas · nouvel essai dans une minute' : all ? 'En direct · mis à jour à ' + dates.hhmm(S.nowMin()) : 'Connexion au salon…';
  const allBtn = $('[data-bd-all]');
  if (allBtn) { bookAttrs(allBtn, { slugs: [st.svc], staff: st.staff === 'any' ? null : st.staff, source: 'board-all' }); allBtn.textContent = 'Tous les créneaux · ' + (TABS.find((t) => t.slug === st.svc)?.label || '') + (st.staff !== 'any' ? ' avec ' + (barber(st.staff)?.name || '') : ''); }
}

function seg(host: HTMLElement, items: { v: string; t: string }[], cur: string, on: (v: string) => void) {
  host.replaceChildren(...items.map((it) => h('button', { type: 'button', class: 'seg-b', 'aria-pressed': String(it.v === cur), 'data-v': it.v }, it.t)));
  host.onclick = (e) => {
    const b = (e.target as Element).closest<HTMLElement>('.seg-b');
    if (!b) return;
    host.querySelectorAll('.seg-b').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    on(b.dataset.v!);
  };
}
/** The filters, from the team the salon publishes (redrawn once it answers, whenever that is). */
export function drawFilters() {
  const st = shared();
  if (st.staff !== 'any' && !barbers().some((b) => b.key === st.staff)) st.staff = 'any';
  seg($('[data-bd-svc]')!, TABS.map((t) => ({ v: t.slug, t: t.label })), st.svc, (v) => { setShared({ svc: v }); refreshBoard(); });
  seg($('[data-bd-staff]')!, [{ v: 'any', t: 'Tous' }, ...barbers().map((b) => ({ v: b.key, t: b.name }))], st.staff, (v) => { setShared({ staff: v }); paint(true); });
}

/** Fetch (cached a few seconds by the kit) and redraw; flaps turn only if the board is on screen. */
export function refreshBoard(fresh = false) {
  const slug = shared().svc;
  return pool([slug], fresh).then(() => { failed = false; }, () => { failed = true; }).then(() => {
    if (shared().svc !== slug) return;
    onData();
    const changed = signature() !== painted;
    if (seen) paint(true);
    else { if (changed) pending = true; paint(false); }
  });
}
/** The salon could not be reached at all: say so on the board instead of « Connexion… ». */
export function boardFailed() { failed = true; paint(false); }

export function initBoard(whenData: () => void) {
  onData = whenData;
  const host = $('[data-rows]')!;
  rows = Array.from({ length: ROWS }, row);
  host.replaceChildren(...rows.map((r) => r.li));
  host.before(h('p', { class: 'bd-empty', 'data-bd-empty': '', hidden: true }, 'Rien sous 14 jours pour cette prestation. Touche « Tous les créneaux » : tu peux te mettre sur liste d’attente.'));
  drawFilters();
  paint(false);
  watch($('[data-board]'), (on) => {
    seen = on;
    // values that changed while the board was away turn as it comes back; unchanged ones stay put
    if (on && pending) { pending = false; rows.forEach((r) => { r.time.set('', false); r.day.set('', false); r.staff.set('', false); }); paint(true); }
  }, '-10% 0px');
}
