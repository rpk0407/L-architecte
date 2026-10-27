// @ts-check
// SMS delivery. Brevo (French provider, sender name "LArchitecte") or Twilio, chosen by environment.
// Without a provider, or in demo mode, messages are recorded in the outbox and marked "simulé".
import { createHmac } from 'node:crypto';

/** @typedef {{ marketing?: boolean, webhookUrl?: string }} SendOpts marketing: a promotional text (consent, STOP); webhookUrl: where the provider reports a STOP */
/** @typedef {{ name: string, send: (to: string, body: string, opts?: SendOpts) => Promise<{ ref: string }> }} SmsProvider */

/** The key in the STOP webhook's address, derived from CRON_SECRET: no extra secret to set, and it changes with it. */
export function webhookKey(secret) {
  return secret ? createHmac('sha256', String(secret)).update('lx-sms-webhook').digest('base64url').slice(0, 32) : '';
}
/** https://<site>/api/sms/webhook?k=…, or '' while CRON_SECRET (or the site's address) is missing. */
export function webhookUrl(origin, secret) {
  const k = webhookKey(secret);
  return k && origin ? String(origin).replace(/\/+$/, '') + '/api/sms/webhook?k=' + k : '';
}

// Brevo's per-message events: 'unsubscribe(d)' and 'blacklisted' (msg_status 'bl': the number opted out through
// Brevo's own STOP number) both mean no more offers. Twilio's opt-out keywords arrive as an inbound Body.
const STOP_EVENT = /unsub|opt.?out|stop|blacklist|(?:^|\s)bl(?:\s|$)/i;
const REPLY_EVENT = /repl|inbound|received/i;
// starts with a stop word: "Arrête pas, c'est top" also reads as a STOP. Wrong in the safe direction (one client
// less for the offers, never one more), and the salon can switch them back on from the file if asked
const STOP_WORD = /^\s*(stop\w*|arr[eê]t\w*|d[eé]sabonn\w*|unsubscribe)\b/i;

/** One event of a provider's webhook, in our words. */
function readEvent(b) {
  if (!b || typeof b !== 'object' || Array.isArray(b)) return { stop: false, phones: [] };
  const event = ['msg_status', 'event', 'status'].map((k) => b[k]).filter((v) => typeof v === 'string').join(' ');
  // the text is read only on a reply (or a Twilio inbound, which has no status): a delivery report's 'content'
  // is the salon's own text, which ends with "STOP au 36173"
  const reply = !event || REPLY_EVENT.test(event);
  const text = reply ? ['reply', 'text', 'content', 'message', 'body', 'Body'].map((k) => b[k]).find((v) => typeof v === 'string') || '' : '';
  const phones = ['from', 'sender', 'From', 'to', 'recipient', 'To', 'phone', 'number'].map((k) => b[k]).filter((v) => typeof v === 'string' || typeof v === 'number')
    // Brevo writes numbers without the + (33612345678)
    .map((v) => { const d = String(v).replace(/[^\d+]/g, ''); return /^\d{10,15}$/.test(d) && !d.startsWith('0') ? '+' + d : d; }).filter(Boolean);
  return { stop: STOP_EVENT.test(event) || STOP_WORD.test(text), phones: [...new Set(phones)].slice(0, 4) };
}

/**
 * What a provider's webhook says: for each event, does someone want no more offers, and which numbers may be theirs.
 * Brevo posts JSON (one event, or several in an array); Twilio posts a form (From, Body).
 * Every number in an event is a candidate: the one that matches a client file is the client's.
 * @returns {{ stop: boolean, phones: string[] }[]}
 */
export function parseSmsWebhook(raw, contentType) {
  /** @type {any} */
  let b = {};
  try { b = /json/i.test(contentType || '') || /^\s*[[{]/.test(raw) ? JSON.parse(raw) : Object.fromEntries(new URLSearchParams(raw)); } catch { b = {}; }
  return (Array.isArray(b) ? b.slice(0, 50) : [b]).map(readEvent);
}

/** @returns {SmsProvider} */
export function brevoSms({ apiKey, sender, fetchImpl = fetch }) {
  return {
    name: 'brevo',
    async send(to, body, opts = {}) {
      // Brevo's 'marketing' type follows the French rules for promotional texts; everything else is a service message.
      // webUrl: Brevo calls it for each event of this text (delivered, replied, unsubscribed)
      const msg = { sender: sender.slice(0, 11), recipient: to.replace(/^\+/, ''), content: body, type: opts.marketing ? 'marketing' : 'transactional', ...(opts.webhookUrl ? { webUrl: opts.webhookUrl } : {}) };
      const res = await fetchImpl('https://api.brevo.com/v3/transactionalSMS/sms', {
        method: 'POST',
        headers: { 'api-key': apiKey, 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify(msg),
        signal: AbortSignal.timeout(8000)
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.message || 'Brevo ' + res.status);
      return { ref: String(j.messageId || j.reference || '') };
    }
  };
}

/** @returns {SmsProvider} */
export function twilioSms({ sid, token, from, fetchImpl = fetch }) {
  return {
    name: 'twilio',
    async send(to, body) {
      const res = await fetchImpl(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/Messages.json`, {
        method: 'POST',
        headers: { authorization: 'Basic ' + Buffer.from(sid + ':' + token).toString('base64'), 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(from.startsWith('MG') ? { To: to, MessagingServiceSid: from, Body: body } : { To: to, From: from, Body: body }).toString(),
        signal: AbortSignal.timeout(8000)
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.message || 'Twilio ' + res.status);
      return { ref: String(j.sid || '') };
    }
  };
}

/** Messages that never leave: demo and setups without a provider. */
export function outboxOnly() { return null; }
