// @ts-check
// The default SMS texts, one per automatic message. A REGISTRY: a package that adds a message adds its text here
// (one owner per wave), and the owner's edits live in settings.messages.templates, keyed the same way.
// Written in the GSM alphabet (straight apostrophe, no ç, ê or ô) so each text costs one SMS, not three.
export const TEMPLATES = {
  confirmation: "L'Architecte : c'est noté {prenom} ! {date} à {heure} avec {barbier}. Gérer : {lien}",
  reminder: "L'Architecte : rappel, demain {heure} avec {barbier}. Un imprévu ? Déplace ou annule ici : {lien}",
  reminder2h: "L'Architecte : on t'attend à {heure} avec {barbier}, à tout à l'heure !",
  review: "Merci {prenom} ! 30 secondes pour un avis ? Ça nous aide énormément : {avis}",
  rebook: "Salut {prenom}, déjà {jours} jours depuis ta dernière coupe. On s'y remet ? Réserve ici : {lien}",
  waitlist: "L'Architecte : place libérée {date} à {heure} avec {barbier}, à toi pendant 30 min : {lien}",
  queue: "L'Architecte : c'est presque ton tour, {prenom}. Reviens au salon, on t'installe dans 5 minutes.",
  cancelled: "L'Architecte : ton rendez-vous du {date} à {heure} est annulé. Pour en reprendre un : {lien}",
  receipt: "L'Architecte : merci {prenom} ! Ton ticket {ticket} de {montant} : {lien}"
};

// What a text is, beyond its words, keyed like TEMPLATES (the same owner adds both). marketing: sent only to
// clients who agreed, with the STOP mention (settings.messages.stopSuffix). quiet: never at night nor on Sunday,
// it waits for settings.messages.quiet to end. A text with no entry is a service message and leaves at once.
/** @type {Record<string, { marketing?: boolean, quiet?: boolean }>} */
export const TEMPLATE_FLAGS = {
  review: { quiet: true },
  rebook: { marketing: true, quiet: true },
  waitlist: { quiet: true }
};
