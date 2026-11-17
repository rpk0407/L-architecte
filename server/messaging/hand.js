// @ts-check
// « Mode téléphone »: the texts to clients that no automatic way will take wait for a person. The Comptoir's Messages
// screen lists them, each with a button that opens WhatsApp on the phone with the text ready (messaging/whatsapp.js
// waLink); « Envoyé » records it (commands/messages.js handSent). Nothing here sends anything by itself.
// One rule decides who carries a text, read by the scheduler (it leaves these alone) and by the screen (it shows them):
// byHand below. The hold before the switch from WordPress applies here as everywhere (projections/bascule.js).
import { TEMPLATE_FLAGS, SECRET_TEMPLATES, classOf } from '../core/templates.js';
import { waMode, salonWhatsapp } from '../settings/messages.js';
import { waMapping, fileOf } from '../domain/messages.js';
import { ownerEmail } from '../domain/mails.js';
import { isEmail } from '../lib/util.js';
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

/** The e-mails that already say what a text says, by the text's key: conf_ → mconf_ (domain/mails.js, commands/system.js). */
const TWIN_KEYS = [['msg_conf_', 'msg_mconf_'], ['msg_rem_', 'msg_mrem_'], ['msg_rem2_', 'msg_mrem2_'], ['msg_cx_', 'msg_mcx_']];

/**
 * Was an e-mail queued for the same event as this text? Its named twin (the confirmation's, the reminder's, the
 * cancellation's own mail), or any mail to the client queued by the same command (the same instant, the same file, the
 * same appointment): a contract's acknowledgement, a link sent both ways. A mail to the salon itself (the owner's
 * alert about this client) is no twin.
 */
export function mailTwin(s, m) {
  for (const [a, b] of TWIN_KEYS) if (m.id.startsWith(a) && s.messages.has(b + m.id.slice(a.length))) return true;
  let own = null;
  for (const x of s.messages.values()) {
    if (x.channel !== 'email' || x.owner || x.at !== m.at || x.cid !== m.cid || (x.apptId || null) !== (m.apptId || null) || x.resendOf) continue;
    if (!own) { own = new Set([String(ownerEmail(s) || '').toLowerCase()]); for (const st of s.staff.values()) if (st.email) own.add(String(st.email).toLowerCase()); }
    if (!own.has(String(x.to || '').toLowerCase())) return true;
  }
  return false;
}

/**
 * THE RULE « everything leaves by e-mail when no SMS can »: the address this text leaves to by e-mail, or ''.
 * It lives here, read as the text leaves (http/scheduler.js) and not as it is queued, for three reasons: only the
 * runtime knows which providers are plugged in (a command does not, and its events must replay the same on any server);
 * the text keeps its id, its hour (the review's delay, the quiet hours) and its consent check at the claim, so the
 * tracked links and the once-a-quarter cap need no second copy; and it is the same message that leaves, claimed once,
 * so nothing can go twice. byHand below reads it too: a text the mail takes is no longer a person's to send.
 * Yes when: production, an e-mail provider, the salon's e-mails to clients on, no SMS provider and no automatic WhatsApp
 * for this text; a text to the client's own mobile (never a gift card's code texted to someone else), whose file has an
 * address; and no e-mail already says the same (mailTwin: confirmation, reminder, cancellation, move).
 * Never: an offer (the client's yes was asked for SMS: « les bons plans par SMS », and no mail carries an unsubscribe
 * link), a sign-in code, the owner's own tests.
 * @param {any} s @param {{ sms?: any, whatsapp?: any, email?: any }} rt @param {any} m @returns {string}
 */
export function byMail(s, rt, m) {
  if (!m || m.channel === 'email' || m.owner || !m.cid || !rt || !rt.email || rt.sms || s.mode === 'demo') return '';
  if (s.settings.messages.email === false || m.marketing || classOf(m.template) === 'marketing' || SECRET_TEMPLATES.has(m.template)) return '';
  if (rt.whatsapp && !m.manual && waMode(s.settings.messages) === 'auto' && waTemplateOf(s, m)) return '';
  const c = fileOf(s, m.cid);
  if (!c || c.erased || !isEmail(c.email) || !m.to || m.to !== c.phone) return '';
  // FEATURE B: a client who chose WhatsApp keeps it: a person sends his texts from the salon's WhatsApp (byHand)
  if (c.notify === 'whatsapp' && salonWhatsapp(s.settings.messages)) return '';
  return mailTwin(s, m) ? '' : String(c.email).toLowerCase();
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
  // nothing automatic can text, but the client has an address and no mail says it yet: the mail takes it (byMail)
  if (byMail(s, rt, m)) return false;
  if (m.manual) return true;
  const mode = waMode(s.settings.messages);
  if (mode === 'phone') return true;
  if (s.mode === 'demo') return false;
  // FEATURE B: a client who chose WhatsApp (domain/notify.js) while the salon sends SMS: a person sends it from the salon's WhatsApp
  if (mode === 'sms' && salonWhatsapp(s.settings.messages)) { const c = fileOf(s, m.cid); if (c && c.notify === 'whatsapp') return true; }
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

const KIND = { confirmation: 'Confirmation', reminder: 'Rappel', reminder2h: 'Rappel du jour', cancelled: 'Annulation', waitlist: 'Place libérée', queue: 'Bientôt ton tour', receipt: 'Reçu', payLink: 'Lien de paiement', reassign: 'Barbier absent', reassignAt: 'Barbier absent', reschedule: 'Rendez-vous à décaler', giftcardCode: 'Carte cadeau', giftcard: 'Carte cadeau' };
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
