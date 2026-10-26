// The booking sheet shared by every version of the site. No framework: a dialog built once, re-drawn per step.
// Prestation → barbier → créneau → coordonnées → confirmé. The slot is held on the salon's side while the
// client types; the server re-checks everything at confirmation, so what the sheet shows is never a promise
// the salon cannot keep.
//
// Pages open it with openBooking({ slugs: ['ct'], staffKey: 'frank', day, start }) or with markup:
//   <button data-book data-book-slug="ct" data-book-staff="frank">Réserver</button>
import { dates, eur } from '../lib/format';
import * as S from './salon';
import * as M from './memory';
import { reduced } from './motion';
import './booking.css';

export type Prefill = { serviceIds?: string[]; slugs?: string[]; staffId?: string; staffKey?: string; day?: string; start?: number; source?: string };
type Step = 'svc' | 'who' | 'when' | 'info' | 'done';
type Result = S.BookResult & { day: string; start: number; serviceIds: string[]; staffId: string; first: string };
type State = {
  step: Step; serviceIds: string[]; multi: boolean; staffId: string | null; day: string | null; start: number | null;
  hold: { id: string; exp: number; staffId: string } | null; holdTok: number; busy: boolean; err: string;
  waited: string | null; waitAsk: boolean; offer: boolean; result: Result | null;
  form: { first: string; last: string; phone: string; email: string; note: string; sms: boolean };
};
const ORDER: Step[] = ['svc', 'who', 'when', 'info'];
const LABEL: Record<Step, string> = { svc: 'Prestation', who: 'Barbier', when: 'Créneau', info: 'Coordonnées', done: 'Confirmé' };
const TITLE: Record<Step, string> = { svc: 'On te fait quoi ?', who: 'Avec qui ?', when: 'Quand ?', info: 'À ton nom', done: 'C’est réservé.' };
const PERIODS = [{ t: 'Matin', a: 0, z: 720 }, { t: 'Midi', a: 720, z: 840 }, { t: 'Après-midi', a: 840, z: 1020 }, { t: 'Fin de journée', a: 1020, z: 1440 }];

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const fmtPhone = (v: string) => { let d = String(v || '').replace(/[^\d+]/g, ''); if (d.startsWith('+33')) d = '0' + d.slice(3); return d.replace(/\D/g, '').slice(0, 10).replace(/(\d{2})(?=\d)/g, '$1 ').trim(); };
const phoneOk = (v: string) => { const d = v.replace(/\D/g, ''); return d.length === 10 && d[0] === '0'; };
const emailOk = (v: string) => !v.trim() || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v.trim());
const capFirst = (t: string) => { t = t.trim(); return t ? t.charAt(0).toUpperCase() + t.slice(1) : ''; };
const dayWord = (d: string) => { const n = dates.diffDays(S.today(), d); return n === 0 ? 'Aujourd’hui' : n === 1 ? 'Demain' : capFirst(dates.dayLong(d)); };
const t = (m: number) => dates.fmtTime(m);

let root: HTMLElement | null = null;
let st: State = fresh();
let isOpen = false, depth = 0, closing = false, opener: Element | null = null, timer = 0;

function fresh(): State {
  const m = M.me();
  return {
    step: 'svc', serviceIds: [], multi: false, staffId: null, day: null, start: null, hold: null, holdTok: 0, busy: false, err: '',
    waited: null, waitAsk: false, offer: false, result: null,
    form: { first: m.first, last: m.last, phone: m.phone ? fmtPhone(m.phone) : '', email: m.email, note: '', sms: true }
  };
}

/* ---------------- public ---------------- */

export function openBooking(p: Prefill = {}) {
  mount();
  S.loadSalon().then(() => {
    if (!st.result && st.step !== 'done' && !p.serviceIds && !p.slugs && !p.staffId && !p.staffKey && !p.day && (st.serviceIds.length || st.staffId)) { show(); return; }
    st = { ...fresh(), form: st.form };
    const sal = S.getSalon()!;
    const ids = (p.serviceIds || (p.slugs || []).map((s) => S.serviceBySlug(s)?.id || '')).filter((id) => sal.services.some((s) => s.id === id));
    st.serviceIds = ids;
    const staff = p.staffId && (p.staffId === 'any' || S.barberById(p.staffId)) ? p.staffId : p.staffKey ? (p.staffKey === 'any' ? 'any' : sal.barbers.find((b) => S.barberKey(b) === p.staffKey)?.id || null) : null;
    st.staffId = staff;
    if (p.day && p.start != null) { st.day = p.day; st.start = p.start; }
    else if (p.day) st.day = p.day;
    goto(nextStep(), false);
    show();
  }).catch(() => { show(); err('Le salon ne répond pas. Réessaie dans un instant, ou appelle-nous.'); });
}
export function closeBooking() { hide(true); }
export const isBookingOpen = () => isOpen;

/** Wires [data-book] buttons, ?reserver and waiting-list offer links (?offre=…). Call once per page. */
export function bootBooking() {
  document.addEventListener('click', (e) => {
    const el = (e.target as Element).closest?.('[data-book]') as HTMLElement | null;
    if (!el) return;
    e.preventDefault();
    opener = el;
    const d = el.dataset;
    openBooking({ slugs: d.bookSlug ? d.bookSlug.split(',') : undefined, serviceIds: d.bookService ? d.bookService.split(',') : undefined, staffKey: d.bookStaff, staffId: d.bookStaffId, day: d.bookDay, start: d.bookStart ? Number(d.bookStart) : undefined, source: d.bookSource });
  });
  let q: URLSearchParams;
  try { q = new URLSearchParams(location.search); } catch { return; }
  const tok = q.get('offre');
  if (tok) {
    history.replaceState(null, '', location.pathname + location.hash);
    mount();
    S.loadSalon().then(() => S.offer(tok)).then((o) => {
      st = { ...fresh(), serviceIds: [o.serviceId], staffId: o.staffId, day: o.day, start: o.start, hold: { id: o.holdId, exp: o.exp - (S.now() - Date.now()), staffId: o.staffId }, offer: true };
      if (o.first && !st.form.first) st.form.first = o.first;
      goto('info', false);
      show();
    }).catch((e: Error) => { st = fresh(); goto('svc', false); show(); err(e.message); });
  } else if (q.has('reserver')) openBooking();
}

/* ---------------- the frame ---------------- */

function mount() {
  if (root) return;
  root = document.createElement('div');
  root.className = 'lxb';
  root.innerHTML = `
    <div class="lxb-veil" data-a="close"></div>
    <section class="lxb-sheet" role="dialog" aria-modal="true" aria-labelledby="lxb-t" tabindex="-1">
      <div class="lxb-grip" aria-hidden="true"><i></i></div>
      <header class="lxb-head">
        <button type="button" class="lxb-ic lxb-back" data-a="back" aria-label="Étape précédente"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 12H5M11 6l-6 6 6 6"/></svg></button>
        <div class="lxb-tt"><p class="lxb-k"></p><h2 class="lxb-t" id="lxb-t" tabindex="-1"></h2></div>
        <button type="button" class="lxb-ic" data-a="close" aria-label="Fermer la réservation"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button>
      </header>
      <div class="lxb-prog" aria-hidden="true"><i></i><i></i><i></i><i></i></div>
      <div class="lxb-body"></div>
      <p class="lxb-sr" role="status" aria-live="polite"></p>
      <footer class="lxb-foot"><p class="lxb-sum"><b></b><span></span></p><button type="button" class="lxb-cta" data-a="cta"></button></footer>
    </section>`;
  document.body.appendChild(root);
  root.addEventListener('click', onClick);
  root.addEventListener('input', onInput);
  root.addEventListener('keydown', onKey);
  addEventListener('popstate', onPop);
  drag();
}

function show() {
  if (!root) return;
  render();
  if (!isOpen) {
    isOpen = true;
    if (!opener) opener = document.activeElement;
    root.classList.add('open');
    document.documentElement.classList.add('lxb-lock');
    history.pushState({ lxb: st.step }, '');
    depth = 1;
    setTimeout(() => (root!.querySelector('#lxb-t') as HTMLElement)?.focus({ preventScroll: true }), reduced() ? 0 : 320);
    S.getLive();
  }
}
function hide(viaUi: boolean) {
  if (!root || !isOpen) return;
  isOpen = false;
  root.classList.remove('open');
  document.documentElement.classList.remove('lxb-lock');
  clearInterval(timer);
  if (st.step === 'info' && st.hold && !st.offer && !st.busy) { S.release(st.hold.id); st.hold = null; }
  if (st.step === 'done') st = fresh();
  if (viaUi && depth > 0) { closing = true; history.go(-depth); }
  depth = 0;
  (opener as HTMLElement | null)?.focus?.({ preventScroll: true });
  opener = null;
}
function onPop(e: PopStateEvent) {
  if (closing) { closing = false; return; }
  if (!isOpen) return;
  const s = e.state?.lxb as Step | undefined;
  depth = Math.max(0, depth - 1);
  if (s && ORDER.includes(s) && st.step !== 'done' && ORDER.indexOf(s) < ORDER.indexOf(st.step)) { leaveInfo(); st.step = s; st.err = ''; render(); return; }
  hide(false);
}

function goto(step: Step, push = true) {
  if (st.step === 'info' && step !== 'info' && step !== 'done') leaveInfo();
  st.step = step;
  st.err = '';
  if (push && isOpen && step !== 'done') { history.pushState({ lxb: step }, ''); depth++; }
  if (step === 'info') takeHold();
  render();
  const body = root?.querySelector('.lxb-body');
  if (body) body.scrollTop = 0;
}
function leaveInfo() { if (st.hold && !st.offer) S.release(st.hold.id); st.hold = null; st.holdTok++; clearInterval(timer); }

/** The first step that still needs an answer. A preselected slot must still be free. */
function nextStep(): Step {
  if (!st.serviceIds.length) return 'svc';
  if (!st.staffId) return 'who';
  if (!st.day || st.start == null) return 'when';
  const days = S.knownAvailability(st.serviceIds, st.staffId);
  if (days) {
    const slot = days.find((d) => d.day === st.day)?.slots.find((x) => x.m === st.start);
    if (!slot) { st.start = null; return 'when'; }
  }
  return 'info';
}

/* ---------------- drawing ---------------- */

function render() {
  if (!root) return;
  const s = st;
  const sal = S.getSalon();
  const i = ORDER.indexOf(s.step);
  const q = <T extends Element>(sel: string) => root!.querySelector(sel) as T;
  q<HTMLElement>('.lxb-k').textContent = s.step === 'done' ? (s.result?.status === 'pending' ? 'Acompte à régler' : 'Confirmé') : s.offer ? 'Place libérée · gardée pour toi' : 'Étape ' + (i + 1) + ' sur 4 · ' + LABEL[s.step];
  q<HTMLElement>('.lxb-t').textContent = s.step === 'done' && s.result ? (s.result.status === 'pending' ? 'Presque réservé, ' : 'C’est réservé, ') + s.result.first + '.' : TITLE[s.step];
  q<HTMLButtonElement>('.lxb-back').hidden = i <= 0 || s.busy || s.offer;
  q<HTMLElement>('.lxb-prog').classList.toggle('off', i < 0);
  q<HTMLElement>('.lxb-prog').querySelectorAll('i').forEach((el, k) => { el.className = k < i ? 'done' : k === i ? 'on' : ''; });
  root.dataset.step = s.step;
  const body = q<HTMLElement>('.lxb-body');
  if (!sal) { body.innerHTML = skeleton(); foot(); return; }
  body.innerHTML = s.step === 'svc' ? svc() : s.step === 'who' ? who() : s.step === 'when' ? when() : s.step === 'info' ? info() : done();
  if (s.step === 'when') { const on = body.querySelector('.lxb-day[aria-pressed="true"]'); on?.scrollIntoView({ inline: 'center', block: 'nearest' }); }
  foot();
  if (s.step === 'info') tick();
}
function skeleton() { return '<div class="lxb-sk"><i></i><i></i><i></i><i></i></div>'; }
function errBox() { return st.err ? `<p class="lxb-err" role="alert">${esc(st.err)}</p>` : ''; }
function err(msg: string) { st.err = msg; render(); const sr = root?.querySelector('.lxb-sr'); if (sr) sr.textContent = msg; }

function selected() { return st.serviceIds.map(S.serviceById).filter(Boolean) as S.Service[]; }
function total() { const l = selected(); return { price: l.reduce((a, x) => a + x.price, 0), from: l.some((x) => x.from), dur: l.reduce((a, x) => a + x.dur, 0) }; }
function staffName(id: string | null | undefined) { return id === 'any' ? 'Sans préférence' : (id && S.barberById(id)?.name) || ''; }
function avatar(b: { initials: string; color: string; name: string }, big = false) { return `<span class="lxb-av${big ? ' big' : ''}" style="--c:${esc(b.color)}" aria-hidden="true">${esc(b.initials)}</span>`; }

function svc() {
  const sal = S.getSalon()!, m = M.me();
  const cats = [...new Set(sal.services.map((x) => x.category))];
  const back = m.first && m.serviceIds.length && m.serviceIds.every((id) => S.serviceById(id)) ? m : null;
  const rebook = back ? `<button type="button" class="lxb-rebook" data-a="rebook"><span class="k">Bon retour, ${esc(M.firstName())}</span><b>Comme la dernière fois ?</b><span>${esc(back.serviceIds.map((id) => S.serviceById(id)!.name).join(' + '))}${back.staffId && S.barberById(back.staffId) ? ' · avec ' + esc(S.barberById(back.staffId)!.name) : ''}</span><em>Reprendre →</em></button>` : '';
  return errBox() + rebook + cats.map((c) => `
    <div class="lxb-grp"><p class="lxb-gh">${esc(c)}</p>
      ${sal.services.filter((x) => x.category === c).map((x) => {
        const on = st.serviceIds.includes(x.id);
        return `<button type="button" class="lxb-svc${on ? ' on' : ''}" data-a="svc" data-id="${esc(x.id)}" aria-pressed="${on}">
          ${st.multi ? `<span class="lxb-ck" aria-hidden="true"></span>` : ''}
          <span class="l"><b>${esc(x.name)}</b><small>${esc((x.includes || []).slice(0, 3).join(' · ') || x.description)}</small></span>
          <span class="r"><b>${x.from ? '<small>dès</small> ' : ''}${esc(eur(x.price))}</b><small>${esc(dates.fmtDur(x.dur))}</small></span>
        </button>`;
      }).join('')}
    </div>`).join('') + `<button type="button" class="lxb-link" data-a="multi">${st.multi ? 'Une seule prestation' : 'Combiner plusieurs prestations'}</button>`;
}

function who() {
  const sal = S.getSalon()!;
  const card = (id: string, name: string, av: string, line: string) => {
    const on = st.staffId === id;
    const days = S.knownAvailability(st.serviceIds, id);
    const first = days ? days.find((d) => d.slots.length) : null;
    const next = !days ? '<i class="lxb-dots"></i>' : first ? 'Libre ' + esc(dayWord(first.day).toLowerCase().replace(/^(\S+ \d+) \S+$/, '$1')) + ' · ' + esc(t(first.slots[0].m)) + (id === 'any' && S.barberById(first.slots[0].staffId) ? ' avec ' + esc(S.barberById(first.slots[0].staffId)!.name) : '') : 'Complet ces jours-ci';
    if (!days) S.availability(st.serviceIds, id).then(() => { if (st.step === 'who') render(); }, () => {});
    return `<button type="button" class="lxb-who${on ? ' on' : ''}" data-a="who" data-id="${esc(id)}" aria-pressed="${on}">${av}<span class="l"><b>${esc(name)}</b><small>${esc(line)}</small><em><i class="live"></i>${next}</em></span></button>`;
  };
  return errBox() + card('any', 'Sans préférence', '<span class="lxb-av any" aria-hidden="true">✱</span>', 'Le premier barbier libre') +
    sal.barbers.map((b) => card(b.id, b.name, avatar(b), b.bio || '')).join('');
}

function when() {
  const days = S.knownAvailability(st.serviceIds, st.staffId!);
  if (!days) {
    S.availability(st.serviceIds, st.staffId!).then(() => { if (st.step === 'when') render(); }, (e: Error) => err(e.message));
    return errBox() + skeleton();
  }
  const open = days.filter((d) => d.open);
  const first = open.find((d) => d.slots.length);
  const sel = st.day && open.some((d) => d.day === st.day) ? st.day : first?.day || open[0]?.day;
  if (sel && sel !== st.day) { st.day = sel; }
  const cur = open.find((d) => d.day === sel);
  const anyStaff = st.staffId === 'any';
  const strip = open.map((d) => {
    const p = dates.dayParts(d.day), n = d.slots.length, on = d.day === sel;
    const wd = dates.diffDays(S.today(), d.day) === 0 ? 'auj.' : dates.DAYS_SH[p.wd];
    return `<button type="button" class="lxb-day${n ? '' : ' full'}" data-a="day" data-day="${d.day}" aria-pressed="${on}" aria-label="${esc(dayWord(d.day))}, ${n ? n + ' créneaux libres' : 'complet'}"><small>${esc(wd)}</small><b>${p.d}</b><span>${n ? n + ' libre' + (n > 1 ? 's' : '') : 'complet'}</span></button>`;
  }).join('');
  const groups = PERIODS.map((g) => {
    const items = (cur?.slots || []).filter((x) => x.m >= g.a && x.m < g.z);
    if (!items.length) return '';
    return `<div class="lxb-per"><p>${g.t}<span>${items.length}</span></p><div class="lxb-slots">${items.map((x) => {
      const b = anyStaff ? S.barberById(x.staffId) : null;
      const on = st.day === sel && st.start === x.m;
      return `<button type="button" class="lxb-slot${on ? ' on' : ''}" data-a="slot" data-m="${x.m}" aria-pressed="${on}" aria-label="${esc(t(x.m))}${b ? ', avec ' + esc(b.name) : ''}">${esc(t(x.m))}${b ? `<i style="--c:${esc(b.color)}" title="${esc(b.name)}"></i>` : ''}</button>`;
    }).join('')}</div></div>`;
  }).join('');
  const sal = S.getSalon()!;
  const full = cur && !cur.slots.length;
  const fast = first ? `<button type="button" class="lxb-fast" data-a="fast" data-day="${first.day}" data-m="${first.slots[0].m}"><span><small>Le plus tôt</small><b>${esc(dayWord(first.day))} · ${esc(t(first.slots[0].m))}${anyStaff && S.barberById(first.slots[0].staffId) ? ' avec ' + esc(S.barberById(first.slots[0].staffId)!.name) : ''}</b></span><em>Choisir</em></button>` : '';
  const waitBlock = full ? `<div class="lxb-full"><p><b>${esc(dayWord(sel!))}, c’est complet${st.staffId !== 'any' ? ' avec ' + esc(staffName(st.staffId)) : ''}.</b></p>
      ${st.waited === sel ? '<p class="ok">C’est noté. Si une place se libère ce jour-là, elle t’est proposée par SMS : tu auras 30 minutes pour la prendre.</p>'
        : sal.booking.waitlist ? `${st.waitAsk ? `<div class="lxb-row2"><label class="lxb-f"><span>Prénom</span><input data-f="first" value="${esc(st.form.first)}" autocomplete="given-name"></label><label class="lxb-f"><span>Téléphone</span><input data-f="phone" type="tel" inputmode="tel" value="${esc(st.form.phone)}" autocomplete="tel" placeholder="06 12 34 56 78"></label></div>` : ''}<button type="button" class="lxb-ghost" data-a="wait">Me prévenir si une place se libère</button>` : ''}
    </div>` : '';
  return errBox() + fast + `<div class="lxb-days" role="group" aria-label="Choisis un jour">${strip}</div>` + waitBlock + groups +
    (open.length ? '' : '<p class="lxb-muted">Aucun créneau en ligne pour le moment. Appelle le salon, on te trouve une place.</p>');
}

function info() {
  const f = st.form, tot = total();
  const dep = S.depositFor(st.serviceIds);
  const sal = S.getSalon()!;
  const who = st.hold?.staffId || (st.staffId !== 'any' ? st.staffId : null);
  return errBox() + `
    <p class="lxb-hold" data-hold><i></i><span></span><b></b></p>
    <div class="lxb-recap"><p class="w">${esc(dayWord(st.day!))} · ${esc(t(st.start!))}</p><p class="s">${esc(selected().map((x) => x.name).join(' + '))} · ${esc(dates.fmtDur(tot.dur))}${who ? ' · avec ' + esc(staffName(who)) : ''}</p></div>
    <div class="lxb-row2">
      <label class="lxb-f"><span>Prénom</span><input data-f="first" value="${esc(f.first)}" autocomplete="given-name" required></label>
      <label class="lxb-f"><span>Nom <em>facultatif</em></span><input data-f="last" value="${esc(f.last)}" autocomplete="family-name"></label>
    </div>
    <label class="lxb-f"><span>Téléphone</span><input data-f="phone" type="tel" inputmode="tel" value="${esc(f.phone)}" autocomplete="tel" placeholder="06 12 34 56 78" required><small data-hint="phone">Pour la confirmation et le rappel, rien d’autre.</small></label>
    <label class="lxb-f"><span>E-mail <em>facultatif</em></span><input data-f="email" type="email" inputmode="email" value="${esc(f.email)}" autocomplete="email"><small>Pour recevoir le rendez-vous dans ton agenda.</small></label>
    <label class="lxb-f"><span>Un mot pour ton barbier <em>facultatif</em></span><input data-f="note" value="${esc(f.note)}" maxlength="200" placeholder="Ex. : dégradé bas, garder la longueur"></label>
    <button type="button" class="lxb-sw${f.sms ? ' on' : ''}" role="switch" aria-checked="${f.sms}" data-a="sms"><span><b>Rappel par SMS la veille</b><small>Avec un lien pour déplacer ou annuler.</small></span><i aria-hidden="true"></i></button>
    ${dep ? `<p class="lxb-dep">Un acompte de <b>${esc(eur(dep))}</b> est demandé pour cette prestation, déduit au salon. Annulé plus de ${sal.booking.cancelUntilHours} h avant, il est remboursé.</p>` : ''}
    <p class="lxb-priv">Tes coordonnées servent uniquement à ce rendez-vous, et restent au salon.</p>
    ${sal.mode === 'demo' ? '<p class="lxb-demo">Démo : aucun SMS n’est envoyé, aucune carte n’est débitée. La réservation arrive en direct dans le Comptoir.</p>' : ''}`;
}

function done() {
  const r = st.result!;
  const list = r.serviceIds.map(S.serviceById).filter(Boolean) as S.Service[];
  const b = S.barberById(r.staffId);
  const price = list.reduce((a, x) => a + x.price, 0), from = list.some((x) => x.from);
  const sal = S.getSalon()!;
  const pending = r.status === 'pending';
  return `
    <div class="lxb-ok"><svg viewBox="0 0 52 52" aria-hidden="true"><circle cx="26" cy="26" r="24"/><path d="M15 27l7.5 7.5L37 19"/></svg><p>Code <b>${esc(r.code)}</b></p></div>
    <div class="lxb-ticket">
      <p class="k">Ton rendez-vous</p>
      <p class="w">${esc(capFirst(dates.dayLong(r.day)))} · ${esc(t(r.start))}</p>
      <p class="f">${esc(list.map((x) => x.name).join(' + '))} · ${from ? 'dès ' : ''}${esc(eur(price))}</p>
      ${b ? `<p class="b">${avatar(b)}Avec ${esc(b.name)}</p>` : ''}
      <p class="a">${esc(sal.shop.address)} · ${esc(sal.shop.zip)} ${esc(sal.shop.city)}</p>
    </div>
    ${pending && r.payment ? `<div class="lxb-pay"><p>Il reste à régler l’acompte de <b>${esc(eur(r.deposit))}</b> dans les 15 minutes, sinon le créneau est libéré. Il est déduit au salon.</p><a class="lxb-cta inline" href="${esc(r.payment.url)}">Régler l’acompte</a></div>`
      : `<p class="lxb-note">Un SMS de confirmation part sur ton téléphone, avec le lien pour déplacer ou annuler.</p>`}
    <div class="lxb-acts">
      ${pending ? '' : `<a class="lxb-ghost" href="${esc(ics(r, list, b))}" download="rdv-larchitecte-${esc(r.code)}.ics">Ajouter à mon agenda</a>`}
      <a class="lxb-ghost" href="${esc(sal.shop.mapsUrl)}" target="_blank" rel="noopener">Itinéraire</a>
    </div>
    <a class="lxb-manage" href="${esc(r.manage)}">Ton rendez-vous a sa page : déplacer, annuler, itinéraire →</a>
    ${sal.mode === 'demo' ? '<a class="lxb-demo-link" href="/comptoir" target="_blank" rel="noopener"><small>Démo</small>Le voir arriver dans le Comptoir →</a>' : ''}`;
}

function ics(r: Result, list: S.Service[], b: S.Barber | null) {
  try {
    const dur = list.reduce((a, x) => a + x.dur, 0);
    const d = r.day.replace(/-/g, ''), t1 = dates.hhmm(r.start).replace(':', '') + '00', t2 = dates.hhmm(r.start + dur).replace(':', '') + '00';
    const sal = S.getSalon()!;
    const body = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Barber LArchitecte//RDV//FR', 'BEGIN:VEVENT', 'UID:' + r.code + '@larchitecte', 'DTSTAMP:' + new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z'),
      'DTSTART;TZID=Europe/Paris:' + d + 'T' + t1, 'DTEND;TZID=Europe/Paris:' + d + 'T' + t2, 'SUMMARY:' + sal.shop.name + ' · ' + list.map((x) => x.name).join(' + '),
      'LOCATION:' + (sal.shop.address + ', ' + sal.shop.zip + ' ' + sal.shop.city).replace(/,/g, '\\,'), 'DESCRIPTION:' + (b ? 'Avec ' + b.name + '. ' : '') + 'Code ' + r.code + '. ' + r.manage, 'URL:' + r.manage, 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
    return URL.createObjectURL(new Blob([body], { type: 'text/calendar' }));
  } catch { return '#'; }
}

function foot() {
  if (!root) return;
  const s = st, tot = total();
  const sum = root.querySelector('.lxb-sum') as HTMLElement;
  const cta = root.querySelector('.lxb-cta[data-a="cta"]') as HTMLButtonElement;
  const parts: string[] = [];
  const sel = selected();
  if (sel.length) parts.push(sel.map((x) => x.short || x.name).join(' + '));
  const who = s.hold?.staffId || s.staffId;
  if (who) parts.push(staffName(who));
  if (s.day && s.start != null && s.step !== 'svc') parts.push(dates.dayShort(s.day) + ' · ' + t(s.start));
  sum.hidden = s.step === 'done';
  (sum.querySelector('b') as HTMLElement).textContent = sel.length ? (tot.from ? 'dès ' : '') + eur(tot.price) : '—';
  (sum.querySelector('span') as HTMLElement).textContent = parts.join(' · ') || 'Sans compte · moins d’une minute';
  let label = 'Continuer', off = true;
  if (s.step === 'svc') { off = !s.serviceIds.length; }
  else if (s.step === 'who') { off = !s.staffId; }
  else if (s.step === 'when') { off = !(s.day && s.start != null); }
  else if (s.step === 'info') { label = s.busy ? 'Vérification…' : S.depositFor(s.serviceIds) ? 'Réserver et régler l’acompte' : 'Confirmer'; off = s.busy || !formOk(); }
  else if (s.step === 'done') { label = s.result?.status === 'pending' && s.result.payment ? 'Régler l’acompte' : 'Fermer'; off = false; }
  cta.textContent = label;
  cta.disabled = off;
  cta.setAttribute('aria-disabled', String(off));
}
function formOk() { const f = st.form; return f.first.trim().length >= 2 && phoneOk(f.phone) && emailOk(f.email); }

/** The hold's countdown, once a second while the details are being typed. */
function tick() {
  clearInterval(timer);
  const paint = () => {
    const el = root?.querySelector('[data-hold]') as HTMLElement | null;
    if (!el || st.step !== 'info') { clearInterval(timer); return; }
    const left = st.hold ? Math.max(0, Math.round((st.hold.exp - Date.now()) / 1000)) : -1;
    el.classList.toggle('wait', !st.hold);
    el.classList.toggle('gone', left === 0);
    (el.querySelector('span') as HTMLElement).textContent = !st.hold ? 'On réserve le créneau…' : left > 0 ? (st.offer ? 'Place gardée pour toi' : 'Créneau gardé pour toi') : 'On revérifie le créneau à la confirmation';
    (el.querySelector('b') as HTMLElement).textContent = left > 0 ? Math.floor(left / 60) + ':' + String(left % 60).padStart(2, '0') : '';
  };
  paint();
  timer = window.setInterval(paint, 1000);
}

/* ---------------- actions ---------------- */

function takeHold() {
  if (st.offer && st.hold) return;
  const tok = ++st.holdTok;
  st.hold = null;
  S.hold(st.serviceIds, st.staffId === 'any' ? 'any' : st.staffId!, st.day!, st.start!).then((h) => {
    if (tok !== st.holdTok || st.step !== 'info') { S.release(h.id); return; }
    st.hold = h;
    foot(); tick();
    const recap = root?.querySelector('.lxb-recap .s');
    if (recap && st.staffId === 'any') recap.textContent = selected().map((x) => x.name).join(' + ') + ' · ' + dates.fmtDur(total().dur) + ' · avec ' + staffName(h.staffId);
  }).catch((e: S.SalonError) => {
    if (tok !== st.holdTok || st.step !== 'info') return;
    conflict(e.code === 'taken' ? '' : e.message);
  });
}
function conflict(msg?: string) {
  S.invalidate();
  st.start = null; st.hold = null; st.busy = false;
  goto('when', false);
  err(msg || 'Ce créneau vient d’être pris. Choisis-en un autre, tes choix sont gardés.');
}

async function confirm() {
  if (!formOk() || st.busy) return;
  st.busy = true; st.err = ''; foot();
  const f = st.form;
  try {
    const first = capFirst(f.first.split(/\s+/)[0]).slice(0, 40);
    const r = await S.book({ serviceIds: st.serviceIds, staffId: st.staffId === 'any' ? 'any' : st.staffId!, day: st.day!, start: st.start!, holdId: st.hold?.id, first, last: f.last.trim(), phone: f.phone, email: f.email.trim(), note: f.note.trim(), sms: f.sms });
    const tot = total();
    const result: Result = { ...r, day: st.day!, start: st.start!, serviceIds: st.serviceIds.slice(), staffId: r.staffId, first };
    M.save({ first: f.first.trim(), last: f.last.trim(), phone: f.phone, email: f.email.trim(), serviceIds: st.serviceIds.slice(), staffId: st.staffId === 'any' ? null : r.staffId });
    M.keep({ token: r.token, code: r.code, manage: r.manage, day: result.day, start: result.start, dur: tot.dur, serviceIds: result.serviceIds, services: selected().map((x) => x.name).join(' + '), staffId: r.staffId, staff: staffName(r.staffId), status: r.status, payUrl: r.payment?.url || null, at: Date.now() });
    st.busy = false; st.hold = null; st.result = result;
    clearInterval(timer);
    goto('done', false);
    window.dispatchEvent(new CustomEvent('lx:booked', { detail: result }));
    try { navigator.vibrate?.([16, 40, 16]); } catch { /* not supported */ }
  } catch (e) {
    st.busy = false;
    const x = e as S.SalonError;
    if (x.code === 'taken') conflict(); else err(x.message);
  }
}

async function wait() {
  const f = st.form;
  if (f.first.trim().length < 2 || !phoneOk(f.phone)) { if (!st.waitAsk) { st.waitAsk = true; render(); (root?.querySelector('[data-f="first"]') as HTMLElement)?.focus(); } else err('Indique ton prénom et un numéro à 10 chiffres pour être prévenu.'); return; }
  try {
    const sid = st.serviceIds[0];
    await S.joinWaitlist({ day: st.day!, staffId: st.staffId === 'any' ? 'any' : st.staffId!, serviceId: sid, first: capFirst(f.first.split(/\s+/)[0]), phone: f.phone });
    M.save({ first: f.first.trim(), phone: f.phone });
    st.waited = st.day; st.waitAsk = false; st.err = '';
    render();
  } catch (e) { err((e as Error).message); }
}

function onClick(e: Event) {
  const el = (e.target as Element).closest('[data-a]') as HTMLElement | null;
  if (!el) return;
  const a = el.dataset.a;
  if (a === 'close') { hide(true); return; }
  if (a === 'back') {
    // steps taken in the sheet go back through history (the phone's back button does the same);
    // a sheet opened mid-way (a slot picked on the page) steps back without leaving
    if (depth > 1) history.back();
    else { const i = ORDER.indexOf(st.step); if (i > 0) { if (st.step === 'info') leaveInfo(); st.step = ORDER[i - 1]; st.err = ''; render(); } }
    return;
  }
  if (a === 'cta') {
    if (st.step === 'svc' && st.serviceIds.length) goto(nextStep());
    else if (st.step === 'who' && st.staffId) goto(nextStep());
    else if (st.step === 'when' && st.day && st.start != null) goto('info');
    else if (st.step === 'info') confirm();
    else if (st.step === 'done') { if (st.result?.status === 'pending' && st.result.payment) location.href = st.result.payment.url; else hide(true); }
    return;
  }
  if (a === 'svc') {
    const id = el.dataset.id!;
    if (st.multi) {
      st.serviceIds = st.serviceIds.includes(id) ? st.serviceIds.filter((x) => x !== id) : [...st.serviceIds, id].slice(0, 3);
      render();
    } else { st.serviceIds = [id]; st.start = null; goto(nextStep()); }
    return;
  }
  if (a === 'multi') { st.multi = !st.multi; if (!st.multi) st.serviceIds = st.serviceIds.slice(0, 1); render(); return; }
  if (a === 'rebook') { const m = M.me(); st.serviceIds = m.serviceIds.filter((id) => S.serviceById(id)); st.staffId = m.staffId && S.barberById(m.staffId) ? m.staffId : 'any'; st.day = null; st.start = null; goto(nextStep()); return; }
  if (a === 'who') { st.staffId = el.dataset.id!; st.start = null; goto(nextStep()); return; }
  if (a === 'day') { st.day = el.dataset.day!; st.start = null; st.waitAsk = false; st.err = ''; render(); return; }
  if (a === 'slot' || a === 'fast') { if (el.dataset.day) st.day = el.dataset.day; st.start = Number(el.dataset.m); goto('info'); return; }
  if (a === 'sms') { st.form.sms = !st.form.sms; el.classList.toggle('on', st.form.sms); el.setAttribute('aria-checked', String(st.form.sms)); return; }
  if (a === 'wait') { wait(); return; }
}
function onInput(e: Event) {
  const el = e.target as HTMLInputElement;
  const k = el.dataset.f as keyof State['form'] | undefined;
  if (!k || k === 'sms') return;
  if (k === 'phone') {
    const pos = el.value.length - (el.selectionStart ?? el.value.length);
    el.value = fmtPhone(el.value);
    try { el.setSelectionRange(el.value.length - pos, el.value.length - pos); } catch { /* not a text field */ }
    const hint = root?.querySelector('[data-hint="phone"]');
    const d = el.value.replace(/\D/g, '');
    if (hint) { const bad = d.length > 0 && !phoneOk(el.value) && (d.length >= 10 || d[0] !== '0'); hint.classList.toggle('warn', bad); hint.textContent = bad ? 'Un numéro français à 10 chiffres, comme 06 12 34 56 78.' : 'Pour la confirmation et le rappel, rien d’autre.'; }
  }
  (st.form as Record<string, string | boolean>)[k] = el.value;
  foot();
}
function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape') { e.preventDefault(); hide(true); return; }
  if (e.key === 'Enter' && st.step === 'info' && (e.target as HTMLElement).tagName === 'INPUT' && formOk()) { e.preventDefault(); confirm(); return; }
  if (e.key !== 'Tab' || !root) return;
  const f = Array.from(root.querySelectorAll<HTMLElement>('.lxb-sheet button:not([disabled]):not([hidden]), .lxb-sheet a[href], .lxb-sheet input')).filter((x) => x.offsetParent !== null);
  if (!f.length) return;
  const first = f[0], last = f[f.length - 1];
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
}

/** On a phone, the sheet follows the finger down and closes past a threshold. */
function drag() {
  const sheet = root!.querySelector('.lxb-sheet') as HTMLElement;
  const grip = root!.querySelector('.lxb-grip') as HTMLElement;
  const head = root!.querySelector('.lxb-head') as HTMLElement;
  let y0 = 0, dy = 0, on = false;
  const down = (e: PointerEvent) => { if (matchMedia('(min-width: 900px)').matches || (e.target as Element).closest('button')) return; on = true; y0 = e.clientY; dy = 0; sheet.style.transition = 'none'; (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); };
  const move = (e: PointerEvent) => { if (!on) return; dy = Math.max(0, e.clientY - y0); sheet.style.transform = `translateY(${dy}px)`; };
  const up = () => { if (!on) return; on = false; sheet.style.transition = ''; sheet.style.transform = ''; if (dy > 110) hide(true); };
  for (const el of [grip, head]) { el.addEventListener('pointerdown', down); el.addEventListener('pointermove', move); el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up); }
}
