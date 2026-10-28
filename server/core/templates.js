// @ts-check
// The default SMS texts, one per automatic message. A REGISTRY: a package that adds a message adds its text here
// (one owner per wave), and the owner's edits live in settings.messages.templates, keyed the same way.
// Written in the GSM alphabet (straight apostrophe, no ç, ê or ô) so each text costs one SMS, not three.
export const TEMPLATES = {
  confirmation: "L'Architecte : c'est noté {prenom} ! {date} à {heure} avec {barbier}. Gérer : {lien}",
  reminder: "L'Architecte : rappel, demain {heure} avec {barbier}. Un imprévu ? Déplace ou annule ici : {lien}",
  reminder2h: "L'Architecte : on t'attend à {heure} avec {barbier}, à tout à l'heure !",
  // {avis}: the tracked link /avis/<token> (about 90 characters with the domain): the words leave room for it in one SMS
  review: "Merci {prenom} ! Ton avis Google nous aide énormément : {avis}",
  rebook: "Salut {prenom}, déjà {jours} jours depuis ta dernière coupe. On s'y remet ? Réserve ici : {lien}",
  waitlist: "L'Architecte : place libérée {date} à {heure} avec {barbier}, à toi pendant 30 min : {lien}",
  queue: "L'Architecte : c'est presque ton tour, {prenom}. Reviens au salon, on t'installe dans 5 minutes.",
  cancelled: "L'Architecte : ton rendez-vous du {date} à {heure} est annulé. Pour en reprendre un : {lien}",
  // {fidelite}: the loyalty card after this ticket (FID-02), short to stay one SMS: « Carte 6/9. », « Ta prochaine coupe est offerte ! » or nothing
  receipt: "L'Architecte : merci {prenom} ! Ton ticket {ticket} de {montant} : {lien}{fidelite}",
  // asked from /mon-rendez-vous: the next appointment's link, {suite} the one after it (or nothing), {espace} the client
  // space's line when it is open (AC-01: " Ton espace : salon.fr/moi", or nothing)
  lookup: "L'Architecte : ton rendez-vous {date} à {heure} : {lien}{suite}{espace}",
  // DO-03: the code of a gift card, sent from the till's voucher to the person it is for
  giftcardCode: "L'Architecte : {acheteur} t'offre une carte cadeau de {montant} ! Code {code}, valable jusqu'au {date}. Réserve : {lien}",
  // DO-05: a barber is away, the owner's handover plan. {absent} the barber away, {date} "jeudi 29", {barbier} the one who
  // takes the client; "prix inchangé", not "même prix": an ê would make it a Unicode SMS, and the link must still fit
  reassign: "{absent} est absent {date}, {barbier} te prend à {heure}, prix inchangé. Pas d'accord ? {lien}",
  // the same, at another time than the one booked: {avant} that time, so he does not turn up at it (the price gives way)
  reassignAt: "{absent} est absent {date}, {barbier} te prend à {heure} au lieu de {avant}. Pas d'accord ? {lien}",
  reschedule: "{prenom}, on doit décaler ton rendez-vous du {date}. Choisis un nouveau créneau : {lien}",
  // IN-01: a gift card bought online, sent to the person it is for
  giftcard: "{acheteur} t'offre {montant} chez L'Architecte ! Ton code : {code}. Réserve ici : {lien}",
  // PAY-02: the monthly membership, texts about the contract ({lien}: the member's page, else /resilier, the site for the
  // welcome; {date} and {fin} as 27/10, the day it is received and the last day it covers)
  memberWelcome: "L'Architecte : bienvenue {prenom} ! Abonnement {formule} ({prix}/mois) actif. Réserve : {lien}",
  memberFailed: "L'Architecte : {prenom}, paiement de l'abonnement ({prix}) refusé. Mets ta carte à jour : {lien}",
  memberAction: "L'Architecte : ta banque demande de valider le paiement de ton abonnement ({prix}). Valide ici : {lien}",
  memberCancelled: "L'Architecte : résiliation enregistrée le {date}. Tes coupes restent incluses jusqu'au {fin}. {lien}",
  memberStopped: "L'Architecte : résiliation enregistrée le {date}. Ton abonnement prend fin aujourd'hui. {lien}",
  memberWithdrawn: "L'Architecte : rétractation enregistrée le {date}. Remboursement de {montant} sous 14 jours. {lien}",
  memberWithdrawnNone: "L'Architecte : rétractation enregistrée le {date}. Tes coupes valent le mois : rien à rembourser. {lien}",
  memberEnded: "L'Architecte : ton abonnement a pris fin faute de paiement. Pour le reprendre : {lien}",
  memberOffer: "L'Architecte : ton abonnement {formule} ({prix}/mois) : {lien}",
  memberLink: "L'Architecte : pour gérer ou résilier ton abonnement (lien valable 1 h) : {lien}",
  memberCard: "L'Architecte : pour mettre à jour la carte de ton abonnement {formule} : {lien}",
  // AC-01: the salon sends a client the way into his space (AC-02's invite from the file); {lien} /moi?garder=…
  // (« tickets », not « reçus »: a ç would make it a Unicode SMS)
  accesInvite: "L'Architecte : ouvre ton espace (tes rendez-vous, tes tickets) : {lien}"
};

// What a text is, beyond its words, keyed like TEMPLATES (the same owner adds both). Three classes, one rule each
// (classOf; the gate is queueMessage and consentGone in domain/messages.js, re-checked at claim):
// - service (no class flag): about a booking, a purchase or a contract of the client. Needs c.sms (the caller checks
//   it: the per-booking switch, the file's « SMS de service »). Leaves by SMS or WhatsApp.
// - relation: to an existing client about a visit he made or a right he holds, never a promotion (legitimate interest,
//   CNIL « messages relationnels »): the review request. Needs c.sms and no STOP (marketingSrc 'stop'); never to an
//   erased file nor without one. SMS only (WhatsApp asks a separate opt-in), or an e-mail to a file without a phone.
// - marketing: an offer. Needs c.marketing, carries the STOP mention (settings.messages.stopSuffix), waits for the
//   quiet hours. SMS only, never by e-mail.
// Relation and marketing texts never go to a file imported from WordPress that was never told about the new site
// (projections/informed.js). Other flags: quiet: never at night nor on Sunday, it waits for settings.messages.quiet
// to end. legal: a contract's acknowledgement (membership texts, a fee link): never expired, never held by the
// cutover, retried until sent. requested: asked by the client himself (lookup, a sign-in code, a link to his space,
// his data): ignores c.sms, never held, sent before anything else. A text with no entry is a service message and
// leaves at once. Service texts about a contract never carry the marketing flag.
/** @type {Record<string, { marketing?: boolean, relation?: boolean, quiet?: boolean, legal?: boolean, requested?: boolean }>} */
export const TEMPLATE_FLAGS = {
  review: { relation: true, quiet: true },
  rebook: { marketing: true, quiet: true },
  waitlist: { quiet: true },
  // PAY-02: the membership's acknowledgements (and their e-mails) are legal; the member's own link is requested
  memberWelcome: { legal: true },
  memberCancelled: { legal: true },
  memberStopped: { legal: true },
  memberWithdrawn: { legal: true },
  memberWithdrawnNone: { legal: true },
  memberLink: { requested: true },
  memberLinkMail: { requested: true },
  lookup: { requested: true },
  // AC-01: the sign-in code (its fixed words live in domain/otp.js, not here) and the salon's invite to the space
  otp: { requested: true },
  accesInvite: { requested: true },
  // AC-02: a copy of his data, e-mailed to a client who asked for it from his space
  dataExport: { requested: true }
};

/** @typedef {'service'|'relation'|'marketing'} TextClass */
/** The consent class of a text (the header above says what each one needs). @returns {TextClass} */
export function classOf(template) {
  const f = TEMPLATE_FLAGS[template] || {};
  return f.marketing ? 'marketing' : f.relation ? 'relation' : 'service';
}

/** Texts that carry a secret (a sign-in code): a provider's error may echo the text, and the chained outcome can never be
 *  erased, so their error and fallback keep these fixed words instead (commands/messages.js, commands/sms-inbound.js).
 *  The package that adds such a text adds its key here. */
export const SECRET_TEMPLATES = new Set(['otp']);
export const SECRET_ERROR = 'Refusé par le fournisseur (détail masqué : le message contient un code)';
