// @ts-check
// The weekly carnet bought with its dates (« 5 coupes sur 5 semaines d'affilée »), read off the state: what the salon
// sells, the dates it proposes after the first one, the weeks of one purchase and what is missing in them, the words
// « coupe 3 sur 5 ». Pure reads: the commands are in commands/formule.js, the rows in projections/formules.js.
import { addDays, diffDays, dayLong } from '../../shared/dates.js';
import { freeSlots, shopIntervals, staffIntervals, eligibleStaff } from './availability.js';
import { rootOf } from './membership.js';

const LIVE = new Set(['pending', 'booked', 'arrived', 'in_chair']);
/**
 * The two texts of a carnet bought with its dates, fixed words (one plain SMS each): the first cut missed with nothing
 * paid, {nombre} other dates freed; the last cut taken, « Reprendre 5 coupes » ({nombre}: the cuts of a new one).
 */
export const FORMULE_TEXT = {
  released: "L'Architecte : {prenom}, 1re coupe manquée et carnet non payé : tes {nombre} autres rendez-vous sont libérés. Reprendre : {lien}",
  renew: "L'Architecte : {prenom}, ton carnet est fini. Reprendre {nombre} coupes : {lien}"
};
/** a missed week is lost, or made up once in one more week */
export const MISSED = /** @type {const} */ (['lost', 'once']);

/** Days a weekly carnet is good for: one week per cut, and one more when a missed week may be made up. */
export const weeklyDays = (credits, missed) => credits * 7 + (missed === 'once' ? 7 : 0);

/**
 * The weekly carnet the salon sells (the first active one in the Catalogue's order), with the cut it pays for; null
 * when there is none or its cut is no longer sold.
 * @param {any} s
 */
export function offerOf(s) {
  const sv = [...s.services.values()].filter((x) => x.active && x.pack && x.pack.weekly && x.pack.credits).sort((a, b) => (a.order ?? 0) - (b.order ?? 0))[0];
  if (!sv) return null;
  const cover = (sv.pack.serviceIds || []).map((id) => s.services.get(id)).find((c) => c && c.active);
  if (!cover) return null;
  const missed = sv.pack.missed === 'once' ? 'once' : 'lost';
  return {
    id: sv.id, slug: sv.slug || null, name: sv.name, price: sv.price, credits: sv.pack.credits, missed, days: weeklyDays(sv.pack.credits, missed),
    coverId: cover.id, coverSlug: cover.slug || null, coverName: cover.name, dur: cover.dur, online: sv.online !== false
  };
}

/**
 * Is this service really offered on the site? Online and active; a carnet only when it can be bought there: the weekly
 * one, with its dates, while the client space is open (it asks for an account) and the cut it pays for is still sold.
 * @param {any} s @param {any} x @param {boolean} spaceOpen settings/accounts.js accountsOn(s)
 */
export function onSite(s, x, spaceOpen) {
  if (!x || !x.active || x.online === false) return false;
  if (!x.pack) return true;
  return !!x.pack.weekly && spaceOpen && (x.pack.serviceIds || []).some((id) => { const c = s.services.get(id); return !!c && c.active; });
}

/** The purchase an appointment belongs to, or null. */
export const formuleOfAppt = (s, apptId) => { const id = s.formuleByAppt ? s.formuleByAppt.get(apptId) : null; return id ? s.formules.get(id) || null : null; };
const apptsOf = (s, f) => f.apptIds.map((id) => s.appts.get(id)).filter(Boolean);
const byTime = (a, b) => a.day.localeCompare(b.day) || a.start - b.start;

/**
 * The day its five weeks start: the day the carnet was paid for (fixed from then on), before that its first date still
 * standing (a first date moved or cancelled in time moves the weeks with it; a missed one keeps them).
 */
export function anchorOf(s, f) {
  if (f.startDay) return f.startDay;
  const days = apptsOf(s, f).filter((a) => a.status !== 'cancelled').map((a) => a.day).sort();
  return days[0] || '';
}
/** The last day a cut of it can be taken. */
export const endOf = (s, f) => f.expires || (anchorOf(s, f) ? addDays(anchorOf(s, f), f.days - 1) : '');

/** The 80 € paid online and on no ticket yet (the first date's deposit, usable on whichever date he first comes to). */
export function paidOnline(s, f) {
  for (const a of apptsOf(s, f)) {
    const py = a.deposit && a.deposit.paymentId ? s.payments.get(a.deposit.paymentId) : null;
    if (py && py.status === 'paid' && !py.usedBy && a.deposit.paid > 0) return { paymentId: py.id, amount: py.amount, apptId: a.id };
  }
  return null;
}
/** 'paid' (the carnet exists), 'online' (paid on the site, the first ticket will use it), 'pending' (its page is open), 'due' (at the salon). */
export function payState(s, f) {
  if (f.packId) return 'paid';
  if (paidOnline(s, f)) return 'online';
  return apptsOf(s, f).some((a) => a.status === 'pending') ? 'pending' : 'due';
}

/**
 * Its weeks, in order: each one done (a cut taken), booked, open (to book) or lost (past without a cut). A carnet whose
 * missed week can be made up shows one more week once a week is lost.
 * @returns {{ k: number, from: string, to: string, state: 'done'|'booked'|'open'|'lost', appt: any }[]}
 */
export function weeksOf(s, f, today) {
  const anchor = anchorOf(s, f);
  if (!anchor) return [];
  const appts = apptsOf(s, f);
  const end = endOf(s, f);
  const out = [];
  const week = (k) => {
    const from = addDays(anchor, 7 * k), to = addDays(from, 6);
    const here = appts.filter((a) => a.day >= from && a.day <= to).sort(byTime);
    const done = here.find((a) => a.status === 'done');
    const live = here.find((a) => LIVE.has(a.status));
    const state = done ? 'done' : live ? 'booked' : to < today || from > end ? 'lost' : 'open';
    return { k, from, to: to > end ? end : to, state: /** @type {any} */ (state), appt: done || live || here.find((a) => a.status === 'no_show') || null };
  };
  for (let k = 0; k < f.credits; k++) out.push(week(k));
  if (f.missed === 'once' && f.days > f.credits * 7 && out.some((w) => w.state === 'lost')) out.push(week(f.credits));
  return out;
}

/** « coupe 3 sur 5 »: where this appointment stands among the cuts of its purchase still standing; null outside one. */
export function rankOf(s, apptId) {
  const f = formuleOfAppt(s, apptId);
  if (!f || f.status === 'released') return null;
  const list = apptsOf(s, f).filter((a) => a.status !== 'cancelled' && a.status !== 'no_show').sort(byTime);
  const i = list.findIndex((a) => a.id === apptId);
  return i < 0 ? null : { n: Math.min(i + 1, f.credits), of: f.credits };
}
export const rankWords = (r) => (r ? 'coupe ' + r.n + ' sur ' + r.of : '');

/**
 * Would these days hold one cut a week at most, inside its validity? `days`: the day of every date still standing after
 * the change. Returns the refusal in the client's words, or ''.
 */
export function weeksRefusal(f, days, fixedAnchor = '') {
  const sorted = [...days].sort();
  if (!sorted.length) return '';
  const anchor = fixedAnchor || sorted[0];
  const weeks = Math.round(f.days / 7);
  const seen = new Set();
  for (const d of sorted) {
    const k = Math.floor(diffDays(anchor, d) / 7);
    if (diffDays(anchor, d) < 0 || k >= weeks) return 'Ta formule tient sur ' + f.credits + ' semaines d’affilée : choisis un jour avant le ' + dayLong(addDays(anchor, f.days)) + '.';
    if (seen.has(k)) return 'Une coupe par semaine : tu as déjà un rendez-vous cette semaine-là.';
    seen.add(k);
  }
  return '';
}

/** Is this purchase still running for its holder: dates to come, or cuts left on a carnet still valid? */
export function running(s, f, today) {
  if (f.status === 'released') return false;
  const pk = f.packId ? s.packs.get(f.packId) : null;
  if (pk) return !pk.voided && pk.used < pk.total && pk.expires >= today;
  return apptsOf(s, f).some((a) => LIVE.has(a.status) && a.day >= today);
}
/** Who it is for: the child's file, or '' for the account's holder. */
export const personOf = (f) => (f.guest && f.guest.cid) || '';
/** The purchases of these files (the holder's and those he holds for a child), newest first. */
export function formulesOfFiles(s, ids) {
  const set = new Set(ids);
  return [...(s.formules ? s.formules.values() : [])].filter((f) => set.has(f.clientId) || set.has(rootOf(s, f.clientId))).sort((a, b) => b.createdAt - a.createdAt);
}

/**
 * « Tes 4 autres rendez-vous »: for each following week the same weekday, hour and barber; when that is not free, the
 * nearest free slot of that week (the same barber first, then anyone) and why; nothing free that week: `none`.
 * @param {any} s
 * @param {{ serviceId: string, staffId: string, day: string, start: number, weeks: number, now: number, local: { day: string, min: number }, online?: boolean, skip?: Set<number> }} q
 * @returns {{ week: number, day: string, start: number, staffId: string, exact: boolean, why: string, none?: boolean }[]}
 */
export function proposeSeries(s, q) {
  const sv = s.services.get(q.serviceId);
  if (!sv) return [];
  const dur = sv.dur + (sv.buffer || 0);
  const online = q.online !== false;
  const st = s.staff.get(q.staffId);
  const name = st ? st.name : 'Ton barbier';
  const slots = (day, staffId) => freeSlots(s, { day, dur, serviceIds: [sv.id], staffId, now: q.now, local: q.local, online, ...(online ? {} : { step: 15 }) });
  const others = eligibleStaff(s, [sv.id], { online }).some((x) => x.id !== q.staffId);
  const out = [];
  for (let k = 1; k < q.weeks; k++) {
    const day = addDays(q.day, 7 * k);
    const exact = slots(day, q.staffId).find((x) => x.m === q.start);
    if (exact) { out.push({ week: k, day, start: q.start, staffId: q.staffId, exact: true, why: '' }); continue; }
    // why the usual one is not there, in the order a client would ask
    const horizon = online && diffDays(q.local.day, day) > s.settings.booking.maxDaysAhead;
    const closed = !shopIntervals(s, day).length;
    const off = !closed && !staffIntervals(s, q.staffId, day).length;
    const why = horizon ? 'Les réservations n’ouvrent pas encore si loin' : closed ? 'Le salon est fermé ' + dayLong(day) : off ? name + ' est absent ' + dayLong(day) : name + ' est déjà pris ' + dayLong(day) + ' à cette heure';
    // the nearest free slot of that week: his own first (the nearest day, then the nearest hour), then anyone's
    let best = null;
    for (const who of others ? [q.staffId, 'any'] : [q.staffId]) {
      for (let i = 0; i < 7 && !best; i++) {
        for (const delta of i === 0 ? [0] : [i, -i]) {
          if (delta < -3 || delta > 3) continue;
          const d = addDays(day, delta);
          const list = slots(d, who);
          if (!list.length) continue;
          const near = list.reduce((a, b) => (Math.abs(b.m - q.start) < Math.abs(a.m - q.start) ? b : a));
          if (!best) best = { day: d, start: near.m, staffId: near.staffId };
        }
      }
      if (best) break;
    }
    out.push(best ? { week: k, ...best, exact: false, why } : { week: k, day, start: q.start, staffId: q.staffId, exact: false, why, none: true });
  }
  return out;
}

/**
 * One purchase as the client's space shows it: its dots, its dates, its end, what is paid.
 * @param {any} s @param {any} f @param {{ today: string, now: number, tokenFor?: (a: any) => string, receiptFor?: (sale: any) => string|null }} ctx
 */
export function formuleView(s, f, ctx) {
  const pk = f.packId ? s.packs.get(f.packId) : null;
  const weeks = weeksOf(s, f, ctx.today);
  const sv = s.services.get(f.serviceId);
  const pay = payState(s, f);
  const child = f.guest && f.guest.cid ? s.clients.get(f.guest.cid) : null;
  const staff = (id) => { const st = s.staff.get(id); return st ? { id: st.id, name: st.name } : null; };
  let n = 0;
  const rows = weeks.map((w) => {
    const a = w.appt;
    if (w.state === 'done' || w.state === 'booked') n++;
    const sale = a && a.saleId ? s.sales.get(a.saleId) : null;
    return {
      k: w.k, from: w.from, to: w.to, state: w.state, n: w.state === 'done' || w.state === 'booked' ? n : 0,
      appt: a && (w.state === 'done' || w.state === 'booked') ? { day: a.day, start: a.start, staff: staff(a.staffId), status: a.status, token: w.state === 'booked' && ctx.tokenFor ? ctx.tokenFor(a) : null, receipt: sale && ctx.receiptFor ? ctx.receiptFor(sale) : null } : null,
      missed: !!a && a.status === 'no_show'
    };
  });
  const done = rows.filter((w) => w.state === 'done').length;
  const used = pk ? Math.max(pk.used, done) : done;
  const left = Math.max(0, f.credits - used);
  const end = endOf(s, f);
  const over = f.status === 'released' || (pk ? pk.voided || used >= f.credits || pk.expires < ctx.today : !rows.some((w) => w.state === 'booked' || w.state === 'open'));
  return {
    id: f.id, name: sv ? sv.name : 'Carnet', price: sv ? sv.price : 0, credits: f.credits, used, left, missed: f.missed,
    forFirst: child && !child.erased ? child.first : '', pay, status: f.status === 'released' ? 'released' : over ? 'ended' : 'open',
    start: anchorOf(s, f), end, weeks: rows,
    // the receipt of the 80 €: the ticket that sold the carnet
    receipt: pk && pk.saleId && s.sales.get(pk.saleId) && ctx.receiptFor ? ctx.receiptFor(s.sales.get(pk.saleId)) : null
  };
}
