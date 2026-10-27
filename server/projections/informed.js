// @ts-check
// FID-01 · Clients imported from WordPress were never told about the new site: the salon may not send them a review
// request nor an offer before they are. They are told by the line « Nouveau site du salon. Tes données : …/confidentialite »
// added to the first service text they get (domain/messages.js); `client.informed` is written when that text has left
// (commands/messages.js, messageResult), and undone by `client.uninformed` when the salon's phone reports later that this
// very text failed after all (commands/sms-inbound.js, smsReport). A consent the client gave or changed himself since
// (the site's box, /moi, a STOP) replaces marketingSrc 'wordpress', so such a file counts as told too; a switch the
// owner turned at the counter (marketingSrc 'salon') told the client nothing, so it does not.
// The event names the file and the message only: no personal data, and an erasure has nothing to blank here.
// Registered in core/extensions.js. No import of the engine or the state here.

/** @type {import('../core/extensions.js').Extension} */
export const informedExtension = {
  init(s) { s.informed = new Map(); s.informedBy = new Map(); },
  on: {
    // the first telling counts; a replayed journal keeps it
    'client.informed': (s, e, d) => { if (d && d.cid && !s.informed.has(d.cid)) { s.informed.set(d.cid, e.at); s.informedBy.set(d.cid, d.msgId || ''); } },
    // only the text that told it can take it back: a later telling stays
    'client.uninformed': (s, e, d) => { if (d && d.cid && d.msgId && s.informedBy.get(d.cid) === d.msgId) { s.informed.delete(d.cid); s.informedBy.delete(d.cid); } }
  }
};

/** A file brought over from WordPress whose consent the client has not touched since (WP-08 writes marketingSrc
 *  'wordpress'; the earlier import wrote none; the owner's switch at the counter writes 'salon' and tells him nothing). */
export const importedFile = (c) => !!c && (c.marketingSrc === 'wordpress' || (c.source === 'wordpress' && (!c.marketingSrc || c.marketingSrc === 'salon')));

/** The files a text told about the new site (several when files were merged since): what a late failure takes back. */
export const toldBy = (s, msgId) => (s.informedBy ? [...s.informedBy].filter(([, id]) => id === msgId).map(([cid]) => cid) : []);

/** When this file was told about the new site: the text that told it, or the consent the client changed since; 0 if never. */
export function informedAt(s, cid) {
  const c = cid ? s.clients.get(cid) : null;
  if (!c) return 0;
  const at = s.informed ? s.informed.get(cid) : 0;
  if (at) return at;
  return importedFile(c) ? 0 : c.marketingAt || c.createdAt || 1;
}

/** No relation or marketing text to this file yet: imported from WordPress and never told. */
export const neverInformed = (s, c) => importedFile(c) && !informedAt(s, c.id);
