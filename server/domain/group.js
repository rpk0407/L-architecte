// @ts-check
// A booking of several people (« Ajouter une personne », commands/agenda.js): the places made together share ext.group.
// Read off the state here: who is in it, who organised it, what each side may see. The organiser is the person who
// booked (his own place has no ext.guest); a friend's page shows his own place and the organiser's first name, never the
// others' places, numbers or links. Pure reads: no event, nothing stored.
import { bookerOf, guestFirst, contactCidOf } from './notify.js';
import { rootOf } from './membership.js';
import { dayShort, fmtTime } from '../../shared/dates.js';
import { fmtEur } from '../../shared/money.js';

export const groupIdOf = (a) => (a && a.ext && a.ext.group) || '';

/**
 * group id → its places in the order they were booked (the organiser's first), for the groups of these bookings: one
 * pass over the agenda, and none when no booking of the list belongs to a group (the usual day).
 * @param {any} s @param {any[]} list @returns {Map<string, any[]>}
 */
export function groupsOf(s, list) {
  const want = new Set(list.map(groupIdOf).filter(Boolean));
  /** @type {Map<string, any[]>} */
  const out = new Map();
  if (!want.size) return out;
  for (const a of s.appts.values()) {
    const g = groupIdOf(a);
    if (!g || !want.has(g)) continue;
    const l = out.get(g);
    if (l) l.push(a); else out.set(g, [a]);
  }
  return out;
}
/** The places of this booking's group still standing (not cancelled), itself included; [] outside a group. */
export function groupMembers(s, a, idx) {
  const g = groupIdOf(a);
  if (!g) return [];
  return ((idx || groupsOf(s, [a])).get(g) || []).filter((x) => x.status !== 'cancelled');
}

/** Who organised it: the file of the person who booked, and his first name ('' when his file is erased). */
export function organiserOf(s, members) {
  if (!members.length) return { cid: '', first: '' };
  const own = members.find((x) => !(x.ext && x.ext.guest));
  const raw = own ? own.clientId : bookerOf(members[0], s) || members[0].clientId;
  const cid = raw ? rootOf(s, raw) : '';
  const c = cid ? s.clients.get(cid) : null;
  return { cid: cid || '', first: c && !c.erased ? c.first || '' : '' };
}
/** The first name of the person a place is for. */
export const personFirst = (s, a, org) => (a.ext && a.ext.guest ? guestFirst(s, a) : org.first) || 'Invité';
/** Is this place followed by the organiser himself (his own, a child's, a friend's without a number of his own)? */
export const heldByOrganiser = (s, a, org) => { const c = contactCidOf(a, s); return !!c && rootOf(s, c) === org.cid; };

/**
 * « Groupe de Karim · 3 personnes » for the Comptoir: on every list (brief), and with each place on a booking's sheet
 * and the till (detail: who, what, the price, the barber, whether it is paid).
 * @param {any} s @param {any} a @param {{ idx?: Map<string, any[]>, detail?: boolean }} [o]
 */
export function groupBrief(s, a, o = {}) {
  const all = groupIdOf(a) ? ((o.idx || groupsOf(s, [a])).get(groupIdOf(a)) || []) : [];
  const live = all.filter((x) => x.status !== 'cancelled');
  if (live.length < 2 && all.length < 2) return null;
  const org = organiserOf(s, all);
  const brief = { id: groupIdOf(a), by: org.first, size: live.length };
  if (!o.detail) return brief;
  return {
    ...brief,
    members: live.map((x) => ({
      id: x.id, first: personFirst(s, x, org), organiser: !(x.ext && x.ext.guest), day: x.day, start: x.start, staffId: x.staffId, status: x.status, paid: !!x.saleId,
      services: x.services.map((v) => ({ id: v.id, name: v.name, price: v.price })), price: x.price,
      deposit: x.deposit && x.deposit.paid && x.deposit.paymentId ? { paid: x.deposit.paid, paymentId: x.deposit.paymentId } : null
    })),
    total: live.reduce((t, x) => t + (x.price || 0), 0)
  };
}

/**
 * What a booking's page says about its group. To the organiser (his link, or the link of a place he follows): every
 * person, service, price, the total, each place's link and the text to send to his friends. To a friend (the link of
 * his own place): who organised it and how many they are, nothing else.
 * @param {any} s @param {any} a
 * @param {{ organiser: boolean, origin: string, tokenFor: (x: any, kind: 'appt'|'guest') => string }} o
 */
export function groupView(s, a, o) {
  const members = groupMembers(s, a);
  if (members.length < 2) return null;
  const org = organiserOf(s, members);
  if (!o.organiser) return { organiser: false, by: org.first, size: members.length };
  const sh = s.settings.shop;
  const address = [sh.address, [sh.zip, sh.city].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  const people = members.map((x) => {
    const st = s.staff.get(x.staffId);
    const guest = !!(x.ext && x.ext.guest);
    const mine = heldByOrganiser(s, x, org);
    return {
      first: personFirst(s, x, org), self: x.id === a.id, organiser: !guest, day: x.day, start: x.start, status: x.status,
      staff: st ? st.name : '', services: x.services.map((v) => v.name), price: x.price, from: x.services.some((v) => v.from),
      // the organiser keeps control of every place: the full link for those he follows, the place alone for a friend who
      // has his own number (that friend's other bookings are his own business)
      token: o.tokenFor(x, mine ? 'appt' : 'guest'),
      // what a friend receives: the link of his own place, and of nothing else
      link: guest && !(x.ext.guest.kind === 'child') ? o.origin + '/r/' + o.tokenFor(x, 'guest') : ''
    };
  });
  const total = members.reduce((t, x) => t + (x.price || 0), 0);
  const when = (p) => dayShort(p.day) + ' à ' + fmtTime(p.start);
  const lines = people.map((p) => '• ' + p.first + ' : ' + p.services.join(' + ') + ', ' + when(p) + (p.staff ? ' avec ' + p.staff : '') + (p.link ? '\n  Ta place (voir, déplacer, annuler) : ' + p.link : ''));
  const text = [(org.first || 'On') + ' a réservé pour ' + people.length + ' chez ' + sh.name + ' :', ...lines, 'Adresse : ' + address + (sh.mapsUrl ? '\n' + sh.mapsUrl : '')].join('\n');
  return { organiser: true, by: org.first, size: people.length, people, total, totalWords: fmtEur(total), share: { title: 'Rendez-vous chez ' + sh.name, text } };
}
