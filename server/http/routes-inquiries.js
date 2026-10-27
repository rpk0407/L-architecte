// @ts-check
// Les demandes and les formations over HTTP. The site's two forms (public/contact.html, public/formations.html) post here
// without an account; the Comptoir reads the inbox in Relances › Demandes. /formations shows the fixed training content
// (settings/trainings.js: its defaults are the old WordPress page's four modules).
import { failureGuard, HttpError } from './kit.js';
import { maybeTick } from './scheduler.js';
import { fmtPhone, maskPhone, maskEmail } from '../lib/util.js';
import { receiveInquiry, markInquiryHandled, replyInquiry, eraseInquiry } from '../commands/inquiries.js';
import { KIND_FR, gone as isGone, moduleTitle } from '../projections/inquiries.js';
import { publicTrainings } from '../settings/trainings.js';
import { waitUntil } from '@vercel/functions';

const HOUR_MS = 3600000;
export const INQUIRIES_PER_HOUR = 5;
// refused ones (a field to fix) count apart and more loosely: a person correcting the form is not locked out for an hour
const REFUSED_PER_HOUR = 20;
const SLOW = 'Plusieurs messages sont déjà partis de cet appareil. Réessaie dans une heure, ou appelle le salon.';
// the actor is chained and can never be erased: no name and no number in it (the person's details travel as pii)
const CLIENT = (r) => ({ actor: /** @type {const} */ ({ t: 'client', id: 'web', n: '' }), caps: new Set(), meta: r.meta });
/** Visitor traffic carries the background work too: the owner's e-mail leaves without waiting for the Comptoir. */
function background(r, force = false) { const t = maybeTick(r.rt, r.meta, { force }); if (t) waitUntil(t); }

/** One request as the inbox shows it: full number and address for those who may see them, the answers with their state. */
function inquiryView(r, q) {
  const s = r.s;
  const gone = isGone(s, q);
  const full = r.caps.has('client.contact');
  const who = (id) => (id && s.staff.get(id) ? s.staff.get(id).name : '');
  return {
    id: q.id, kind: q.kind, kindLabel: KIND_FR[q.kind] || q.kind, module: q.module, moduleTitle: q.module ? moduleTitle(s, q.module) : '', at: q.at,
    status: gone ? 'handled' : q.status, handledAt: q.handledAt || null, handledBy: who(q.handledBy), erased: gone, cid: gone ? null : q.cid,
    first: gone ? '' : q.first, message: gone ? '' : q.message, hasPhone: !gone && !!q.phone,
    phone: gone || !q.phone ? '' : full ? fmtPhone(q.phone) : maskPhone(q.phone),
    email: gone || !q.email ? '' : full ? q.email : maskEmail(q.email, { domain: true }),
    replies: q.replies.map((x) => { const m = x.msgId ? s.messages.get(x.msgId) : null; return { at: x.at, by: who(x.by), text: gone || !m ? '' : m.body, status: m ? m.status : 'skipped' }; })
  };
}

/** @param {any} app */
export function inquiryRoutes(app) {
  /* the site: one form, two pages */
  app.post('/api/public/inquiries', async (r) => {
    // failureGuard counts what we tell it to: here the requests sent, then the ones refused
    const sent = failureGuard('inq|' + r.ip, INQUIRIES_PER_HOUR, HOUR_MS, SLOW);
    const refused = failureGuard('inq-x|' + r.ip, REFUSED_PER_HOUR, HOUR_MS, SLOW);
    const b = r.body && typeof r.body === 'object' ? r.body : {};
    // the field a person never sees: a robot that fills it is told it worked, and nothing is kept (it counts as sent)
    if (String(b.website ?? '').trim()) { sent.fail(); return { ok: true }; }
    let out;
    try { out = await r.rt.engine.run(receiveInquiry, { kind: b.kind, first: b.first, phone: b.phone, email: b.email, module: b.module, message: b.message }, CLIENT(r)); }
    catch (err) { if (err && err.status === 400) refused.fail(); throw err; }
    sent.fail();
    background(r);
    return { ok: true, id: out.id };
  });
  app.get('/api/public/trainings', (r) => publicTrainings(r.s.settings, r.local.day));

  /* Relances › Demandes */
  app.get('/api/v1/inquiries', (r) => {
    const all = [...r.s.inquiries.values()].sort((a, b) => b.at - a.at);
    return {
      items: all.slice(0, 200).map((q) => inquiryView(r, q)), unread: all.filter((q) => q.status === 'new' && !isGone(r.s, q)).length, total: all.length,
      canErase: r.caps.has('client.erase'), sms: !!r.rt.sms, mode: r.s.mode
    };
  }, { cap: 'marketing' });
  app.post('/api/v1/inquiries/:id/handled', (r) => r.run(markInquiryHandled, { id: r.params.id, undo: r.body && r.body.undo === true ? true : undefined }), { cap: 'marketing' });
  app.post('/api/v1/inquiries/:id/reply', async (r) => {
    // in production without a provider the text would wait in the outbox and expire, while the request reads as answered
    if (r.s.mode === 'production' && !r.rt.sms) throw new HttpError(409, 'no_sms', 'Aucun fournisseur SMS n’est branché : appelle ou écris par e-mail, puis marque la demande traitée.');
    const out = await r.run(replyInquiry, { id: r.params.id, text: r.body && r.body.text });
    // asked for by the person: the answer leaves now rather than at the next tick
    background(r, true);
    return out;
  }, { cap: 'marketing' });
  app.post('/api/v1/inquiries/:id/erase', (r) => r.run(eraseInquiry, { id: r.params.id }), { cap: 'client.erase' });
}
