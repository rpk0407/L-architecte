// @ts-check
// WhatsApp through Brevo's API (same BREVO_API_KEY as the SMS and e-mails), from the salon's WhatsApp Business number
// (WHATSAPP_SENDER). A message the salon starts must use a template approved by Meta: the owner (or the provider) pastes
// each template's Brevo id and the order of its variables in Réglages › Messages › Canal d'envoi (settings.messages.whatsapp).
// Never WhatsApp Web automation: it breaks WhatsApp's terms and gets the number banned. When WhatsApp refuses a message,
// the scheduler sends it by SMS instead, once (http/scheduler.js).

/** @typedef {{ templateId: number, params: [string, string][] }} WaMessage params: [variable name, value], in the template's order */
/** @typedef {{ name: string, send: (to: string, msg: WaMessage) => Promise<{ ref: string }> }} WhatsappProvider */

export const BREVO_WHATSAPP_URL = 'https://api.brevo.com/v3/whatsapp/sendMessage';

/** "+33 6 12 34 56 78" → "33612345678": Brevo's WhatsApp numbers carry the country code, no +. '' when it is not one. */
export function waNumber(v) {
  let d = String(v || '').replace(/[^\d+]/g, '');
  if (d.startsWith('00')) d = '+' + d.slice(2);
  if (/^0[1-9]\d{8}$/.test(d)) d = '+33' + d.slice(1);
  return /^\+\d{8,15}$/.test(d) ? d.slice(1) : '';
}

/**
 * Brevo's params for a template, in order. Brevo does not document their shape for WhatsApp: each value is given under
 * its position ({{params.1}}, {{params.2}}…, as Meta numbers a template's variables) and under its name
 * ({{params.prenom}}), so a template written either way is filled; « Envoyer un test » confirms it on the real one.
 * @param {[string, string][]} params
 */
export function waParams(params) {
  /** @type {Record<string, string>} */
  const out = {};
  params.forEach(([, v], i) => { out[String(i + 1)] = v; });
  for (const [k, v] of params) if (!(k in out)) out[k] = v;
  return out;
}

/** @returns {WhatsappProvider} */
export function brevoWhatsapp({ apiKey, senderNumber, fetchImpl = fetch }) {
  const sender = waNumber(senderNumber);
  return {
    name: 'whatsapp',
    async send(to, msg) {
      const contact = waNumber(to);
      if (!contact) throw new Error('WhatsApp : numéro invalide');
      const body = { senderNumber: sender, contactNumbers: [contact], templateId: msg.templateId, ...(msg.params.length ? { params: waParams(msg.params) } : {}) };
      const res = await fetchImpl(BREVO_WHATSAPP_URL, {
        method: 'POST',
        headers: { 'api-key': apiKey, 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(8000)
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error('WhatsApp : ' + (j.message || j.code || 'erreur ' + res.status));
      return { ref: String(j.messageId || '') };
    }
  };
}
