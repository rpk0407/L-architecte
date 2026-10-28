// @ts-check
// SMS delivery. Brevo (French provider, sender name "LArchitecte"), Twilio, or the salon's own Android phone through
// SMS Gateway for Android (sms-gate.app: texts leave from the salon's number, at the cost of its plan), chosen by
// environment. Without a provider, or in demo mode, messages are recorded in the outbox and marked "simulé".
import { createHmac } from 'node:crypto';

/** @typedef {{ marketing?: boolean, webhookUrl?: string }} SendOpts marketing: a promotional text (consent, STOP); webhookUrl: where the provider reports a STOP */
/** @typedef {{ name: string, send: (to: string, body: string, opts?: SendOpts) => Promise<{ ref: string }>, paceMs?: number, perRun?: number }} SmsProvider
 *  paceMs: the least time between two texts of one dispatch; perRun: the most texts one dispatch hands it */

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

/** A number as a webhook writes it, in E.164 when it can be read as one. */
function phoneOf(v) {
  const d = String(v).replace(/[^\d+]/g, '');
  // Brevo writes numbers without the + (33612345678)
  return /^\d{10,15}$/.test(d) && !d.startsWith('0') ? '+' + d : d;
}

/**
 * The salon phone's webhook (SMS Gateway for Android): { event: 'sms:received', id, payload: { messageId, message,
 * sender (phoneNumber before v1.30), recipient } }, and 'sms:delivered' / 'sms:failed' for the texts it sent.
 * A reply that is not a STOP is handed on as `reply`, so the owner reads it; a report as `report`, for the outbox.
 * @returns {WebhookEvent}
 */
function readGateway(b) {
  const p = b.payload;
  const ev = String(b.event);
  if (ev === 'sms:received') {
    const text = typeof p.message === 'string' ? p.message : '';
    const from = [p.sender, p.phoneNumber].find((v) => typeof v === 'string' && v) || '';
    const phones = from ? [phoneOf(from)].filter(Boolean) : [];
    const stop = STOP_WORD.test(text);
    // the event's own id: the same delivery posted twice is recorded once
    const ref = String(b.id || p.messageId || '').replace(/[^\w-]/g, '').slice(0, 40);
    return { stop, phones, ...(!stop && text.trim() && phones.length ? { reply: { text, phone: phones[0], ref } } : {}) };
  }
  if ((ev === 'sms:failed' || ev === 'sms:delivered') && p.messageId) {
    const to = [p.recipient, p.phoneNumber].find((v) => typeof v === 'string' && v);
    return { stop: false, phones: to ? [phoneOf(to)] : [], report: { ref: String(p.messageId).slice(0, 80), status: ev === 'sms:failed' ? 'failed' : 'delivered', error: String(p.reason || '').slice(0, 120) } };
  }
  // sms:sent, system:ping, mms…: nothing to do
  return { stop: false, phones: [] };
}
const isGateway = (b) => typeof b.event === 'string' && /^(sms|mms|system|app):/.test(b.event) && !!b.payload && typeof b.payload === 'object';

/**
 * @typedef {{ stop: boolean, phones: string[], reply?: { text: string, phone: string, ref: string }, report?: { ref: string, status: 'failed'|'delivered', error: string } }} WebhookEvent
 */

/** One event of a provider's webhook, in our words. @returns {WebhookEvent} */
function readEvent(b) {
  if (!b || typeof b !== 'object' || Array.isArray(b)) return { stop: false, phones: [] };
  if (isGateway(b)) return readGateway(b);
  const event = ['msg_status', 'event', 'status'].map((k) => b[k]).filter((v) => typeof v === 'string').join(' ');
  // the text is read only on a reply (or a Twilio inbound, which has no status): a delivery report's 'content'
  // is the salon's own text, which ends with "STOP au 36173"
  const reply = !event || REPLY_EVENT.test(event);
  const text = reply ? ['reply', 'text', 'content', 'message', 'body', 'Body'].map((k) => b[k]).find((v) => typeof v === 'string') || '' : '';
  const phones = ['from', 'sender', 'From', 'to', 'recipient', 'To', 'phone', 'number'].map((k) => b[k]).filter((v) => typeof v === 'string' || typeof v === 'number')
    .map(phoneOf).filter(Boolean);
  return { stop: STOP_EVENT.test(event) || STOP_WORD.test(text), phones: [...new Set(phones)].slice(0, 4) };
}

/**
 * What a provider's webhook says: for each event, does someone want no more offers, and which numbers may be theirs.
 * Brevo posts JSON (one event, or several in an array); Twilio posts a form (From, Body); the salon's phone posts JSON
 * with the text in `payload` (its replies and delivery reports come too, see readGateway).
 * Every number in an event is a candidate: the one that matches a client file is the client's.
 * @returns {WebhookEvent[]}
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

export const GATEWAY_URL = 'https://api.sms-gate.app/3rdparty/v1';
/** A phone and its operator throttle bulk sending: one text every 3 s, five per dispatch (the tick runs once a minute). */
export const GATEWAY_PACE_MS = 3000;
export const GATEWAY_PER_RUN = 5;
/**
 * The opt-out mention of a promotional text from the salon's own number: no short STOP number there, the client
 * answers the salon itself and the webhook reads it (readGateway).
 */
export const GATEWAY_STOP = 'STOP : réponds STOP';

/**
 * A promotional text queued with Brevo's mention (settings.messages.stopSuffix, "STOP au 36173") leaving from the
 * salon's phone: that number would not reach the salon, so the mention becomes GATEWAY_STOP.
 * @param {string} body @param {string} suffix
 */
export function gatewayStop(body, suffix) {
  const stop = String(suffix || '').trim();
  const i = stop ? String(body).toLowerCase().lastIndexOf(stop.toLowerCase()) : -1;
  const out = i >= 0 ? (String(body).slice(0, i) + GATEWAY_STOP + String(body).slice(i + stop.length)).replace(/\s+$/, '') : String(body);
  return out.toLowerCase().includes(GATEWAY_STOP.toLowerCase()) ? out : out + ' ' + GATEWAY_STOP;
}

/**
 * SMS Gateway for Android, cloud mode (docs.sms-gate.app): the app on the salon's phone takes the text from its server
 * and sends it with the phone's SIM. Basic auth with the username and password the app shows on its Home tab.
 * @returns {SmsProvider}
 */
export function gatewaySms({ url = GATEWAY_URL, username, password, fetchImpl = fetch }) {
  const base = String(url || GATEWAY_URL).replace(/\/+$/, '');
  return {
    name: 'gateway', paceMs: GATEWAY_PACE_MS, perRun: GATEWAY_PER_RUN,
    async send(to, body) {
      const res = await fetchImpl(base + '/messages', {
        method: 'POST',
        headers: { authorization: 'Basic ' + Buffer.from(username + ':' + password).toString('base64'), 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ textMessage: { text: body }, phoneNumbers: [to] }),
        signal: AbortSignal.timeout(8000)
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        // the owner reads these in the outbox: say what to check, in words
        const why = res.status === 401 ? 'identifiants refusés (SMSGATE_USERNAME, SMSGATE_PASSWORD)' : res.status === 429 ? 'trop de SMS d’un coup' : j.message || j.error || 'erreur ' + res.status;
        // the status says the gateway answered and refused it: the scheduler may then send it by Brevo without a double
        throw Object.assign(new Error('Téléphone du salon : ' + why), { status: res.status });
      }
      // 202 Accepted: the phone sends it when it picks it up; sms:delivered / sms:failed follow on the webhook
      return { ref: String(j.id || '') };
    }
  };
}

/** Messages that never leave: demo and setups without a provider. */
export function outboxOnly() { return null; }
