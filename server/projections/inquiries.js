// @ts-check
// Les demandes (contact and training requests from /contact and /formations), as the projection folds them. Registered in
// core/extensions.js; the commands are in commands/inquiries.js. The person's first name, number, e-mail and words come
// from the event's pii only, so an erasure (client.erased with the inquiry's id in drop, or the client file it was matched
// to) takes them out of the journal; inquiry.erased and client.erased blank this copy in memory.
// No import of the engine or the state here (see core/extensions.js).

/** The words the Comptoir uses for each kind; 'sms': a client's answer to the salon's phone (MSG-02, commands/sms-inbound.js). */
export const KIND_FR = { contact: 'contact', formation: 'formation', sms: 'réponse SMS' };

/** @param {any} s @param {string} id */
const get = (s, id) => (s.inquiries ? s.inquiries.get(id) : null);
/** Out of memory, as out of the journal: an erased request is handled, nothing is left to answer. */
const blank = (q, at) => Object.assign(q, { first: '', phone: '', email: '', message: '', erased: true, status: 'handled', handledAt: q.handledAt || at });

/** @type {import('../core/extensions.js').Extension} */
export const inquiriesExtension = {
  init(s) { s.inquiries = new Map(); },
  on: {
    'inquiry.received': (s, e, d, p) => {
      s.inquiries.set(d.id, {
        id: d.id, kind: d.kind, module: d.module || '', cid: d.cid || null, at: e.at,
        first: p.first || '', phone: p.phone || '', email: p.email || '', message: p.message || '',
        status: 'new', handledAt: 0, handledBy: null, replies: [], erased: false,
        // FID-01: an SMS answer names the text it answers (template and message id: nothing personal)
        re: d.re && d.re.template ? { template: String(d.re.template), msgId: String(d.re.msgId || '') } : null, auto: false
      });
    },
    // auto: filed by itself, a mere « ok » or « merci » to a review request, a reminder or a receipt (commands/sms-inbound.js)
    'inquiry.handled': (s, e, d) => {
      const q = get(s, d.id);
      if (!q) return;
      if (d.undo) Object.assign(q, { status: 'new', handledAt: 0, handledBy: null, auto: false });
      else Object.assign(q, { status: 'handled', handledAt: e.at, handledBy: e.actor.id, auto: !!d.auto });
    },
    // an SMS answer: the text itself is in its message.queued pii; answering handles the request
    'inquiry.replied': (s, e, d) => {
      const q = get(s, d.id);
      if (!q) return;
      q.replies.push({ at: e.at, by: e.actor.id, msgId: d.msgId || null });
      if (q.status === 'new') Object.assign(q, { status: 'handled', handledAt: e.at, handledBy: e.actor.id });
    },
    'inquiry.erased': (s, e, d) => {
      const q = get(s, d.id);
      if (q) blank(q, e.at);
    },
    // the client file a request was matched to, erased (state.js calls this after its own case): the request goes with it,
    // through a merge too; and a request named in drop (Effacer, a retention purge)
    'client.erased': (s, e, d) => {
      if (!s.inquiries) return;
      const ids = new Set(d.ids || [d.id]);
      const drop = new Set(d.drop || []);
      for (const q of s.inquiries.values()) if (!q.erased && (drop.has(q.id) || fileIn(s, q, ids))) blank(q, e.at);
    }
  },
  feed: ['inquiry.received'],
  // 'Nouvelle demande : formation · Karim', for whoever reads the inbox (Relances › Demandes)
  item(r, f) {
    if (!r.caps.has('marketing')) return null;
    const q = get(r.s, f.data && f.data.id);
    // an acknowledgement filed by itself is no news
    if (!q || q.auto) return null;
    const out = gone(r.s, q);
    const first = out ? '' : q.first;
    const mod = q.module ? moduleTitle(r.s, q.module) : '';
    const sub = mod || (out || !q.message ? '' : q.message.replace(/\s+/g, ' ').slice(0, 80));
    return { v: f.v, at: f.at, by: f.actor.t, kind: 'inquiry', title: 'Nouvelle demande : ' + (KIND_FR[q.kind] || q.kind) + (first ? ' · ' + first : ''), sub: sub || 'À lire dans Relances › Demandes', inquiryId: q.id };
  }
};

/** A request matched to a client file that was erased since: its words are gone from the journal, and hidden here too. */
export function clientErased(s, q) {
  let c = q.cid ? s.clients.get(q.cid) : null;
  while (c && c.mergedInto) c = s.clients.get(c.mergedInto);
  return !!(c && c.erased);
}
/** Erased itself or with its client file: nothing to show, answer or reopen (the reads check it even if memory lags). */
export const gone = (s, q) => !!q.erased || clientErased(s, q);
/** The request's file, or one it was merged into, among the ids an erasure names. */
function fileIn(s, q, ids) {
  let id = q.cid;
  for (let n = 0; id && n < 20; n++) { if (ids.has(id)) return true; const c = s.clients.get(id); id = c && c.mergedInto; }
  return false;
}

/** The module's title as the settings say it now, or its code when it was removed since. */
export function moduleTitle(s, id) {
  const m = ((s.settings.trainings && s.settings.trainings.modules) || []).find((x) => x.id === id);
  return m ? m.title : id;
}
