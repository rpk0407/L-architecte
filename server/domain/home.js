// @ts-check
// WP3 · the Accueil in one read (GET /api/v1/home), for every member of the team on his phone. It answers three questions
// with facts: what do we have today (`line`, `day.appts`), what is next (`day.next`), can he take someone now
// (`day.chairs`), then the short pile of things to deal with (`cards`), each with one action and the reason it is shown.
//
// Scoped by role and rights, computed here and nowhere else:
// - `day`: the owner, a manager and the front desk read every chair and every appointment; a barber reads his own chair
//   and his own appointments only, never a colleague's client, whatever « voir l'agenda de tous » says. Someone with a
//   chair and the salon's rights chooses with prefs.homeDay ('salon' by default, 'moi').
// - money: an amount (`amount` on a card, a fact in 'eur') exists only with report.shop.
// - cards: a card whose action needs a right the person has not is not computed.
//
// Facts only: every number comes from a read that already exists, so the Accueil never disagrees with another screen.
//   cockpit() (domain/cockpit.js): the sentence, the till's state, the week ahead · toPayAppts (commands/sales.js): « à
//   encaisser », as the Caisse badge · relances() (domain/rebook.js): the pulse's badge · timeoffConflicts
//   (commands/team.js) · inactiveClients (commands/clients.js) · missedZ (domain/cash.js) · availability.js for the
//   chairs: staffIntervals, busyIntervals and isFree, the rules of the agenda and of the site (breaks, time off,
//   closures, holds, blocks, buffers). Nothing is stored: a read of the projection in memory, memoised per (journal
//   version, minute, person). The journal version, not a data version: a hold changes `chairs`, a preference the cards.
import { addDays, dayParts, dayRange, fmtDur, fmtTime, localParts, monthEnd, monthStart, weekStart, DAYS_FR, MONTHS_FR } from '../../shared/dates.js';
import { fmtEur } from '../../shared/money.js';
import { capsOf } from './permissions.js';
import { cockpit } from './cockpit.js';
import { busyIntervals, canDo, isFree, occupies, shopIntervals, staffIntervals, subtract } from './availability.js';
import { dayWords, missedZ } from './cash.js';
import { relances } from './rebook.js';
import { toPayAppts } from '../commands/sales.js';
import { inactiveClients } from '../commands/clients.js';
import { rangeWords, timeoffConflicts } from '../commands/team.js';
import { gone, KIND_FR } from '../projections/inquiries.js';
import { prefsOf } from '../projections/staffprefs.js';
import { apptView } from '../http/views.js';

/** the follow-up card shows from this many regulars past their rhythm */
export const RELANCES_MIN = 5;
/** a failed message is worth a card for this many days */
export const ECHECS_DAYS = 7;
/** the comptable's files and the missing goal are told during the first days of the month */
export const MONTH_START_DAYS = 5;
/** the month's last open days that count as its end */
export const MONTH_END_OPEN_DAYS = 3;
export const MAX_FACTS = 3;
export const MAX_APPTS = 12;
export const MAX_TAKE = 3;
export const MAX_PREVIEW = 3;

/** the groups in the order they are shown: what blocks, what someone waits for, what brings money, upkeep */
export const GROUPS = /** @type {const} */ (['bloque', 'attend', 'rapporte', 'entretien']);
/** every card, in its default order */
export const CARD_IDS = /** @type {const} */ (['z', 'encaisser', 'prochain', 'absence-demande', 'orphelins', 'demandes', 'relances', 'semaine', 'echecs', 'stock', 'purge', 'comptable', 'objectif']);
/** the cards that engage the salon: a person's « masquer » does not remove them */
const NO_HIDE = new Set(['z', 'absence-demande']);

const NB = ' ';
const cap = (t) => (t ? t.charAt(0).toUpperCase() + t.slice(1) : t);
const plural = (n, one, many = one + 's') => n + ' ' + (n > 1 ? many : one);
/** « d’octobre », « de novembre » */
const ofMonth = (m) => (/^[aeiouéèh]/i.test(m) ? 'd’' : 'de ') + m;
const nameOf = (c) => (c.first + ' ' + (c.last ? c.last.charAt(0) + '.' : '')).trim();

const cache = new WeakMap();

/**
 * @param {any} s the state @param {any} me the staff member reading @param {number} now
 */
export function home(s, me, now) {
  let c = cache.get(s);
  if (!c || c.version !== s.version) { c = { version: s.version, m: new Map() }; cache.set(s, c); }
  const minute = Math.floor(now / 60000);
  const hit = c.m.get(me.id);
  if (hit && hit.minute === minute) return hit.value;
  const value = build(s, me, now);
  c.m.set(me.id, { minute, value });
  return value;
}

/* ---------------- the moment ---------------- */

/** The last open days of the month (a closed day between them counts), or the first days of the next. */
function monthEdge(s, today) {
  if (dayParts(today).d <= MONTH_START_DAYS) return true;
  const left = dayRange(today, monthEnd(today)).filter((d) => shopIntervals(s, d).length).length;
  return left <= (shopIntervals(s, today).length ? MONTH_END_OPEN_DAYS : MONTH_END_OPEN_DAYS - 1);
}

/* ---------------- the day ---------------- */

const startAfter = (ivs, min) => { const next = ivs.map((x) => x[0]).filter((a) => a > min); return next.length ? Math.min(...next) : null; };

/**
 * One chair, now. 'libre': he can take someone, for `freeMin` minutes, until `until`. 'occupe': a client, a block or a
 * held slot, until `until` (null while a client is still in the chair past the end of his slot). 'absent': the salon is
 * open and he is not at work (a break or hours off: back at `until`; a day off or an absence: null). 'ferme': the salon
 * is not open now (opens at `until`, null when it does not open again today, or once the day is sealed by its Z).
 * Everything from availability.js: his hours (staffIntervals), what takes his time (busyIntervals), and isFree for each
 * service with its buffer, as GET /api/v1/slots asks it.
 */
function chairOf(s, st, day, nowMin, now, shop, sealed, services) {
  const none = (state, until) => ({ staffId: st.id, name: st.name, state, until, freeMin: 0, canTake: [] });
  const work = staffIntervals(s, st.id, day);
  if (shop.length && !work.length) return none('absent', null);
  if (sealed || !shop.some(([a, b]) => nowMin >= a && nowMin < b)) return none('ferme', sealed ? null : startAfter(shop, nowMin));
  const cur = work.find(([a, b]) => nowMin >= a && nowMin < b);
  if (!cur) return none('absent', startAfter(work, nowMin));
  const free = subtract([[nowMin, cur[1]]], busyIntervals(s, st.id, day, { now }));
  const freeNow = free.length > 0 && free[0][0] === nowMin;
  // a client still in the chair after the end of his slot: the chair is not free, and nobody knows until when
  const late = [...(s.apptsByDay.get(day) || [])].some((id) => { const a = s.appts.get(id); return a && a.staffId === st.id && a.status === 'in_chair' && a.start + a.dur <= nowMin; });
  if (!freeNow || late) return none('occupe', freeNow ? null : free.length ? free[0][0] : cur[1]);
  const canTake = [];
  for (const sv of services) {
    if (canTake.length >= MAX_TAKE) break;
    if (canDo(st, [sv.id]) && isFree(s, st.id, day, nowMin, sv.dur + (sv.buffer || 0), { now })) canTake.push({ serviceId: sv.id, short: sv.short || sv.name });
  }
  return { staffId: st.id, name: st.name, state: 'libre', until: free[0][1], freeMin: free[0][1] - nowMin, canTake };
}

/** Today from now on: in the chair, arrived, or booked and not over (the cockpit's « still to come »), and a deposit still awaited. */
function comingOf(s, day, nowMin, now) {
  return [...(s.apptsByDay.get(day) || [])].map((id) => s.appts.get(id)).filter((a) => a && !a.saleId
    && (a.status === 'in_chair' || a.status === 'arrived' || ((a.status === 'booked' || (a.status === 'pending' && occupies(a, now, s))) && a.start + a.dur > nowMin)));
}

/* ---------------- the read ---------------- */

function build(s, me, now) {
  const caps = capsOf(me, s.settings);
  const can = (c) => caps.has(c);
  const L = localParts(now), today = L.day, nowMin = L.min;
  const prefs = /** @type {any} */ (prefsOf(s, me));
  const money = can('report.shop');
  // the salon's day is the owner's, the managers' and the front desk's; a barber's Accueil is his own
  const wide = me.role !== 'barber' && can('agenda.all');
  const canSwitch = wide && !!me.chair;
  const scope = wide && !(canSwitch && prefs.homeDay === 'moi') ? 'salon' : 'moi';
  const C = cockpit(s, { range: 'day', day: today, today, now });
  const T = C.today;
  const moment = !T.open ? 'ferme' : !T.started ? 'avant' : T.over ? 'apres' : 'pendant';
  const finDeMois = monthEdge(s, today);
  const p = dayParts(today);
  const monthStartNow = p.d <= MONTH_START_DAYS;

  /* the day */
  const shop = shopIntervals(s, today), sealed = s.closures.has(today);
  const staff = [...s.staff.values()].filter((x) => x.active && x.chair).sort((a, b) => (a.order ?? 99) - (b.order ?? 99));
  const rank = new Map(staff.map((x, i) => [x.id, i]));
  const seen = scope === 'salon' ? staff : staff.filter((x) => x.id === me.id);
  const services = [...s.services.values()].filter((x) => x.active && !x.legacy && !x.pack).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const ids = new Set(seen.map((x) => x.id));
  const row = (a) => ({
    id: a.id, start: a.start, dur: a.dur, client: apptView(s, a, caps, null, now).name,
    services: a.services.map((x) => (s.services.get(x.id) || {}).short || x.name).join(' + '), staffId: a.staffId, status: a.status
  });
  const coming = comingOf(s, today, nowMin, now).filter((a) => ids.has(a.staffId)).sort((a, b) => a.start - b.start || (rank.get(a.staffId) ?? 99) - (rank.get(b.staffId) ?? 99));
  const appts = coming.slice(0, MAX_APPTS).map(row);
  const nextA = coming.find((a) => a.status !== 'in_chair');
  const next = nextA ? appts.find((x) => x.id === nextA.id) || row(nextA) : null;
  const day = { scope, canSwitch, appts, more: coming.length - appts.length, next, chairs: seen.map((st) => chairOf(s, st, today, nowMin, now, shop, sealed, services)) };

  /* what waits for a payment: the Caisse badge's list, his own for a barber */
  const toPay = can('sale.create') ? toPayAppts(s, today, nowMin).filter((a) => wide || a.staffId === me.id) : [];

  /* the sentence */
  const fact = (k, label, v, unit) => (unit ? { k, label, v, unit } : { k, label, v });
  /** @type {{ k: string, label: string, v: number, unit?: string }[]} */
  let facts = [];
  let note = '';
  const dayName = cap(DAYS_FR[p.wd] + ' ' + (p.d === 1 ? '1er' : p.d) + ' ' + MONTHS_FR[p.m - 1]);
  const label = dayName + ' · ' + (moment === 'avant' ? 'ouverture à ' + fmtTime(T.opensAt) : moment === 'pendant' ? 'ouvert jusqu’à ' + fmtTime(T.closesAt) : moment === 'apres' ? 'journée finie' : 'salon fermé');
  const away = T.chairs.filter((x) => x.away).map((x) => x.name);
  const awayWords = away.length ? (away.length > 1 ? away.slice(0, -1).join(', ') + ' et ' + away[away.length - 1] + ' absents' : away[0] + ' absent') : '';
  if (wide) {
    if (moment === 'avant') {
      facts = [fact('rdv', 'rendez-vous', T.count), ...(money ? [fact('prevus', 'prévus', T.planned, 'eur')] : []), fact('libres', 'libres', T.freeMin, 'min')];
      note = awayWords;
    } else if (moment === 'pendant') {
      facts = money
        ? [fact('encaisse', 'encaissés', C.kpis.cashed.value, 'eur'), fact('a-venir', 'encore prévus', T.expected, 'eur'), fact('a-encaisser', 'à encaisser', C.cash.unpaid)]
        : [fact('restants', 'rendez-vous à venir', C.cash.remaining), fact('a-encaisser', 'à encaisser', C.cash.unpaid), fact('libres', 'libres', T.freeMin, 'min')];
      // the next long free stretch, as the cockpit finds it (an hour or more)
      const gap = T.chairs.filter((x) => x.gap).sort((a, b) => a.gap[0] - b.gap[0])[0];
      note = gap ? 'Prochain trou : ' + gap.name + ' à ' + fmtTime(gap.gap[0]) + ' (' + fmtDur(gap.gap[1] - gap.gap[0]) + ')' : awayWords;
    } else if (moment === 'apres') {
      const ref = C.kpis.prev;
      facts = money
        ? [fact('encaisse', 'encaissés', C.kpis.cashed.value, 'eur'), ...(ref ? [fact('reference', DAYS_FR[p.wd] + ' dernier', ref.cashed, 'eur')] : []), fact('pourboires', 'de pourboires', C.kpis.tips, 'eur')]
        : [fact('rdv', 'rendez-vous', T.count), fact('a-encaisser', 'à encaisser', C.cash.unpaid)];
      note = can('closure') ? ({ done: 'Z fait', due: 'Z à faire', missed: 'Un Z en retard' })[C.cash.z] || '' : '';
    } else {
      // closed today: the week that just ran (the one of yesterday) in one figure, the days ahead in two
      if (money) {
        const y = addDays(today, -1);
        const W = cockpit(s, { range: 'week', day: y, today, now });
        facts.push(fact('semaine', weekStart(y) === weekStart(today) ? 'cette semaine' : 'la semaine dernière', W.kpis.cashed.value, 'eur'));
      }
      facts.push(fact('rdv-7j', 'rendez-vous sur 7 jours', C.ahead.count), fact('libres-7j', 'libres sur 7 jours', C.ahead.freeMin, 'min'));
    }
    // the month's edge: the goal while the month runs, the month just closed in its first days
    if (money && finDeMois) {
      const g = C.kpis.cashed.goal;
      let extra = '';
      if (monthStartNow) {
        const last = addDays(monthStart(today), -1);
        const M = cockpit(s, { range: 'month', day: last, today, now });
        extra = cap(MONTHS_FR[dayParts(last).m - 1]) + NB + ': ' + fmtEur(M.kpis.cashed.value) + ' encaissés';
      } else if (g) extra = 'Objectif ' + ofMonth(MONTHS_FR[p.m - 1]) + NB + ': ' + Math.round(g.pct * 100) + NB + '%';
      if (extra) note = note ? note + ' · ' + extra : extra;
    }
  } else {
    // his own day, in counts: his row of the cockpit's « today » and « ahead », his own « à encaisser »
    const mine = T.chairs.find((x) => x.id === me.id);
    const ahead = C.ahead.chairs.find((x) => x.id === me.id);
    if (moment === 'ferme') facts = ahead ? [fact('libres-7j', 'libres sur 7 jours', ahead.freeMin, 'min')] : [];
    else if (mine) facts = [fact('rdv', 'rendez-vous', mine.count), fact('libres', 'libres', mine.freeMin, 'min'), ...(can('sale.create') ? [fact('a-encaisser', 'à encaisser', toPay.length)] : [])];
    note = mine && mine.away ? 'Tu es absent aujourd’hui' : mine && mine.off ? 'Tu ne travailles pas aujourd’hui' : '';
  }
  const line = { label, facts: facts.slice(0, MAX_FACTS), ...(note ? { note } : {}) };

  /* the cards */
  /** @type {any[]} */
  const cards = [];
  const who = (id) => (s.staff.get(id) || {}).name || 'Quelqu’un';
  const add = (id, group, count, x) => cards.push({ id, group, count, ...(money && x.amount != null ? { amount: x.amount } : {}), title: x.title, why: x.why, preview: (x.preview || []).slice(0, MAX_PREVIEW), action: x.action, canHide: !NO_HIDE.has(id) });
  const o = { now, local: L };

  if (can('closure')) {
    const missed = C.cash.z === 'missed';
    if (missed || (C.cash.z === 'due' && (T.over || !T.open))) {
      const late = missed ? (({ close, uncounted }) => [...close, ...uncounted].sort())(missedZ(s, today)) : [today];
      add('z', 'bloque', late.length, {
        title: !missed ? 'Z du jour à faire' : late.length > 1 ? late.length + ' journées sans Z' : 'Z de ' + dayWords(late[0], today) + ' manquant',
        why: missed ? 'Une journée avec des tickets n’a pas été clôturée : les suivantes attendent son Z.' : 'La journée est finie et sa caisse n’est pas clôturée.',
        preview: missed ? late.map((d) => ({ id: d, text: cap(dayWords(d, today)) })) : [],
        action: { kind: 'go', label: 'Faire le Z', to: '/caisse/cloture' }
      });
    }
  }
  if (toPay.length) {
    const list = [...toPay].sort((a, b) => a.start - b.start);
    add('encaisser', 'bloque', list.length, {
      amount: list.reduce((t, a) => t + (a.price || 0), 0),
      title: list.length + ' rendez-vous à encaisser',
      why: wide ? 'Des rendez-vous finis ou au fauteuil n’ont pas encore de ticket.' : 'Tes rendez-vous finis ou au fauteuil n’ont pas encore de ticket.',
      preview: list.map((a) => { const r = row(a); return { id: a.id, text: r.client + ' · ' + r.services }; }),
      action: { kind: 'go', label: 'Encaisser', to: '/caisse' }
    });
  }
  if (scope === 'moi' && me.chair && next && next.staffId === me.id) {
    add('prochain', 'attend', 1, {
      title: next.client + ' à ' + fmtTime(next.start),
      why: 'Ton prochain client aujourd’hui.',
      preview: [{ id: next.id, text: next.services + ' · ' + fmtDur(next.dur) }],
      action: { kind: 'go', label: 'Ma journée', to: '/espace' }
    });
  }
  if (can('team')) {
    const reqs = [...s.timeoffRequests.values()].filter((q) => q.status === 'pending' && q.to >= today).sort((a, b) => a.from.localeCompare(b.from));
    if (reqs.length) {
      const text = (q) => { const n = timeoffConflicts(s, q, o).length; return who(q.staffId) + ' · ' + rangeWords(q) + (n ? ' · ' + plural(n, 'client') + ' à replacer' : ''); };
      add('absence-demande', 'attend', reqs.length, {
        title: reqs.length > 1 ? reqs.length + ' demandes d’absence' : who(reqs[0].staffId) + ' demande ' + rangeWords(reqs[0]),
        why: 'Une demande d’absence attend ta réponse : ses créneaux restent ouverts d’ici là.',
        preview: reqs.map((q) => ({ id: q.id, text: text(q) })),
        action: { kind: 'sheet', label: 'Voir et valider', ref: reqs[0].id }
      });
    }
    if (can('agenda.edit')) {
      const rows = [];
      for (const t of s.timeoff.values()) {
        if (t.to < today) continue;
        const c = timeoffConflicts(s, t, o);
        if (c.length) rows.push({ t, n: c.length, day: c[0].day });
      }
      rows.sort((a, b) => a.day.localeCompare(b.day));
      const n = rows.reduce((t, x) => t + x.n, 0);
      if (n) add('orphelins', 'attend', n, {
        title: plural(n, 'client') + ' à replacer',
        why: 'Des clients sont réservés chez un barbier qui sera absent.',
        preview: rows.map((x) => ({ id: x.t.id, text: who(x.t.staffId) + ' absent ' + rangeWords(x.t) + ' · ' + x.n })),
        action: { kind: 'sheet', label: 'Replacer', ref: rows[0].t.id }
      });
    }
  }
  if (can('marketing')) {
    const unread = s.inquiries ? [...s.inquiries.values()].filter((q) => q.status === 'new' && !gone(s, q)).sort((a, b) => b.at - a.at) : [];
    if (unread.length) add('demandes', 'attend', unread.length, {
      title: plural(unread.length, 'demande') + ' à lire',
      why: 'Des messages du site ou des réponses par SMS n’ont pas encore été traités.',
      preview: unread.map((q) => ({ id: q.id, text: (q.first || 'Quelqu’un') + ' · ' + (KIND_FR[q.kind] || q.kind) })),
      action: { kind: 'go', label: 'Répondre', to: '/relances/demandes' }
    });
    const due = relances(s, today, now);
    if (due.length >= RELANCES_MIN) {
      due.sort((a, b) => (a.st.dueIn ?? 0) - (b.st.dueIn ?? 0));
      add('relances', 'rapporte', due.length, {
        // an estimate: what each of them spends per visit (spend ÷ visits, clientStats)
        amount: due.reduce((t, x) => t + (x.st.avgTicket || 0), 0),
        title: due.length + ' habitués en retard',
        why: due.length + ' habitués ont dépassé leur rythme et acceptent les SMS (seuil' + NB + ': ' + RELANCES_MIN + ').',
        preview: due.map((x) => ({ id: x.c.id, text: nameOf(x.c) })),
        action: { kind: 'bulk', label: 'Aperçu et envoi', to: '/relances' }
      });
    }
    const since = now - ECHECS_DAYS * 86400000;
    const failed = [...s.messages.values()].filter((m) => m.status === 'failed' && (m.sentAt || m.at) >= since);
    if (failed.length) add('echecs', 'entretien', failed.length, {
      title: plural(failed.length, 'message') + ' en échec',
      why: 'Des messages ne sont pas partis depuis ' + ECHECS_DAYS + ' jours.',
      action: { kind: 'go', label: 'Voir', to: '/relances/envoyes' }
    });
  }
  if (money && can('agenda.all')) {
    const lastOpen = T.open && !dayRange(addDays(today, 1), addDays(weekStart(today), 6)).some((d) => shopIntervals(s, d).length);
    if (moment === 'ferme' || (lastOpen && T.over)) {
      const A = C.ahead;
      add('semaine', 'rapporte', A.count, {
        amount: A.planned,
        title: 'Les 7 jours à venir : ' + A.count + ' rendez-vous',
        why: moment === 'ferme' ? 'Le salon est fermé aujourd’hui : un regard sur la suite.' : 'La semaine est finie : un regard sur la suivante.',
        preview: [{ id: 'fill', text: 'Rempli à ' + Math.round(A.fill * 100) + NB + '%' }, { id: 'free', text: fmtDur(Math.round(A.freeMin / 15) * 15) + ' libres' }],
        action: { kind: 'go', label: 'Voir la semaine', to: '/agenda?vue=semaine' }
      });
    }
  }
  if (can('catalog')) {
    const low = [...s.products.values()].filter((x) => x.active && (x.stock || 0) <= (x.low || 0)).sort((a, b) => (a.stock || 0) - (b.stock || 0) || a.name.localeCompare(b.name, 'fr'));
    if (low.length) add('stock', 'entretien', low.length, {
      title: plural(low.length, 'produit') + ' sous ' + (low.length > 1 ? 'leur' : 'son') + ' seuil',
      why: 'Le stock est au seuil d’alerte fixé sur la fiche du produit, ou dessous.',
      preview: low.map((x) => ({ id: x.id, text: x.name + ' · ' + ((x.stock || 0) <= 0 ? 'rupture' : 'plus que ' + x.stock) })),
      action: { kind: 'go', label: 'Voir', to: '/catalogue' }
    });
  }
  if (can('client.erase')) {
    const n = inactiveClients(s, today).length;
    if (n) add('purge', 'entretien', n, {
      title: plural(n, 'fiche') + ' à purger',
      why: 'Plus rien depuis 3 ans : la page Confidentialité promet de les anonymiser.',
      action: { kind: 'go', label: 'Purger', to: '/clients?segment=inactifs' }
    });
  }
  if (monthStartNow && can('compta')) {
    const last = addDays(monthStart(today), -1);
    if (s.periodByKey && s.periodByKey.has('M:' + last.slice(0, 7))) add('comptable', 'entretien', 1, {
      title: 'Fichiers ' + ofMonth(MONTHS_FR[dayParts(last).m - 1]) + ' prêts',
      why: 'Le mois est clôturé : ses fichiers sont définitifs pour le comptable.',
      action: { kind: 'go', label: 'Fichiers du mois', to: '/reglages/compta' }
    });
  }
  if (monthStartNow && can('settings') && !((s.settings.goals || {}).monthCents > 0)) {
    add('objectif', 'entretien', 1, {
      title: 'Pas d’objectif pour ' + MONTHS_FR[p.m - 1],
      why: 'Le mois commence sans objectif de chiffre.',
      action: { kind: 'sheet', label: 'Fixer l’objectif', ref: 'objectif' }
    });
  }

  /* what is fine, in words, for what he may act on (read before his own « masquer ») */
  const has = (...xs) => cards.some((c) => xs.includes(c.id));
  const quiet = [];
  if ((can('closure') || can('sale.create')) && !has('z', 'encaisser')) quiet.push('caisse');
  if (can('team') && !has('absence-demande', 'orphelins')) quiet.push('équipe');
  if (can('marketing') && !has('demandes', 'echecs')) quiet.push('messages');
  if (can('catalog') && !has('stock')) quiet.push('stock');

  /* his choices: what he masked, the order he pinned inside a group; else the bigger count first */
  const hidden = new Set(prefs.homeHidden || []), pinned = prefs.homeCards || [];
  const pin = (c) => { const i = pinned.indexOf(c.id); return i < 0 ? pinned.length : i; };
  const base = (c) => CARD_IDS.indexOf(c.id);
  const shown = cards.filter((c) => !c.canHide || !hidden.has(c.id))
    .sort((a, b) => GROUPS.indexOf(a.group) - GROUPS.indexOf(b.group) || pin(a) - pin(b) || b.count - a.count || base(a) - base(b));

  return { asOf: now, moment, finDeMois, line, day, cards: shown, quiet };
}
