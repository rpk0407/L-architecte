// @ts-check
// « Mode téléphone »: the texts to clients that no automatic way will take wait for a person. The Comptoir's Messages
// screen lists them, each with a button that opens WhatsApp on the phone with the text ready (messaging/whatsapp.js
// waLink); « Envoyé » records it (commands/messages.js handSent). Nothing here sends anything by itself.
// One rule decides who carries a text, read by the scheduler (it leaves these alone) and by the screen (it shows them):
// byHand below. The hold before the switch from WordPress applies here as everywhere (projections/bascule.js).
import { TEMPLATE_FLAGS, classOf } from '../core/templates.js';
import { waMode } from '../settings/messages.js';
import { waMapping, fileOf } from '../domain/messages.js';
import { startsAt } from '../domain/policy.js';
import { cutoverHeld } from '../projections/bascule.js';
import { addDays } from '../../shared/dates.js';
import { waMobile, waLink, isMoved } from './whatsapp.js';

const DAY_MS = 86400000;

/**
 * A text a person can send for the salon: a service text to a client's phone. Never an offer nor a review request
 * (WhatsApp asks the client's own yes for those: they stay SMS), never what the client is waiting for with his phone in
 * hand (a code, a link he asked for) nor a contract's acknowledgement: those must not wait for someone to be free.
 */
export function handEligible(m) {
  const f = TEMPLATE_FLAGS[m.template] || {};
  return m.channel !== 'email' && !!m.cid && !m.owner && !m.marketing && classOf(m.template) === 'service' && !f.requested && !f.legal;
}

/** The WhatsApp template an automatic send would use for this text (the moved one for a confirmation after a move). */
export function waTemplateOf(s, m) {
  if (m.channel === 'email' || !m.wa) return null;
  const M = s.settings.messages;
  return (isMoved(m) && waMapping(M, 'moved')) || waMapping(M, m.template);
}

/**
 * Does this text wait for a person? Yes when the owner chose the phone mode, when an automatic send handed it back
 * (`manual`), when the automatic mode is chosen but not plugged in, or when nothing automatic can take it: no SMS
 * provider, and no WhatsApp template for it.
 * The demo simulates the automatic ways, so only its phone mode waits for a person.
 * @param {any} s @param {{ sms?: any, whatsapp?: any }} rt @param {any} m
 */
export function byHand(s, rt, m) {
  if (!handEligible(m)) return false;
  if (m.manual) return true;
  const mode = waMode(s.settings.messages);
  if (mode === 'phone') return true;
  if (s.mode === 'demo') return false;
  if (mode === 'auto') {
    // chosen but not plugged in yet (no token): the phone mode stands in, rather than a paid SMS nobody asked for
    if (!rt.whatsapp) return true;
    if (waTemplateOf(s, m)) return false;
  }
  return !rt.sms;
}

/**
 * The way the texts to clients really leave now, which is not always the one chosen: the automatic mode without its
 * token, or SMS without a provider, come down to the phone mode.
 * @returns {'sms'|'phone'|'auto'}
 */
export function effectiveMode(s, rt) {
  const mode = waMode(s.settings.messages);
  if (mode === 'phone' || s.mode === 'demo') return mode;
  if (mode === 'auto') return rt.whatsapp ? 'auto' : 'phone';
  return rt.sms ? 'sms' : 'phone';
}

/**
 * Why a waiting text is not worth sending any more, or ''. A person sends in batches (the morning, the evening), so the
 * scheduler's six hours do not apply: a text about an appointment is good until that appointment starts, any other one
 * for a day.
 */
export function handStale(s, m, now) {
  const a = m.apptId ? s.appts.get(m.apptId) : null;
  if (a && m.template !== 'cancelled') {
    if (a.status === 'cancelled' || a.status === 'noshow') return 'Rendez-vous annulé entre-temps';
    // an older confirmation of an appointment moved again since: the newer one says the right time
    const n = m.template === 'confirmation' ? /_(\d+)$/.exec(m.id) : null;
    if (n && Number(n[1]) < (a.moves || 0)) return 'Remplacé par un message plus récent';
  }
  if (a && m.at < startsAt(a)) return startsAt(a) <= now ? 'Trop tard : le rendez-vous est passé' : '';
  return now - m.dueAt > DAY_MS ? 'Trop tard : en attente depuis plus de 24 h' : '';
}

const KIND = { confirmation: 'Confirmation', reminder: 'Rappel', reminder2h: 'Rappel du jour', cancelled: 'Annulation', waitlist: 'Place libérée', queue: 'Bientôt ton tour', receipt: 'Reçu', reassign: 'Barbier absent', reassignAt: 'Barbier absent', reschedule: 'Rendez-vous à décaler', giftcardCode: 'Carte cadeau', giftcard: 'Carte cadeau' };
/** The word the screen puts on a text: « Confirmation », « Déplacement », « Rappel »… */
export const handKind = (m) => (isMoved(m) ? 'Déplacement' : KIND[m.template] || 'Message');

/** May this person send this text? The desk, a manager and the owner (agenda.edit): all of them; a barber: his own clients'. */
export function maySend(s, m, who) {
  if (who.caps.has('agenda.edit')) return true;
  if (!who.caps.has('agenda.own') || !who.staffId) return false;
  const a = m.apptId ? s.appts.get(m.apptId) : null;
  return !!a && a.staffId === who.staffId;
}

/**
 * Why a queued text must not go to this client's phone now, or '': he switched the salon's messages off, his file is
 * gone, or his number is not a mobile. Read again each time the list is built and when « Envoyé » is recorded.
 */
export function handRefusal(s, m) {
  const c = fileOf(s, m.cid);
  if (!c || c.erased) return 'Fiche effacée';
  if (c.sms === false) return 'Messages coupés par le client';
  if (!waMobile(m.to)) return 'Pas de numéro de portable';
  return '';
}

/**
 * The queue of the Messages screen for one person: what to send now, oldest first within each kind of urgency (what is
 * about today before tomorrow's reminders), and who is left out, with the reason.
 * `left`: clients with an appointment today or tomorrow who get no message at all, counted by reason (optout: the
 * messages are switched off on the file or for this booking; nomobile: no mobile number), so nobody thinks they were told. `later`: texts already written whose hour has not come (a reminder waits for its evening).
 * @param {any} s @param {{ sms?: any, whatsapp?: any }} rt @param {number} now @param {{ day: string, min: number }} local
 * @param {{ caps: Set<string>, staffId?: string }} who
 */
export function handQueue(s, rt, now, local, who) {
  const items = [];
  let held = 0, later = 0;
  const out = { optout: 0, nomobile: 0 };
  const seen = new Set();
  for (const m of s.messages.values()) {
    if (m.status !== 'queued' || !byHand(s, rt, m) || !maySend(s, m, who)) continue;
    if (handStale(s, m, now)) continue;
    const no = handRefusal(s, m);
    if (no) { if (no === 'Messages coupés par le client') out.optout++; else if (no === 'Pas de numéro de portable') out.nomobile++; seen.add(m.cid); continue; }
    if (cutoverHeld(s, m)) { held++; continue; }
    if (m.dueAt > now) { later++; continue; }
    const c = fileOf(s, m.cid);
    const a = m.apptId ? s.appts.get(m.apptId) : null;
    const st = a ? s.staff.get(a.staffId) : null;
    items.push({
      id: m.id, kind: handKind(m), template: m.template, at: m.at, dueAt: m.dueAt,
      client: { id: c.id, name: [c.first, c.last].filter(Boolean).join(' ') || 'Client' },
      appt: a ? { id: a.id, day: a.day, start: a.start, barber: st ? st.name : '' } : null,
      text: m.body, link: waLink(m.to, m.body), error: m.fallback || ''
    });
  }
  // today's appointments and tomorrow's whose client the salon cannot write to at all: no text was ever queued for them
  const tomorrow = addDays(local.day, 1);
  for (const a of s.appts.values()) {
    // the demo's own bookings are staged without texts (domain/seed.js): they say nothing about a client's choice
    if (a.status !== 'booked' || a.demo || (a.day !== local.day && a.day !== tomorrow) || startsAt(a) <= now) continue;
    if (!maySend(s, { apptId: a.id }, who)) continue;
    const c = a.clientId ? fileOf(s, a.clientId) : null;
    if (!c || c.erased || seen.has(c.id)) continue;
    seen.add(c.id);
    if (c.phone && (c.sms === false || a.sms === false)) out.optout++;
    else if (!waMobile(c.phone || '')) out.nomobile++;
  }
  const urgency = (x) => (x.appt ? startsAt({ day: x.appt.day, start: x.appt.start }) : x.dueAt);
  items.sort((x, y) => urgency(x) - urgency(y) || x.at - y.at);
  return { items, held, later, left: out };
}

/** How many texts wait for this person now: the number on the menu. */
export function handCount(s, rt, now, local, who) {
  let n = 0;
  for (const m of s.messages.values()) {
    if (m.status !== 'queued' || m.dueAt > now || !byHand(s, rt, m) || !maySend(s, m, who)) continue;
    if (handStale(s, m, now) || handRefusal(s, m) || cutoverHeld(s, m)) continue;
    n++;
  }
  return n;
}
