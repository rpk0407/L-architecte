// @ts-check
// The owner's alerts during the day (settings.notify.alerts), a tick step: what the evening summary would only say at
// 20 h. Three breakdowns, each read from facts every instance shares or the scheduler hands over (ctx.meta.health):
// - sms:    the last texts of the day all failed (SMS_FAILS in a row, by SMS or WhatsApp);
// - cron:   a message due today waited more than SILENT_MS with no dispatch at all (nothing called the scheduler);
// - backup: the last backup is more than 36 h old (core/backup.js STALE_MS, the red of Réglages › Données);
// - hand:   « mode téléphone », late in the evening (HAND_LATE_MIN, or two hours after the reminders' hour) texts to clients
//           still wait for a person on the Messages screen, tomorrow's reminders among them (messaging/hand.js): nobody opened
//           it. Its line stays in the Comptoir only while one of those texts still waits.
// One e-mail per breakdown and per day (the key is the cause and the day, so two ticks or two servers queue one), and
// one line in the Comptoir while that day lasts (alertWarnings). Production only, and only from the scheduler
// (ctx.meta.health): a tick run by hand, the demo and the tests say nothing.
import { instantOf, fmtTime, localParts } from '../../../shared/dates.js';
import { ownerAlert } from '../../domain/notices.js';
import { dayFr } from '../../domain/mails.js';
import { cutoverHeld } from '../../projections/bascule.js';
import { handEligible, handRefusal, handStale } from '../../messaging/hand.js';
import { STALE_MS } from '../../core/backup.js';

export const SMS_FAILS = 3;
export const SILENT_MS = 30 * 60000;
export const ALERT_TEMPLATE = 'owner_alert';
export const CAUSES = /** @type {const} */ (['sms', 'cron', 'backup', 'hand']);
/** From this time of the evening, texts still waiting for a person are told once (two hours after a later reminder hour, 23 h 30 at most). */
export const HAND_LATE_MIN = 21 * 60;
export const handLateMin = (s) => Math.min(23 * 60 + 30, Math.max(HAND_LATE_MIN, (Number(s.settings.messages.reminderHour) || 18) * 60 + 120));
/** The line the Comptoir shows while an alert of today stands. */
const WORDS = {
  sms: 'Les SMS ne partent plus : les derniers envois ont échoué. Regarde Relances › Messages envoyés et le crédit du fournisseur.',
  cron: 'Le planificateur est resté muet : des messages sont partis en retard. Vérifie le cron (Réglages › Santé).',
  backup: 'La dernière sauvegarde a plus de 36 h. Regarde Réglages › Données.',
  hand: 'Des messages aux clients attendent encore sur l’écran Messages, avec les rappels de demain : ouvre-le pour les envoyer depuis le WhatsApp du salon.'
};
export const alertKey = (cause, day) => 'alert_' + cause + '_' + day;

/** Today's alerts, as lines for the Comptoir (the owner's): one per breakdown already told by e-mail today. */
export function alertWarnings(s, day) {
  return CAUSES.filter((c) => s.messages.has('msg_' + alertKey(c, day)) && (c !== 'hand' || handLeft(s, s.messages.get('msg_' + alertKey(c, day)).at))).map((c) => WORDS[c]);
}
/** One of the texts that waited for a person when the evening alert was told still waits (then its line stays in the Comptoir). */
function handLeft(s, since) {
  for (const m of s.messages.values()) if (m.status === 'queued' && handEligible(m) && m.dueAt <= since && !cutoverHeld(s, m)) return true;
  return false;
}

/**
 * The texts that wait for a person now (the Messages screen's own rules: due, not held for the switch, not too late, to a
 * client who can get them), and how many of them are reminders for tomorrow.
 * @param {(m: any) => boolean} byHand @returns {{ n: number, reminders: number }}
 */
export function handWaiting(s, now, byHand) {
  let n = 0, reminders = 0;
  for (const m of s.messages.values()) {
    if (m.status !== 'queued' || m.dueAt > now || !byHand(m) || cutoverHeld(s, m) || handStale(s, m, now) || handRefusal(s, m)) continue;
    n++;
    if (m.template === 'reminder') reminders++;
  }
  return { n, reminders };
}

/** The last SMS_FAILS texts that ended today (sent or failed) all failed: the count and the provider's last words, or null. */
export function smsFailing(s, since) {
  const done = [...s.messages.values()].filter((m) => (m.channel || 'sms') !== 'email' && (m.status === 'sent' || m.status === 'failed') && (m.sentAt || 0) >= since)
    .sort((a, b) => b.sentAt - a.sentAt);
  if (done.length < SMS_FAILS || done.slice(0, SMS_FAILS).some((m) => m.status !== 'failed')) return null;
  let n = 0;
  while (n < done.length && done[n].status === 'failed') n++;
  return { n, error: String(done[0].error || '') };
}

/**
 * The longest wait, today, of a message nothing dispatched in time: due, on a channel with a provider, not held for the
 * switch, and no claim of any message within SILENT_MS of its time (a backlog draining ten at a time is not silence).
 * @param {{ sms?: boolean, email?: boolean, byHand?: (m: any) => boolean }} providers @returns {number} ms, 0 when the scheduler kept up
 */
export function silence(s, now, since, providers) {
  const msgs = [...s.messages.values()];
  const claims = msgs.map((m) => m.claimedAt || 0).filter((t) => t >= since).sort((a, b) => a - b);
  const firstAfter = (t) => claims.find((c) => c >= t) || 0;
  const switched = (s.bascule && s.bascule.switchedAt) || 0;
  let worst = 0;
  for (const m of msgs) {
    const due = Math.max(m.dueAt || 0, m.at || 0);
    if (due < since || due > now || !(m.claimedAt || m.status === 'queued') || !providers[m.channel === 'email' ? 'email' : 'sms']) continue;
    // held for the switch, or one that waited for it: not a scheduler that stopped (as Réglages › Santé reads it)
    if (cutoverHeld(s, m) || (switched && due < switched && (!m.claimedAt || m.claimedAt >= switched))) continue;
    // a text put back for a later try (a contract's acknowledgement) was dispatched once already
    if (m.tries) continue;
    // « mode téléphone »: a text that waits for a person on the Messages screen (messaging/hand.js), not for the scheduler
    if (typeof providers.byHand === 'function' && providers.byHand(m)) continue;
    const next = firstAfter(due);
    const wait = (next || now) - due;
    if (wait > SILENT_MS && wait > worst) worst = wait;
  }
  return worst;
}

const mins = (ms) => { const m = Math.round(ms / 60000); return m >= 120 ? Math.round(m / 60) + ' h' : m + ' min'; };

/** @type {{ name: string, run: (s: any, ctx: import('../../core/engine.js').Ctx) => void }} */
export default {
  name: 'alerts',
  run(s, ctx) {
    const N = s.settings.notify, H = ctx.meta.health;
    if (!H || s.mode !== 'production' || !N || N.alerts === false) return;
    const day = ctx.local.day, since = instantOf(day, 0);
    const told = (c) => s.messages.has('msg_' + alertKey(c, day));
    const tell = (cause, subject, lines) => ownerAlert(s, ctx, { key: alertKey(cause, day), template: ALERT_TEMPLATE, subject, lines: ['Bonjour,', '', ...lines, '', 'Une seule alerte par panne et par jour : le résumé du soir dira la suite.'] });
    if (!told('sms')) {
      const f = smsFailing(s, since);
      if (f) tell('sms', 'Alerte : les SMS ne partent plus', [
        'Les ' + f.n + ' derniers SMS du salon ont échoué' + (f.error ? ' (« ' + f.error + ' »)' : '') + '.',
        'Les rappels de tes clients ne partent pas : vérifie le crédit et l’état de ton fournisseur SMS, puis Relances › Messages envoyés.'
      ]);
    }
    if (!told('cron')) {
      const w = silence(s, ctx.now, since, H.providers || {});
      if (w) tell('cron', 'Alerte : le planificateur est resté muet ' + mins(w), [
        'Un message prêt à partir a attendu ' + mins(w) + ' : rien n’a appelé le planificateur pendant ce temps.',
        'Vérifie le cron externe (cron-job.org) dans Réglages › Santé : sans lui, rappels et résumés attendent une visite du Comptoir ou du site.'
      ]);
    }
    // « mode téléphone »: late in the evening, texts nobody sent from the Messages screen (tomorrow's reminders first of all)
    const P = H.providers || {};
    if (!told('hand') && typeof P.byHand === 'function' && ctx.local.min >= handLateMin(s)) {
      const w = handWaiting(s, ctx.now, P.byHand);
      if (w.n) tell('hand', (w.reminders ? 'Les rappels de demain ne sont pas partis' : 'Des messages aux clients attendent'), [
        'Il est ' + fmtTime(ctx.local.min) + ' et ' + w.n + (w.n > 1 ? ' messages aux clients attendent' : ' message au client attend') + ' encore sur l’écran Messages'
          + (w.reminders ? ', dont ' + w.reminders + (w.reminders > 1 ? ' rappels' : ' rappel') + ' pour demain' : '') + '.',
        'Ouvre le Comptoir › Messages : un geste par message, depuis le WhatsApp du salon. Un rappel non envoyé avant le rendez-vous ne part plus.'
      ]);
    }
    const b = H.backup;
    if (!told('backup') && b && !b.off && b.at > 0 && ctx.now - b.at > STALE_MS) {
      const p = localParts(b.at);
      tell('backup', 'Alerte : pas de sauvegarde depuis plus de 36 h', [
        'La dernière sauvegarde date de ' + dayFr(p.day) + ' à ' + fmtTime(p.min) + (b.error ? ' (« ' + b.error + ' »)' : '') + '.',
        'Regarde Réglages › Données : tu peux en lancer une à la main, et télécharger la sauvegarde chiffrée en attendant.'
      ]);
    }
  }
};
