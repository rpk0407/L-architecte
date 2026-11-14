// @ts-check
// WhatsApp, three ways, none through a reseller:
// - by hand (« mode téléphone »): the Comptoir opens WhatsApp on the salon's phone with the text ready (a wa.me link),
//   a person taps Envoyer. No account, no approval, free. waLink() below; the queue is messaging/hand.js.
// - automatic (« mode automatique »): straight to Meta's WhatsApp Business Platform (Cloud API), with the salon's own
//   Meta app: WHATSAPP_TOKEN (a system user's permanent token) and WHATSAPP_PHONE_ID (the number's id, not the number).
//   A message the salon starts must use a template Meta approved: WA_TEMPLATES gives the four to create, word for word
//   (docs/messages-whatsapp.md). When Meta refuses a message, the scheduler sends it by SMS, or hands it to a person.
// - from the client: the site's « Recevoir la confirmation sur WhatsApp » opens a chat with the salon (waLink too).
// Never WhatsApp Web automation (Baileys, whatsapp-web.js…): it breaks WhatsApp's terms and gets the number banned.

/** @typedef {{ name: string, lang?: string, params: [string, string][] }} WaMessage params: [variable name, value], in the template's order */
/** @typedef {{ name: string, send: (to: string, msg: WaMessage) => Promise<{ ref: string }> }} WhatsappProvider */

export const GRAPH_URL = 'https://graph.facebook.com';
/** The Graph API version asked for when WHATSAPP_API_VERSION names none (Meta keeps a version about two years). */
export const GRAPH_VERSION = 'v23.0';
export const WA_LANG = 'fr';

/** "+33 6 12 34 56 78", "06 12 34 56 78", "0033 (0)6…" → "33612345678": the country code, no +. '' when it is not a number. */
export function waNumber(v) {
  let d = String(v || '').replace(/\(0\)/g, '').replace(/[^\d+]/g, '');
  if (d.startsWith('00')) d = '+' + d.slice(2);
  // "+33 06 12…": the national 0 typed after the country code
  if (/^\+330[1-9]\d{8}$/.test(d)) d = '+33' + d.slice(4);
  if (/^0[1-9]\d{8}$/.test(d)) d = '+33' + d.slice(1);
  return /^\+[1-9]\d{7,14}$/.test(d) ? d.slice(1) : '';
}

/**
 * The number of a chat one can open: a mobile. A French landline (01 to 05, 09) has no WhatsApp to write to, so ''.
 * A number from elsewhere is taken as it is: only its country knows which ranges are mobiles.
 */
export function waMobile(v) {
  const d = waNumber(v);
  if (!d.startsWith('33')) return d;
  return /^33[67]\d{8}$/.test(d) ? d : '';
}

/**
 * The click-to-chat link (faq.whatsapp.com/5913398998672934): https://wa.me/<number, international, digits only>
 * ?text=<the message, URL-encoded>. It opens WhatsApp on that chat with the text typed; the person still taps Envoyer.
 * '' when the number is not one a chat can be opened with.
 * @param {string} to @param {string} [text]
 */
export function waLink(to, text = '') {
  const n = waMobile(to);
  if (!n) return '';
  const t = String(text || '').trim();
  return 'https://wa.me/' + n + (t ? '?text=' + encodeURIComponent(t) : '');
}

/**
 * The four templates the salon creates at Meta (WhatsApp Manager › Modèles de message), category « Utilitaire », language
 * French (fr), variables by name. `text` is what to paste there, word for word: Meta refuses a body that starts or ends
 * with a variable, hence the closing words. `params`: the variables the server fills, in the body's order.
 * `moved` is the confirmation's text after a move (the server queues both under 'confirmation').
 * @type {Record<string, { name: string, lang: string, params: string[], text: string, sample: Record<string, string> }>}
 */
export const WA_TEMPLATES = {
  confirmation: {
    name: 'rdv_confirmation', lang: WA_LANG, params: ['prenom', 'date', 'heure', 'barbier', 'lien'],
    text: "Bonjour {{prenom}}, ton rendez-vous chez L'Architecte est confirmé : {{date}} à {{heure}} avec {{barbier}}. Pour le déplacer ou l'annuler : {{lien}} À bientôt !",
    sample: { prenom: 'Karim', date: 'Jeu 12 nov', heure: '14 h 30', barbier: 'JKut', lien: 'https://barberlarchitecte.com/r/LA-7K2P' }
  },
  moved: {
    name: 'rdv_deplace', lang: WA_LANG, params: ['prenom', 'date', 'heure', 'barbier', 'lien'],
    text: "Bonjour {{prenom}}, ton rendez-vous chez L'Architecte est déplacé. Nouvel horaire : {{date}} à {{heure}} avec {{barbier}}. Pour le modifier ou l'annuler : {{lien}} À bientôt !",
    sample: { prenom: 'Karim', date: 'Ven 13 nov', heure: '10 h', barbier: 'JKut', lien: 'https://barberlarchitecte.com/r/LA-7K2P' }
  },
  reminder: {
    name: 'rdv_rappel', lang: WA_LANG, params: ['heure', 'barbier', 'lien'],
    text: "Rappel de L'Architecte : on t'attend demain à {{heure}} avec {{barbier}}. Un imprévu ? Déplace ou annule ici : {{lien}} À demain !",
    sample: { heure: '14 h 30', barbier: 'JKut', lien: 'https://barberlarchitecte.com/r/LA-7K2P' }
  },
  cancelled: {
    name: 'rdv_annule', lang: WA_LANG, params: ['date', 'heure', 'lien'],
    text: "L'Architecte : ton rendez-vous du {{date}} à {{heure}} est annulé. Pour en reprendre un : {{lien}} À bientôt !",
    sample: { date: 'Jeu 12 nov', heure: '14 h 30', lien: 'https://barberlarchitecte.com' }
  }
};

/** The mapping Réglages saves when the owner picks the automatic mode: the four templates above, under their names. */
export function waDefaults() {
  /** @type {Record<string, { name: string, lang: string, params: string[] }>} */
  const out = {};
  for (const [k, t] of Object.entries(WA_TEMPLATES)) out[k] = { name: t.name, lang: t.lang, params: [...t.params] };
  return out;
}

/** A confirmation queued after a move: its key ends with the number of moves (commands/agenda.js, 'conf_<id>_<moves>'). */
export function isMoved(m) {
  const n = m && m.template === 'confirmation' ? /_(\d+)$/.exec(String(m.id || '')) : null;
  return !!n && Number(n[1]) > 0;
}

// What Meta's error codes mean for the owner (developers.facebook.com › WhatsApp › Error codes), in words he can act on
const WHY = {
  190: 'jeton refusé ou expiré : refais WHATSAPP_TOKEN (un jeton permanent d’utilisateur système)',
  10: 'ce jeton n’a pas le droit d’envoyer (permission whatsapp_business_messaging)',
  200: 'ce jeton n’a pas le droit d’envoyer (permission whatsapp_business_messaging)',
  100: 'demande refusée par Meta : vérifie WHATSAPP_PHONE_ID (l’identifiant du numéro, pas le numéro)',
  130429: 'trop de messages d’un coup, Meta demande de ralentir',
  131048: 'trop de messages signalés, Meta limite ce numéro',
  131056: 'trop de messages vers ce client en peu de temps',
  131026: 'ce numéro ne reçoit pas WhatsApp',
  131042: 'moyen de paiement manquant ou refusé dans le compte WhatsApp Business',
  131049: 'Meta a choisi de ne pas remettre ce message à ce client',
  132000: 'le nombre de variables ne correspond pas au modèle',
  132001: 'modèle introuvable ou pas encore approuvé dans cette langue',
  132005: 'texte trop long une fois les variables remplies',
  132007: 'modèle refusé par Meta pour son contenu',
  132012: 'les variables ne correspondent pas au modèle (noms ou format)',
  132015: 'modèle mis en pause par Meta (qualité trop basse)',
  132016: 'modèle désactivé par Meta',
  133010: 'ce numéro n’est pas enregistré sur l’API WhatsApp'
};

/**
 * The body of POST /<phone id>/messages for a template (Cloud API, « Send template messages »). Variables by name
 * (parameter_name) as the templates of WA_TEMPLATES are written, or by position ({{1}}, {{2}}…) when `named` is false.
 * @param {string} to digits, with the country code @param {WaMessage} msg @param {boolean} [named]
 */
export function waPayload(to, msg, named = true) {
  const parameters = msg.params.map(([k, v]) => ({ type: 'text', ...(named ? { parameter_name: k } : {}), text: String(v) }));
  return {
    messaging_product: 'whatsapp', recipient_type: 'individual', to, type: 'template',
    template: { name: msg.name, language: { code: msg.lang || WA_LANG }, ...(parameters.length ? { components: [{ type: 'body', parameters }] } : {}) }
  };
}

/**
 * Meta's Cloud API, called directly. `phoneId`: the business number's id in the Meta app (API Setup); `token`: a system
 * user's token with whatsapp_business_messaging. The answer « accepted » means Meta took the message, not that the
 * phone got it: a number without WhatsApp is only told later, on Meta's webhook (not plugged in here).
 * The token never appears in an error: only Meta's own words and code do.
 * @param {{ token: string, phoneId: string, version?: string, named?: boolean, fetchImpl?: typeof fetch }} o
 * @returns {WhatsappProvider}
 */
export function metaWhatsapp({ token, phoneId, version = GRAPH_VERSION, named = true, fetchImpl = fetch }) {
  const url = GRAPH_URL + '/' + (version || GRAPH_VERSION) + '/' + encodeURIComponent(phoneId) + '/messages';
  return {
    name: 'whatsapp',
    async send(to, msg) {
      const contact = waMobile(to);
      if (!contact) throw Object.assign(new Error('WhatsApp : numéro invalide'), { status: 400 });
      if (!msg || !msg.name) throw Object.assign(new Error('WhatsApp : modèle manquant'), { status: 400 });
      const res = await fetchImpl(url, {
        method: 'POST',
        headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' },
        body: JSON.stringify(waPayload(contact, msg, named)),
        signal: AbortSignal.timeout(8000)
      });
      /** @type {any} */
      const j = await res.json().catch(() => ({}));
      const err = j && j.error;
      if (!res.ok || err) {
        const code = err && Number(err.code);
        const detail = err && ((err.error_data && err.error_data.details) || err.error_user_msg || err.message);
        const why = (code && WHY[code]) || String(detail || 'erreur ' + res.status).slice(0, 120);
        throw Object.assign(new Error('WhatsApp : ' + why + (code ? ' (Meta ' + code + (msg.name && code >= 132000 && code < 133000 ? ', modèle ' + msg.name : '') + ')' : '')), { status: res.status, code: code || 0 });
      }
      const id = j && Array.isArray(j.messages) && j.messages[0] && j.messages[0].id;
      if (!id) throw Object.assign(new Error('WhatsApp : réponse de Meta sans identifiant de message'), { status: res.status });
      return { ref: String(id) };
    }
  };
}
