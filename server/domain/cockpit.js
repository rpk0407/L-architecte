// @ts-check
// TEAM-05a · Pilotage: the owner's whole salon in one read. A period (day, week or month) in figures against the one before,
// each barber in chair order, the till's state, and the fairness hints. Every number comes from report() and goalOf(), the
// reads Rapports, the agenda and the statement already use, so the three screens always say the same thing. Owner and
// managers only (report.shop). Memoised by (journal version, range, day), for the current minute.
import { addDays, dayParts, dayRange, diffDays, fmtDur, localParts, monthEnd, monthStart, weekStart, MONTHS_FR, MONTHS_SH, DAYS_FR, DAYS_SH } from '../../shared/dates.js';
import { carnetCutValue, goalOf, openDays, report } from './insights.js';
import { busyIntervals, occupies, shopIntervals, staffIntervals, subtract, UNDECIDED } from './availability.js';
import { dayTotals, hadTill, missedZ } from './cash.js';
import { closingWarnings } from '../commands/tick-steps.js';
import { closingMin, remainingAppts, toPayAppts } from '../commands/sales.js';

export const RANGES = /** @type {const} */ (['day', 'week', 'month']);
/** an equity hint needs this many events in the last 30 days, or it says nothing (a quiet month proves nothing) */
export const EQUITY_MIN = 10;
/** a share this far from the barber's share of the open chair hours is worth saying */
const LOW = 0.6, HIGH = 1.6;
const EQUITY_DAYS = 30;
const MAX_HINTS = 3;
/** idle chair time this week that is worth a line, and how much more than the others' average */
const IDLE_MIN = 180;

const cache = new WeakMap();
/** @template T @param {any} s @param {string} key @param {number} minute @param {() => T} fn @returns {T} */
function memo(s, key, minute, fn) {
  let c = cache.get(s);
  if (!c || c.version !== s.version) { c = { version: s.version, m: new Map() }; cache.set(s, c); }
  const hit = c.m.get(key);
  if (hit && hit.minute === minute) return hit.value;
  const value = fn();
  if (c.m.size >= 200) c.m.clear();
  c.m.set(key, { minute, value });
  return value;
}

const cap = (t) => (t ? t.charAt(0).toUpperCase() + t.slice(1) : t);
const nth = (d) => (d === 1 ? '1er' : String(d));
const NB = ' ';

/**
 * The period a range names and the one it is compared with. A period still running is read up to today (`upTo`) and
 * compared with the same number of days at the start of the one before (Monday to Wednesday against last Monday to
 * Wednesday), so a delta never sets a part of a week against a whole one. A day is compared with the same weekday a
 * week earlier (Monday against Sunday would say nothing), not « the same length before » as the plan words it. While
 * only today is read (`partial`), the comparison is with a whole day: the screen shows it without alarm colours.
 * prevLabel carries its own preposition (« à la semaine dernière »).
 * @param {'day'|'week'|'month'} range @param {string} day any day of the period @param {string} today
 */
export function periodOf(range, day, today) {
  const d = day > today ? today : day;
  let from, to, prevFrom, prevEnd, label, prevLabel;
  const p = dayParts(d);
  if (range === 'week') {
    from = weekStart(d); to = addDays(from, 6); prevFrom = addDays(from, -7); prevEnd = addDays(prevFrom, 6);
    const a = dayParts(from), b = dayParts(to);
    label = 'Semaine du ' + nth(a.d) + (a.m !== b.m ? ' ' + MONTHS_SH[a.m - 1] : '') + ' au ' + nth(b.d) + ' ' + MONTHS_SH[b.m - 1];
    prevLabel = 'à la semaine dernière';
  } else if (range === 'month') {
    from = monthStart(d); to = monthEnd(d); prevFrom = monthStart(addDays(from, -1)); prevEnd = monthEnd(prevFrom);
    label = cap(MONTHS_FR[p.m - 1]) + ' ' + p.y;
    prevLabel = 'au mois dernier';
  } else {
    from = to = d; prevFrom = prevEnd = addDays(d, -7);
    label = cap(DAYS_FR[p.wd] + ' ' + nth(p.d) + ' ' + MONTHS_FR[p.m - 1]);
    // a day still running is set against a whole one: it says so
    prevLabel = 'à ' + DAYS_FR[p.wd] + ' dernier' + (d === today ? ' en entier' : '');
  }
  const upTo = to < today ? to : today;
  const n = diffDays(from, upTo) + 1;
  const pt = addDays(prevFrom, n - 1);
  const live = upTo >= today && to >= today;
  // partial: only today's unfinished hours are read, against a whole day: the delta says nothing yet (shown without alarm colours)
  return { range, day: d, from, to, upTo, prev: { from: prevFrom, to: pt < prevEnd ? pt : prevEnd }, label, prevLabel, live, partial: live && n === 1 };
}

/** « d’octobre », « de novembre » */
const ofMonth = (m) => (/^[aeiouéèh]/i.test(m) ? 'd’' : 'de ') + m;
const days_ = (n, what) => n + ' ' + what.split(' ').map((w) => (n > 1 ? w + 's' : w)).join(' ');

/**
 * What the deltas of a period really compare, like for like (the audit's P0-1). One definition for every tile:
 * - a day: the same weekday a week earlier, whole. Before the doors open there is nothing to compare (`prev` null: no
 *   arrow); while the day runs it is a part against a whole (`soft`: no alarm colour).
 * - a week or a month over: the whole period against the whole one before; the words give the open days of each.
 * - a week or a month still running: only its open days already finished (today counts once the salon has closed),
 *   against the same number of open days from the start of the period before. Tuesday 10 November at 7:30 reads
 *   « 5 jours ouverts terminés contre les 5 premiers jours ouverts d’octobre », not ten calendar days against ten.
 *   No finished open day yet (Tuesday morning after a closed Monday): nothing to compare, no arrow.
 * `cur` is the side of the current period the deltas read (it can stop yesterday while the tiles show today too).
 * @param {any} s @param {ReturnType<typeof periodOf>} p @param {string} today @param {number} nowMin minutes of today
 */
export function compareOf(s, p, today, nowMin) {
  const hours = (d) => shopIntervals(s, d);
  const none = (words) => ({ cur: null, prev: null, curDays: 0, prevDays: 0, soft: false, words });
  if (p.range === 'day') {
    const iv = hours(p.day), last = DAYS_FR[dayParts(p.day).wd] + ' dernier';
    if (!p.live) return { cur: { from: p.from, to: p.to }, prev: p.prev, curDays: iv.length ? 1 : 0, prevDays: openDays(s, p.prev.from, p.prev.to), soft: false, words: 'comparé à ' + last };
    if (!iv.length) return none('salon fermé aujourd’hui : rien à comparer');
    if (nowMin < Math.min(...iv.map((x) => x[0]))) return none('le salon n’a pas encore ouvert : la comparaison avec ' + last + ' viendra dans la journée');
    return { cur: { from: p.from, to: p.to }, prev: p.prev, curDays: 1, prevDays: 1, soft: true, words: 'journée en cours, comparée à ' + last + ' en entier' };
  }
  const month = p.range === 'month';
  const prevEnd = month ? monthEnd(p.prev.from) : addDays(p.prev.from, 6);
  const before = month ? ofMonth(MONTHS_FR[dayParts(p.prev.from).m - 1]) : 'de la semaine dernière';
  if (!p.live) {
    const a = openDays(s, p.from, p.to), b = openDays(s, p.prev.from, prevEnd);
    const whole = month ? 'mois entier comparé au mois ' + before + ' entier' : 'semaine entière comparée à la semaine d’avant';
    return { cur: { from: p.from, to: p.to }, prev: { from: p.prev.from, to: prevEnd }, curDays: a, prevDays: b, soft: false, words: whole + (a !== b ? ' (' + days_(a, 'jour ouvert') + ' contre ' + b + ')' : ' (' + days_(a, 'jour ouvert') + ' chacun)') };
  }
  // today is finished once the salon has closed (or is closed all day): until then it stays out of both sides
  const iv = hours(today);
  const over = !iv.length || nowMin >= Math.max(...iv.map((x) => x[1]));
  const to = over ? today : addDays(today, -1);
  const n = to >= p.from ? openDays(s, p.from, to) : 0;
  const here = month ? 'ce mois-ci' : 'cette semaine';
  if (!n) return none('pas encore de jour ouvert terminé ' + here + ' : rien à comparer pour l’instant');
  // the same number of open days from the start of the period before
  let k = 0, prevTo = p.prev.from;
  for (const d of dayRange(p.prev.from, prevEnd)) { if (hours(d).length) { k++; prevTo = d; if (k === n) break; } }
  if (!k) return none('le salon était fermé sur la période d’avant : rien à comparer');
  const first = k === 1 ? 'au premier jour ouvert ' : 'aux ' + k + ' premiers jours ouverts ';
  return { cur: { from: p.from, to }, prev: { from: p.prev.from, to: prevTo }, curDays: n, prevDays: k, soft: false, words: days_(n, 'jour ouvert terminé') + ' ' + here + ', ' + (n > 1 ? 'comparés ' : 'comparé ') + first + before };
}

/** Money actually received over the days (card, cash, online), as each day's Z counts it (`takings`): the one « Encaissé ». */
function takingsOf(s, days) { return days.reduce((t, d) => t + (hadTill(s, d) ? dayTotals(s, d).takings : 0), 0); }

/* ---------------- what is coming: today and the next days (the audit's C1 and C2) ----------------
 * One definition of a day's load for both: per chair, the minutes he works (staffIntervals), the minutes booked (every
 * appointment that still holds its time: occupies()), and the minutes still free to sell: his hours from now on, less the
 * appointments, the blocks posed in the agenda (pause, training) and the baskets being paid. Fill = booked ÷ worked. */

/** @param {any} s @param {{ id: string }} c @param {string} day @param {number} now @param {number} fromMin only the free time after this minute */
function chairLoad(s, c, day, now, fromMin) {
  const work = staffIntervals(s, c.id, day);
  const capMin = work.reduce((t, [a, b]) => t + b - a, 0);
  let bookedMin = 0, count = 0, left = 0, planned = 0, expected = 0, first = null;
  for (const id of s.apptsByDay.get(day) || []) {
    const a = s.appts.get(id);
    if (!a || a.legacy || a.staffId !== c.id || !occupies(a, now, s)) continue;
    bookedMin += a.dur; count++; planned += a.price || 0;
    if (first == null || a.start < first) first = a.start;
    // still to come: not started, not paid
    if (!a.saleId && (a.status === 'booked' || a.status === 'pending' || a.status === 'arrived') && a.start >= fromMin) { left++; expected += a.price || 0; }
  }
  const ahead = work.map(([a, b]) => /** @type {[number, number]} */ ([Math.max(a, fromMin), b])).filter(([a, b]) => b > a);
  const free = subtract(ahead, busyIntervals(s, c.id, day, { now }));
  const freeMin = free.reduce((t, [a, b]) => t + b - a, 0);
  // the longest free stretch, worth a line when it is an hour or more
  const gap = free.reduce((best, x) => (!best || x[1] - x[0] > best[1] - best[0] ? x : best), /** @type {[number, number]|null} */ (null));
  return { capMin, bookedMin, count, left, planned, expected, first, freeMin, gap: gap && gap[1] - gap[0] >= 60 ? gap : null };
}

/**
 * Today before it happens: the appointments booked and what they are worth, what is still to come, each chair's fill
 * and free time left to sell, who is off. Always today, whatever the period shown.
 */
function todayOf(s, today, now, nowMin, chairs) {
  const shop = shopIntervals(s, today);
  const opensAt = shop.length ? Math.min(...shop.map((x) => x[0])) : null, closesAt = shop.length ? Math.max(...shop.map((x) => x[1])) : null;
  const rows = chairs.map((c) => {
    const x = chairLoad(s, c, today, now, nowMin);
    const off = !x.capMin && shop.length > 0;
    // off because of an absence (decided), or simply not his day
    const away = off && [...s.timeoff.values()].some((t) => t.staffId === c.id && today >= t.from && today <= t.to && !UNDECIDED.has(t.status));
    return { id: c.id, name: c.name, color: c.color, capMin: x.capMin, bookedMin: x.bookedMin, fill: x.capMin ? Math.min(1, x.bookedMin / x.capMin) : 0, count: x.count, freeMin: x.freeMin, gap: x.gap, off, away, planned: x.planned, expected: x.expected, left: x.left, first: x.first };
  });
  const sum = (f) => rows.reduce((t, x) => t + f(x), 0);
  const capMin = sum((x) => x.capMin), bookedMin = sum((x) => x.bookedMin);
  const firsts = rows.map((x) => x.first).filter((x) => x != null);
  return {
    day: today, open: shop.length > 0, opensAt, closesAt, started: opensAt != null && nowMin >= opensAt, over: closesAt != null && nowMin >= closesAt,
    count: sum((x) => x.count), planned: sum((x) => x.planned), left: sum((x) => x.left), expected: sum((x) => x.expected),
    firstAt: firsts.length ? Math.min(...firsts) : null, capMin, bookedMin, fill: capMin ? Math.min(1, bookedMin / capMin) : 0, freeMin: sum((x) => x.freeMin),
    chairs: rows.map(({ planned: _p, expected: _e, left: _l, first: _f, ...x }) => x)
  };
}

/** The next AHEAD_DAYS days after today: the salon's fill and free time day by day, and each chair's. */
export const AHEAD_DAYS = 7;
function aheadOf(s, today, now, chairs) {
  const days = dayRange(addDays(today, 1), addDays(today, AHEAD_DAYS));
  const grid = chairs.map((c) => days.map((d) => chairLoad(s, c, d, now, 0)));
  const col = (i) => grid.map((row) => row[i]);
  const tot = (xs, f) => xs.reduce((t, x) => t + f(x), 0);
  const dayRows = days.map((d, i) => {
    const xs = col(i), capMin = tot(xs, (x) => x.capMin), bookedMin = tot(xs, (x) => x.bookedMin);
    const p = dayParts(d);
    return { day: d, label: DAYS_SH[p.wd] + ' ' + p.d, open: shopIntervals(s, d).length > 0, capMin, bookedMin, fill: capMin ? Math.min(1, bookedMin / capMin) : 0, freeMin: tot(xs, (x) => x.freeMin), count: tot(xs, (x) => x.count), planned: tot(xs, (x) => x.planned) };
  });
  const capMin = tot(dayRows, (x) => x.capMin), bookedMin = tot(dayRows, (x) => x.bookedMin);
  return {
    from: days[0], to: days[days.length - 1], days: dayRows,
    capMin, bookedMin, fill: capMin ? Math.min(1, bookedMin / capMin) : 0, freeMin: tot(dayRows, (x) => x.freeMin), count: tot(dayRows, (x) => x.count), planned: tot(dayRows, (x) => x.planned),
    chairs: chairs.map((c, j) => {
      const cm = tot(grid[j], (x) => x.capMin), bm = tot(grid[j], (x) => x.bookedMin);
      // one cell per day: his fill, null on a day he does not work
      return { id: c.id, name: c.name, color: c.color, fill: cm ? Math.min(1, bm / cm) : 0, freeMin: tot(grid[j], (x) => x.freeMin), days: grid[j].map((x) => (x.capMin ? Math.min(1, x.bookedMin / x.capMin) : null)) };
    })
  };
}

/** « 6 h », « 6 h 30 » */
const hours = (min) => fmtDur(Math.round(min / 15) * 15).replace(/ /g, ' ');

/** What the cashiers gave away over the days (a loyalty reward, validated by the system, is not a discount). */
function discountsOf(s, days) {
  let given = 0;
  for (const d of days) for (const id of s.salesByDay.get(d) || []) {
    const x = s.sales.get(id);
    if (!x) continue;
    given += Math.max(0, (x.totals.discount || 0) - x.lines.reduce((t, l) => t + (l.reward ? l.reward.amount || 0 : 0), 0));
  }
  return given;
}

/** What is owed to clients: live gift card balances, and the cuts left on carnets at their value. */
function outstandingOf(s, today) {
  let giftcards = 0, giftcardCount = 0, carnets = 0, carnetCount = 0, cuts = 0;
  for (const g of s.giftcards.values()) if (g.status === 'active' && g.expires >= today && g.balance > 0) { giftcards += g.balance; giftcardCount++; }
  for (const pk of s.packs.values()) {
    if (pk.voided || pk.used >= pk.total || (pk.expires && pk.expires < today)) continue;
    const left = pk.total - pk.used;
    carnets += left * carnetCutValue(s, pk).value; carnetCount++; cuts += left;
  }
  return { giftcards, giftcardCount, carnets, carnetCount, cuts };
}

/** Sum of a rate weighted by its base over the people's rows (the shop's rebooking rate from each barber's). */
const weighted = (rows, rate, base) => {
  const n = rows.reduce((t, x) => t + base(x), 0);
  return n ? rows.reduce((t, x) => t + rate(x) * base(x), 0) / n : 0;
};
const rebookOf = (rep) => weighted(rep.staff, (x) => x.rebookRate, (x) => x.done);
const returnedOf = (rep) => weighted(rep.staff, (x) => x.returned60, (x) => x.returned60Base);

/**
 * The till, as the owner reads it at a glance. Always now, whatever the period shown.
 * z: 'done' | 'due' (today's takings wait for it, after `closesAt`) | 'missed' (a past day was never closed) | 'none'
 * (nothing at the till today and no drawer open).
 */
function cashOf(s, today, min) {
  const missed = missedZ(s, today);
  const late = [...missed.close, ...missed.uncounted].sort()[0] || null;
  const last = [...s.drawers.values()].filter((x) => x.closedAt).sort((a, b) => b.closedAt - a.closedAt)[0] || null;
  const open = !!s.drawer;
  const unpaid = toPayAppts(s, today, min).length;
  const z = late ? 'missed' : s.closures.has(today) ? 'done' : open || hadTill(s, today) ? 'due' : 'none';
  return {
    drawer: open ? 'open' : last && last.day === today ? 'counted' : 'none',
    // the difference of a drawer counted today only: an earlier day's is not today's Z
    lastDiff: last && last.day === today ? last.diff : null,
    unpaid, z, missedDay: late, closesAt: closingMin(s, today) || null, remaining: remainingAppts(s, today, min).length,
    warnings: closingWarnings(s, today)
  };
}

/** The hours a barber is due this week, and his absences that touch it (decided or still asked). */
function weekOf(s, id, from) {
  const days = dayRange(from, addDays(from, 6));
  let minutes = 0;
  for (const d of days) for (const [a, b] of staffIntervals(s, id, d)) minutes += b - a;
  const to = days[6];
  const row = (t, status) => ({ id: t.id, from: t.from, to: t.to, status });
  const off = [
    ...[...s.timeoff.values()].filter((t) => t.staffId === id && t.to >= from && t.from <= to).map((t) => row(t, 'approved')),
    ...[...s.timeoffRequests.values()].filter((t) => t.staffId === id && t.status === 'pending' && t.to >= from && t.from <= to).map((t) => row(t, 'pending'))
  ].sort((a, b) => a.from.localeCompare(b.from));
  return { from, to, minutes, off };
}

/**
 * Fairness hints over the last 30 days, whatever the period shown: a barber whose share of new clients, walk-ins or
 * « sans préférence » bookings is far from his share of the open chair hours, and the chair that has stood idle this
 * week. Built last and only above EQUITY_MIN events: a few weeks of four people's luck is not unfairness. Never a ranking.
 */
function equityOf(s, today, now, chairs) {
  const from = addDays(today, -(EQUITY_DAYS - 1));
  const rep = report(s, { from, to: today, staffId: null, today, now });
  const rows = new Map(rep.staff.map((x) => [x.id, x]));
  const open = chairs.map((c) => ({ id: c.id, name: c.name, min: (rows.get(c.id) || { capMin: 0 }).capMin }));
  const allHours = open.reduce((t, x) => t + x.min, 0);
  if (!allHours) return [];
  /** @type {{ staffId: string, kind: string, text: string, gap: number }[]} */
  const out = [];
  // one source of events: how many each chair got, its sentence. One hint per source: the chair taking the most beyond his
  // hours, else the one left furthest behind (one fact is not told three times from the other chairs' side)
  const skew = (kind, counts, say) => {
    const total = [...counts.values()].reduce((t, v) => t + v, 0);
    if (total < EQUITY_MIN) return;
    const rows = open.filter((c) => c.min).map((c) => {
      const share = (counts.get(c.id) || 0) / total, hoursShare = c.min / allHours;
      return { c, share, hoursShare, ratio: share / hoursShare };
    });
    const over = rows.filter((x) => x.ratio >= HIGH).sort((a, b) => b.ratio - a.ratio)[0];
    const under = rows.filter((x) => x.ratio <= LOW).sort((a, b) => a.ratio - b.ratio)[0];
    const x = over || under;
    if (x) out.push({ staffId: x.c.id, kind, text: say(x.c.name, Math.round(x.share * 100), Math.round(x.hoursShare * 100)), gap: Math.abs(Math.log(x.ratio || 0.01)) });
  };
  skew('new', new Map(open.map((c) => [c.id, (rows.get(c.id) || { newClients: 0 }).newClients])),
    (n, a, b) => n + ' reçoit ' + a + NB + '% des nouveaux clients pour ' + b + NB + '% des heures ouvertes.');
  // walk-ins: DO-06's rotation is read when it is there; its numbers are the same rows (done visits that were walk-ins)
  skew('walkin', new Map(open.map((c) => [c.id, (rows.get(c.id) || { walkins: 0 }).walkins])),
    (n, a, b) => n + ' fait ' + a + NB + '% des passages sans rendez-vous pour ' + b + NB + '% des heures ouvertes.');
  /** @type {Map<string, number>} */
  const anyone = new Map();
  for (const d of dayRange(from, today)) for (const id of s.apptsByDay.get(d) || []) {
    const a = s.appts.get(id);
    if (a && !a.legacy && a.anyStaff && a.source === 'site' && a.status !== 'cancelled' && a.status !== 'no_show') anyone.set(a.staffId, (anyone.get(a.staffId) || 0) + 1);
  }
  skew('any', anyone, (n, a, b) => n + ' reçoit ' + a + NB + '% des réservations «' + NB + 'sans préférence' + NB + '»' + ' pour ' + b + NB + '% des heures ouvertes.');
  // idle chair time since Monday: the chair that stood empty longer than the others'
  const wk = report(s, { from: weekStart(today), to: today, staffId: null, today, now });
  const idle = new Map(wk.staff.map((x) => [x.id, x.idleMin]));
  const mean = chairs.length ? chairs.reduce((t, c) => t + (idle.get(c.id) || 0), 0) / chairs.length : 0;
  const emptiest = chairs.map((c) => ({ c, m: idle.get(c.id) || 0 })).sort((a, b) => b.m - a.m)[0];
  if (emptiest && emptiest.m >= IDLE_MIN && emptiest.m >= mean * HIGH) out.push({ staffId: emptiest.c.id, kind: 'idle', text: emptiest.c.name + ' a ' + hours(emptiest.m) + ' libres cette semaine.', gap: Math.log(emptiest.m / Math.max(mean, 1)) });
  return out.sort((a, b) => b.gap - a.gap).slice(0, MAX_HINTS).map(({ staffId, kind, text }) => ({ staffId, kind, text }));
}

/**
 * @param {any} s
 * @param {{ range: 'day'|'week'|'month', day: string, today: string, now: number }} q
 */
export function cockpit(s, q) {
  const minute = Math.floor(q.now / 60000);
  return memo(s, ['cockpit', q.range, q.day, q.today].join('|'), minute, () => build(s, q));
}

function build(s, q) {
  const { today, now } = q;
  const p = periodOf(q.range, q.day, today);
  const local = localParts(now);
  const days = dayRange(p.from, p.upTo);
  const cur = report(s, { from: p.from, to: p.upTo, staffId: null, today, now });
  // the deltas read like for like (compareOf): `cmp` is the current side, `prv` the one before; null when nothing compares
  const c = compareOf(s, p, today, local.min);
  const cmp = c.cur ? (c.cur.to === p.upTo ? cur : report(s, { from: c.cur.from, to: c.cur.to, staffId: null, today, now })) : null;
  const prv = c.prev ? report(s, { from: c.prev.from, to: c.prev.to, staffId: null, today, now }) : null;
  const cmpDays = c.cur ? dayRange(c.cur.from, c.cur.to) : [], prevDays = c.prev ? dayRange(c.prev.from, c.prev.to) : [];

  // the salon's month goal, where it stands on the last day read; « à ce rythme » is goalOf's, the same as Rapports'
  const goalNow = p.upTo === today ? now : undefined;
  const g = goalOf(s, null, p.upTo, goalNow);
  /** @type {any} */
  let goal = null;
  if (g.target > 0) goal = { ...g, monthLabel: cap(MONTHS_FR[Number(p.upTo.slice(5, 7)) - 1]) };

  // chairs in the salon's order, never by takings; an archived chair stays while he has figures in the period
  const rowOf = new Map(cur.staff.map((x) => [x.id, x]));
  const chairs = [...s.staff.values()].filter((x) => x.chair && (x.active || (rowOf.get(x.id) && (rowOf.get(x.id).revenue || rowOf.get(x.id).done))))
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.name.localeCompare(b.name, 'fr'));
  const blank = { revenue: 0, revenueHT: 0, serviceRevenue: 0, productRevenue: 0, services: 0, tips: 0, tipsCard: 0, tipsCash: 0, tickets: 0, clients: 0, avgTicket: 0, done: 0, noShows: 0, occupancy: 0, rebookRate: 0, commission: 0, rates: { service: 0, product: 0 }, base: 'ttc', walkins: 0, walkinOverrides: 0, newClients: 0, newToMe: 0, discounts: 0, refunds: 0, refundCount: 0, cutsCarnet: { n: 0, value: 0, estimated: 0, unpriced: 0 }, cutsMember: { n: 0, value: 0 }, rewards: { n: 0, value: 0 }, paid: { services: { n: 0, net: 0 }, products: { n: 0, net: 0 }, fees: { n: 0, net: 0 }, packs: { n: 0, net: 0 } }, capMin: 0, idleMin: 0, perHour: 0, returned60: 0, returned60Mine: 0, returned60Base: 0 };
  const weekFrom = weekStart(p.upTo);
  const team = chairs.map((st) => {
    const gd = goalOf(s, st.id, p.upTo, goalNow);
    return {
      ...blank, ...(rowOf.get(st.id) || {}),
      id: st.id, name: st.name, color: st.color, chair: true, active: st.active, photo: st.photo || null,
      goalPct: gd.target > 0 ? Math.round(gd.pct * 100) : null,
      goal: gd.target > 0 ? { target: gd.target, done: gd.done, auto: gd.auto, perDay: gd.perDay, openDaysLeft: gd.openDaysLeft } : null,
      week: weekOf(s, st.id, weekFrom)
    };
  });

  const clients = { total: cur.clients, new: cur.newClients, returning: Math.max(0, cur.clients - cur.newClients) };
  /** one side of a comparison: the figures the deltas read */
  const side = (r, ds) => ({
    cashed: r.revenue, performed: r.performed ?? 0, fill: r.occupancy, clients: r.clients, newClients: r.newClients,
    noShows: r.noShows, noShowRate: r.noShowRate, avgTicket: r.avgTicket, rebookRate: rebookOf(r), returned60: returnedOf(r),
    tips: r.tips, discounts: discountsOf(s, ds), refunds: r.refunds, lost: r.noShowLost
  });
  const kpis = {
    // cashed: the revenue (Chiffre d’affaires TTC, credit notes deducted on their own day); takings: the money that came
    // in (card, cash, online: gift cards sold and tips in, what was settled by gift card or deposit out), as the Z counts it
    cashed: { value: cur.revenue, valueHT: cur.revenueHT, prev: prv ? prv.revenue : 0, tickets: cur.tickets, served: cur.served, prepaidSold: cur.prepaidSold, takings: takingsOf(s, days), goal, series: cur.series.map((d) => d.revenue) },
    performed: cur.performed ?? 0, gap: cur.gap || { prepaidSold: 0, prepaidUsed: 0, rewards: 0, unassigned: 0 },
    fill: { value: cur.occupancy, prev: prv ? prv.occupancy : 0, chairs: team.map((x) => ({ id: x.id, name: x.name, color: x.color, value: x.occupancy })) },
    clients,
    noShows: { count: cur.noShows, rate: cur.noShowRate, lost: cur.noShowLost },
    lateCancels: cur.lateCancels,
    avgTicket: cur.avgTicket, rebookRate: rebookOf(cur), returned60: returnedOf(cur),
    tips: cur.tips, discounts: discountsOf(s, days), refunds: cur.refunds,
    outstanding: outstandingOf(s, today),
    cmp: cmp ? side(cmp, cmpDays) : null,
    prev: prv ? side(prv, prevDays) : null
  };

  return {
    asOf: now,
    range: {
      kind: p.range, day: p.day, from: p.from, to: p.to, upTo: p.upTo, label: p.label, prevLabel: p.prevLabel, prev: c.prev || p.prev, today, live: p.live, partial: p.partial, closed: p.range === 'day' && !openDays(s, p.from, p.to),
      // what the deltas compare, in words and in days; null sides: no delta is shown
      compare: { cur: c.cur, prev: c.prev, curDays: c.curDays, prevDays: c.prevDays, soft: c.soft, words: c.words }
    },
    kpis, team, cash: cashOf(s, today, local.min),
    // what is coming, always from now: today's appointments and the next days' fill (only chairs still in the team)
    today: todayOf(s, today, now, local.min, chairs.filter((x) => x.active)), ahead: aheadOf(s, today, now, chairs.filter((x) => x.active)),
    // built last: it needs the rows above and says nothing below its thresholds
    equity: equityOf(s, today, now, chairs.filter((x) => x.active))
  };
}
