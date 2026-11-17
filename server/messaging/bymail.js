// @ts-check
// A text to a client, carried by e-mail: the same words, a subject per kind of text, and its main link as a button.
// Used when no SMS can leave by itself (messaging/hand.js byMail decides who, http/scheduler.js sends it) and by
// « Renvoyer » (commands/messages.js). Nothing here decides or sends: it only lays the text out as a mail.
import { isMoved } from './whatsapp.js';
import { classOf } from '../core/templates.js';

/** Per text: the subject, and the words of the button that opens its link ('' when the text has no link worth one). */
const MAILS = /** @type {Record<string, [string, string]>} */ ({
  confirmation: ['Ton rendez-vous est noté', 'Gérer mon rendez-vous'],
  reminder: ['Rappel : ton rendez-vous de demain', 'Gérer mon rendez-vous'],
  reminder2h: ['Rappel : on t’attend tout à l’heure', ''],
  review: ['Merci pour ta visite : ton avis nous aide', 'Laisser un avis'],
  waitlist: ['Une place s’est libérée pour toi', 'Prendre la place'],
  queue: ['C’est bientôt ton tour', ''],
  cancelled: ['Ton rendez-vous est annulé', 'Reprendre rendez-vous'],
  receipt: ['Ton ticket', 'Voir mon ticket'],
  lookup: ['Ton rendez-vous', 'Voir mon rendez-vous'],
  giftcardCode: ['Ta carte cadeau', 'Réserver'],
  giftcard: ['Ta carte cadeau', 'Réserver'],
  reassign: ['Ton barbier est absent : ton rendez-vous est maintenu', 'Voir mon rendez-vous'],
  reassignAt: ['Ton barbier est absent : ton rendez-vous change d’heure', 'Voir mon rendez-vous'],
  reschedule: ['Ton rendez-vous doit être décalé', 'Choisir un nouveau créneau'],
  earlier: ['Une place plus tôt s’est libérée', 'Voir la place'],
  memberWelcome: ['Bienvenue : ton abonnement est actif', 'Réserver'],
  memberFailed: ['Abonnement : paiement refusé', 'Mettre ma carte à jour'],
  memberAction: ['Abonnement : ta banque demande une validation', 'Valider le paiement'],
  memberCancelled: ['Abonnement : résiliation enregistrée', 'Voir mon abonnement'],
  memberStopped: ['Abonnement : résiliation enregistrée', 'Voir mon abonnement'],
  memberWithdrawn: ['Abonnement : rétractation enregistrée', 'Voir mon abonnement'],
  memberWithdrawnNone: ['Abonnement : rétractation enregistrée', 'Voir mon abonnement'],
  memberEnded: ['Ton abonnement a pris fin', 'Reprendre mon abonnement'],
  memberOffer: ['Ton abonnement', 'Voir l’abonnement'],
  memberLink: ['Gérer ton abonnement', 'Gérer mon abonnement'],
  memberCard: ['Abonnement : mets ta carte à jour', 'Mettre ma carte à jour'],
  accesInvite: ['Ton espace client', 'Ouvrir mon espace'],
  formuleRenew: ['Ton carnet est terminé', 'Reprendre un carnet'],
  formuleReleased: ['Tes rendez-vous sont libérés', 'Reprendre rendez-vous'],
  payLink: ['Règle ta coupe en ligne', 'Payer ma coupe'],
  inquiry_reply: ['Réponse du salon', '']
});
const MOVED = 'Ton rendez-vous est déplacé';
const OTHER = /** @type {[string, string]} */ (['Un message du salon', 'Ouvrir le lien']);

/** The way to say no, under a relation text carried by e-mail (replies reach the salon's inbox). */
export const MAIL_STOP = 'Tu ne veux plus de ces messages ? Réponds « stop » à ce mail ou dis-le au salon.';

/** The first address of a text, without the full stop that ends its sentence. */
const linkIn = (body) => { const u = /https?:\/\/[^\s<>"]+/.exec(String(body || '')); return u ? u[0].replace(/[.,;:!?)]+$/, '') : ''; };

/**
 * The mail a text makes: its subject, the same words (the link on a line of its own, so the HTML version can put the
 * button in its place: messaging/email.js mailHtml), the salon's name and phone under it.
 * @param {any} s @param {any} m the queued text @param {string} [body] its words as they leave (a filler's), else m.body
 * @returns {{ subject: string, text: string, cta?: { label: string, url: string }, links: string[] }}
 */
export function mailOfText(s, m, body) {
  const shop = s.settings.shop;
  const [subject, label] = Object.hasOwn(MAILS, m.template) ? MAILS[m.template] : OTHER;
  const words = String(body == null ? m.body : body).trim();
  const url = linkIn(words);
  const lines = (url ? words.replace(url, '\n' + url + '\n') : words).split('\n').map((l) => l.trim()).filter(Boolean);
  const text = [...lines, '', shop.name + (shop.phone ? ' · ' + shop.phone : ''), ...(classOf(m.template) === 'relation' ? ['', MAIL_STOP] : [])].join('\n');
  return {
    subject: ((isMoved(m) ? MOVED : subject) + ' · ' + shop.name).slice(0, 200), text,
    ...(url && label ? { cta: { label, url } } : {}), links: url ? [url] : []
  };
}
