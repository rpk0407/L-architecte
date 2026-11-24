// The questions a persona silently asks a page. A question is answered when the page shows the answer where the persona is looking
// (the first viewport for someone standing in the street, the whole page for someone who has sat down to read).
// They are data so a persona can bring its own; a regexp tolerates both apostrophes (' and ’) and accents.

/** @typedef {import('./schema.mjs').Question} Question */

/** At the door, phone in hand, five seconds. */
/** @type {Question[]} */
export const STREET = [
  { id: 'where', q: 'Where exactly is it?', kind: 'text', re: /p[ée]labon|marseille/i, scope: 'viewport' },
  { id: 'open', weight: 3, q: 'Is it open, and can I walk in?', kind: 'text', re: /ouvert|ferm[ée]|sans rendez-vous|jusqu['’]à\s*\d/i, scope: 'viewport' },
  { id: 'price', weight: 3, q: 'How much?', kind: 'text', re: /\d+\s?€/, scope: 'viewport' },
  { id: 'soon', q: 'Can I get a place soon?', kind: 'text', re: /prochain cr[ée]neau|aujourd['’]hui|demain|ce soir|libre/i, scope: 'viewport' },
  { id: 'proof', q: 'Is it any good?', kind: 'text', re: /avis|★|\d[,.]\d\s*·/i, scope: 'viewport' },
  { id: 'call', q: 'Can I phone?', kind: 'tel', scope: 'viewport' },
  { id: 'route', q: 'How do I get there?', kind: 'link', re: /itin[ée]raire|y aller|comment venir|google\.com\/maps|maps\.app/i, scope: 'viewport' }
];

/** Buying a gift card for someone who is not here. */
/** @type {Question[]} */
export const GIFT = [
  { id: 'amount', weight: 3, q: 'How much can I give?', kind: 'text', re: /\d+\s?€|montant/i, scope: 'page' },
  { id: 'message', q: 'Can I add a few words?', kind: 'text', re: /message|un mot|d[ée]dicace/i, scope: 'page' },
  { id: 'delivery', weight: 3, q: 'How does it reach him?', kind: 'text', re: /e-?mail|sms|imprim|envoy|re[cç]oit/i, scope: 'page' },
  { id: 'validity', weight: 3, q: 'How long is it valid?', kind: 'text', re: /valable|validit[ée]|expire|\d+\s*(mois|ans?)\b/i, scope: 'page' },
  { id: 'use', q: 'How will he use it?', kind: 'text', re: /au salon|[àa] la caisse|en caisse|code|r[ée]serv/i, scope: 'page' }
];

/** A prospective trainee, with a parent reading over his shoulder. */
/** @type {Question[]} */
export const TRAINING = [
  { id: 'what', q: 'What will I learn?', kind: 'text', re: /module|taille|coupe|d[ée]grad[ée]|barbe/i, scope: 'page' },
  { id: 'cost', weight: 3, q: 'What does it cost?', kind: 'text', re: /\d[\d\s.,]*\s?€/, scope: 'page' }, // a figure: « sur devis » is a request to ask, not an answer
  { id: 'when', weight: 3, q: 'When are the sessions?', kind: 'text', re: /\b\d{1,2}\s+(janv(ier)?|f[ée]vr(ier)?|mars|avr(il)?|mai|juin|juil(let)?|ao[uû]t|sept(embre)?|oct(obre)?|nov(embre)?|d[ée]c(embre)?)\b|\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/i, scope: 'page' }, // a date: « sur demande » is not one, and « 13013 Marseille » is not « 13 mars »
  { id: 'valid', weight: 3, q: 'Is it certified?', kind: 'text', re: /agr[ée]|agr[ée]ment|dipl[oô]m|certif/i, scope: 'page' },
  { id: 'apply', weight: 3, q: 'How do I ask or apply?', kind: 'link', re: /int[ée]ress|contact|demande|candidat|postuler/i, scope: 'page' },
  { id: 'human', weight: 3, q: 'Is there a person I can reach?', kind: 'contact', scope: 'page' }
];

/** A member who wants out. */
/** @type {Question[]} */
export const EXIT = [
  { id: 'here', weight: 4, q: 'Can I cancel from here, with no account?', kind: 'text', re: /r[ée]sili|annul/i, scope: 'page' },
  { id: 'give', q: 'What do I have to give you?', kind: 'text', re: /num[ée]ro|e-?mail|t[ée]l[ée]phone/i, scope: 'page' },
  { id: 'next', weight: 3, q: 'What happens next?', kind: 'text', re: /lien|sms|e-?mail|fin du mois|dernier|apr[èe]s/i, scope: 'page' }
];
