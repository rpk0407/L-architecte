// @ts-check
// E-mail delivery through Brevo's transactional API (the same account as the SMS): client confirmations with the
// calendar file, cancellations, the owner's alerts and summaries. Without BREVO_API_KEY and EMAIL_FROM, or in demo
// mode, there is no provider: mail waits in the outbox (production) or is marked "simulé" (demo), like SMS.

/** @typedef {{ name: string, type: string, content: string }} MailAttachment content is the file's text (an .ics) */
/** @typedef {{ to: string, subject: string, text: string, html?: string, cta?: { label: string, url: string }, links?: string[], attachments?: MailAttachment[], fromName?: string, tag?: string }} Mail */
/** @typedef {{ name: string, send: (mail: Mail) => Promise<{ ref: string }> }} EmailProvider */

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
/** Only the addresses the server wrote (links): one typed by a client, in a name or a reason, stays plain text. */
const linkify = (s, links) => s.replace(/https?:\/\/[^\s<]+[^\s<.,;:!?)]/g, (u) => (links.has(u) ? '<a href="' + u + '" style="color:#8a5a2b">' + u + '</a>' : u));

/**
 * The HTML version, built from the text one when the message carries none: the text stays the reference
 * (what the outbox shows, what a text-only client reads), the HTML only lays it out, with the button.
 * @param {string} text @param {{ cta?: { label: string, url: string }, links?: string[], brand?: string }} [o]
 */
export function mailHtml(text, o = {}) {
  const cta = o.cta && /^https:\/\//.test(o.cta.url) ? o.cta : null;
  // compared once escaped, as they then stand in the text
  const links = new Set((o.links || []).filter((u) => /^https:\/\//.test(u)).map(esc));
  // the button replaces the line that spells its address out
  const lines = String(text).split('\n').filter((l) => !(cta && l.includes(cta.url)));
  const paras = lines.join('\n').split(/\n{2,}/).map((p) => p.trim()).filter(Boolean)
    .map((p) => '<p style="margin:0 0 14px">' + linkify(esc(p), links).replace(/\n/g, '<br>') + '</p>');
  const button = cta ? '<p style="margin:22px 0 8px"><a href="' + esc(cta.url) + '" style="display:inline-block;background:#1c1a17;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:10px;font-weight:600">' + esc(cta.label) + '</a></p>' : '';
  const brand = o.brand ? '<p style="margin:0 0 18px;font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#8a7f72">' + esc(o.brand) + '</p>' : '';
  return '<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head>'
    + '<body style="margin:0;background:#f4f1ec"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px">'
    + '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:14px"><tr><td style="padding:28px 26px 18px;font:15px/1.55 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1c1a17">'
    + brand + paras.join('') + button + '</td></tr></table></td></tr></table></body></html>';
}

/** "Barber L'Architecte <rdv@barberlarchitecte.com>" or a bare address → { email, name }. */
export function parseFrom(v) {
  const m = /^\s*(?:"?([^"<]*?)"?\s*)?<([^<>\s]+@[^<>\s]+\.[^<>\s]+)>\s*$/.exec(String(v || ''));
  if (m) return { email: m[2].toLowerCase(), name: (m[1] || '').trim() };
  const bare = String(v || '').trim().toLowerCase();
  return /^[^@\s]{1,64}@[^@\s]{1,190}\.[^@\s]{2,}$/.test(bare) ? { email: bare, name: '' } : null;
}

/** @returns {EmailProvider} */
export function brevoEmail({ apiKey, from, fromName = '', replyTo = '', fetchImpl = fetch }) {
  return {
    name: 'brevo',
    async send(mail) {
      const name = fromName || mail.fromName || '';
      const payload = {
        sender: { email: from, ...(name ? { name } : {}) },
        to: [{ email: mail.to }],
        ...(replyTo ? { replyTo: { email: replyTo } } : {}),
        subject: mail.subject,
        textContent: mail.text,
        htmlContent: mail.html || mailHtml(mail.text, { cta: mail.cta, links: mail.links, brand: name }),
        // Brevo takes the files in base64 and reads their type from the name (.ics → text/calendar)
        ...(mail.attachments && mail.attachments.length ? { attachment: mail.attachments.map((x) => ({ name: x.name, content: Buffer.from(x.content, 'utf8').toString('base64') })) } : {}),
        ...(mail.tag ? { tags: [mail.tag] } : {})
      };
      const res = await fetchImpl('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: { 'api-key': apiKey, 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(8000)
      });
      const j = await res.json().catch(() => ({}));
      // the owner reads it in the outbox: the usual misconfigurations in French, else Brevo's own words
      if (res.status === 401) throw new Error('Clé Brevo refusée : vérifie BREVO_API_KEY');
      if (!res.ok) throw new Error(/sender/i.test(j.message || '') ? 'Expéditeur refusé par Brevo : valide EMAIL_FROM dans Brevo (' + j.message + ')' : 'Brevo : ' + (j.message || 'erreur ' + res.status));
      return { ref: String(j.messageId || '') };
    }
  };
}
