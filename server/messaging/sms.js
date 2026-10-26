// @ts-check
// SMS delivery. Brevo (French provider, sender name "LArchitecte") or Twilio, chosen by environment.
// Without a provider, or in demo mode, messages are recorded in the outbox and marked "simulé".

/** @typedef {{ name: string, send: (to: string, body: string) => Promise<{ ref: string }> }} SmsProvider */

/** @returns {SmsProvider} */
export function brevoSms({ apiKey, sender, fetchImpl = fetch }) {
  return {
    name: 'brevo',
    async send(to, body) {
      const res = await fetchImpl('https://api.brevo.com/v3/transactionalSMS/sms', {
        method: 'POST',
        headers: { 'api-key': apiKey, 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ sender: sender.slice(0, 11), recipient: to.replace(/^\+/, ''), content: body, type: 'transactional' }),
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
