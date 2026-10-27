// @ts-check
// AC-02 · What a signed-in client changes of himself (/moi › Profil) and the salon's invite to the space. Every /api/me
// route is behind requireMe (401 without the client's cookie: a staff session alone opens nothing) and takes its file from
// the session, never from the body. The demo's persona writes nothing (isPersona): « Démo : rien n’est changé ». The copy of
// a client's data goes by e-mail to the address the salon holds, never as a download from the page: whoever holds an open
// phone cannot walk away with the file, and the person it belongs to is the one who gets it.
import { HttpError, guard } from './kit.js';
import { signLink } from '../auth/session.js';
import { maskEmail, maskPhone, isEmail } from '../lib/util.js';
import { requireMe, runAs, isPersona } from './me-kit.js';
import { dispatchNow } from './scheduler.js';
import { clientExport } from './routes-staff.js';
import { ACC_TTL_MS } from './routes-me.js';
import { rootFile } from '../commands/accounts.js';
import { updateOwnProfile, setOwnConsent, setOwnPrefs, requestErasure, requestExport, sendSpaceInvite, SALON_ONLY } from '../commands/me.js';

const HOUR = 3600000;
export const DEMO_MESSAGE = 'Démo : rien n’est changé';
const ERASE_MESSAGE = 'Demande envoyée. Le salon efface ta fiche sous un mois.';
const iso = (ms) => (ms ? new Date(ms).toISOString() : null);
/** A mail's attachment stays under what the e-mail provider takes (4 MB with the encoding). */
const MAX_EXPORT = 2500000;

/** Writes a client can make an hour: far above any person's, far below a loop. */
const writeGuard = (me) => guard('mew|' + me.cid, 60, HOUR, 'Trop de modifications d’un coup. Réessaie dans un moment.');

/**
 * The client's own copy: the words of the salon's export (routes-staff.js clientExport) and what the space adds.
 * @param {any} r @param {any} me
 */
function exportOf(r, me) {
  const s = r.s;
  const pref = me.account.prefs && me.account.prefs.staffId ? s.staff.get(me.account.prefs.staffId) : null;
  const body = { ...clientExport(s, me.c, r.now), espace: { ouvertLe: iso(me.account.since), derniereConnexion: iso(me.account.lastAt), connexions: me.account.count || 0, barbierPrefere: pref ? pref.name : '' } };
  let json = JSON.stringify(body, null, 2);
  // an enormous file (years of texts): the texts' words go first, the list of them stays
  if (json.length > MAX_EXPORT) json = JSON.stringify({ ...body, sms: body.sms.map(({ texte, ...rest }) => rest) }, null, 2);
  return json.length > MAX_EXPORT ? '' : json;
}

/** The text or mail leaves now, not at the next tick (a person waits for it); if the provider fails, the tick retries. */
async function leaveNow(r, id) {
  if (!id) return;
  try { await dispatchNow(r.rt, [id]); } catch (e) { console.warn('[lx] moi', e && /** @type {any} */ (e).message); }
}

export function moiRoutes(app) {
  // what the Profil card needs besides /api/me/home: the e-mail as the salon holds it (masked), and whether the space may
  // ask for the file (a space opened on a file that may have changed hands sends the person to the salon)
  app.get('/api/me/profile', (r) => {
    const me = requireMe(r);
    return { email: me.c.email && isEmail(me.c.email) ? maskEmail(me.c.email) : '', phone: maskPhone(me.c.phone), canAsk: !me.account.fenced && !!me.account.named, eraseAt: me.account.eraseAt || 0, demo: isPersona(me) };
  });

  app.patch('/api/me/profile', async (r) => {
    const me = requireMe(r);
    if (isPersona(me)) return { ok: true, demo: true, message: DEMO_MESSAGE };
    writeGuard(me);
    // only these three keys travel: a phone or an e-mail in the body is dropped here, and again by the command's schema
    const b = r.body || {};
    return runAs(r, me)(updateOwnProfile, { first: b.first, last: b.last, birthday: b.birthday });
  });

  app.patch('/api/me/consent', async (r) => {
    const me = requireMe(r);
    if (isPersona(me)) return { ok: true, demo: true, message: DEMO_MESSAGE };
    writeGuard(me);
    const b = r.body || {};
    return runAs(r, me)(setOwnConsent, { sms: b.sms, marketing: b.marketing });
  });

  app.patch('/api/me/prefs', async (r) => {
    const me = requireMe(r);
    if (isPersona(me)) return { ok: true, demo: true, message: DEMO_MESSAGE };
    writeGuard(me);
    const b = r.body || {};
    return runAs(r, me)(setOwnPrefs, { staffId: b.staffId === undefined ? undefined : b.staffId });
  });

  app.post('/api/me/export', async (r) => {
    const me = requireMe(r);
    if (me.account.fenced || !me.account.named) throw new HttpError(403, 'forbidden', SALON_ONLY);
    if (isPersona(me)) return { ok: true, demo: true, message: DEMO_MESSAGE };
    // 5 an hour per client, wherever he is signed in
    guard('mexp|' + me.cid, 5, HOUR, 'Tu as déjà demandé tes données plusieurs fois. Réessaie dans une heure.');
    const res = await runAs(r, me)(requestExport, { json: exportOf(r, me) });
    if (res.limit) throw new HttpError(429, 'slow_down', 'Tes données sont déjà parties plusieurs fois aujourd’hui. Regarde tes e-mails, ou réessaie demain.');
    if (!res.sent) return { ok: true, sent: false, message: 'Demande-le au salon' };
    await leaveNow(r, res.id);
    return { ok: true, sent: true, message: 'Envoyé à ' + maskEmail(me.c.email) };
  });

  app.post('/api/me/erase-request', async (r) => {
    const me = requireMe(r);
    if (me.account.fenced || !me.account.named) throw new HttpError(403, 'forbidden', SALON_ONLY);
    if (isPersona(me)) return { ok: true, demo: true, message: DEMO_MESSAGE };
    writeGuard(me);
    const res = await runAs(r, me)(requestErasure, {});
    return { ok: true, already: !!res.already, message: res.already ? 'Ta demande est déjà chez le salon.' : ERASE_MESSAGE };
  });

  // the salon texts a client the way into his space: a signed link good 48 h that proves the number it was sent to
  app.post('/api/v1/clients/:id/account/invite', async (r) => {
    const c = rootFile(r.s, r.params.id);
    if (!c) throw new HttpError(404, 'not_found', 'Client introuvable.');
    const token = signLink(r.rt.secret, 'acc', c.id + '~' + (r.now + ACC_TTL_MS).toString(36));
    const res = await r.run(sendSpaceInvite, { cid: c.id, link: r.origin + '/moi?garder=' + encodeURIComponent(token) });
    if (res.limit) throw new HttpError(429, 'slow_down', 'Déjà 3 liens envoyés aujourd’hui à ce client.');
    await leaveNow(r, res.id);
    return { ok: true, sent: !!res.sent };
  }, { cap: 'client.edit' });
}
