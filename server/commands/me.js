// @ts-check
// AC-02 · What a signed-in client changes of himself (/moi › Profil), and what the salon does with an account: his name and
// birthday, his two consents, his favourite barber, a copy of his data by e-mail, a request to erase his file, and the
// salon's invite to open the space. The actor is the chained client actor (commands/accounts.js); the file is ALWAYS
// ctx.meta.me.cid (http/me-kit.js runAs), never a value of the body. Each write emits one event only when something
// changes, so a retried tap writes nothing. Personal data stays in pii: events name the file (cid), never a name, number
// or address. Erasure itself stays the owner's (Clients › fiche › Effacer, with its guard on what is still open).
import { fail } from '../core/engine.js';
import { str, bool, opt, nullable, obj, parse } from '../lib/validate.js';
import { isEmail } from '../lib/util.js';
import { queueMessage, messageId } from '../domain/messages.js';
import { ownerEmail } from '../domain/mails.js';
import { linkAllowed } from '../domain/linkcap.js';
import { accountOf } from '../projections/accounts.js';
import { accountsOn } from '../settings/accounts.js';
import { clientParts, fileIds } from './clients.js';
import { getClient } from './common.js';
import { rootFile } from './accounts.js';

const CLOSED = 'Ton espace s’est fermé. Reconnecte-toi.';
export const SALON_ONLY = 'Pour ça, passe au salon.';
/** Copies of a client's data sent in one day (the route also limits them per hour). */
export const EXPORTS_PER_DAY = 5;

/**
 * The client's own file and account, from the session the route vouches for. `strict`: only a space opened on the right
 * person's file (not fenced, first name given at the opening) may read or erase it: otherwise 403 « Pour ça, passe au salon. »
 * @param {any} s @param {any} ctx @param {boolean} [strict]
 * @returns {{ c: any, account: any }}
 */
function own(s, ctx, strict = false) {
  const cid = ctx.actor.t === 'client' && ctx.meta && ctx.meta.me && ctx.meta.me.cid;
  const c = cid ? rootFile(s, cid) : null;
  const account = c ? accountOf(s, fileIds(s, c)) : null;
  if (!c || c.erased || !account) fail(401, 'signed_out', CLOSED);
  if (strict && (account.fenced || !account.named)) fail(403, 'forbidden', SALON_ONLY);
  return { c, account };
}

// a real day and month, « jj-mm » like the file keeps it (the salon's own form is looser: this one is the client's)
const BIRTHDAY = /^((0[1-9]|[12]\d|3[01])-(0[1-9]|1[0-2]))?$/;
const profileSchema = obj({ first: opt(str({ min: 1, max: 40 })), last: opt(str({ max: 40 })), birthday: opt(str({ max: 5, pattern: BIRTHDAY })) });

/**
 * « Mes infos »: first name, last name, birthday. Phone and e-mail are not here (« Changer de numéro ou d’e-mail ? Dis-le
 * au salon. »): any other key is dropped. A space opened on a file that may have changed hands (fenced, or the first name
 * not given) writes nothing to it.
 */
export const updateOwnProfile = {
  run(s, input, ctx) {
    const { c } = own(s, ctx, true);
    const { pii } = clientParts(parse(profileSchema, input || {}));
    /** @type {Record<string, string>} */
    const changed = {};
    for (const [k, v] of Object.entries(pii)) if (v !== (c[k] || '')) changed[k] = v;
    if (!Object.keys(changed).length) return { ok: true, changed: false };
    ctx.emit('client.updated', { id: c.id, cid: c.id, patch: {}, fields: Object.keys(changed) }, changed);
    return { ok: true, changed: true };
  }
};

const consentSchema = obj({ sms: opt(bool()), marketing: opt(bool()) });
/**
 * « Messages »: reminders by SMS (sms) and the offers (marketing). A change of the offers keeps its proof, as the site's box
 * does: when, and from where (marketingSrc 'espace'; a client brought from WordPress who answers here counts as told, as
 * projections/informed.js says). Reminders already read c.sms before anything is queued (commands/steps/system.js).
 */
export const setOwnConsent = {
  run(s, input, ctx) {
    const { c } = own(s, ctx);
    const x = parse(consentSchema, input || {});
    /** @type {Record<string, any>} */
    const patch = {};
    if (x.sms !== undefined && x.sms !== (c.sms !== false)) patch.sms = x.sms;
    if (x.marketing !== undefined && x.marketing !== !!c.marketing) Object.assign(patch, { marketing: x.marketing, marketingSrc: 'espace', marketingAt: ctx.now });
    if (!Object.keys(patch).length) return { ok: true, changed: false };
    ctx.emit('client.updated', { id: c.id, cid: c.id, patch, fields: [] });
    return { ok: true, changed: true };
  }
};

const prefsSchema = obj({ staffId: nullable(str({ min: 1, max: 64 })) });
/** « Mon barbier »: the one he prefers (a chair that still takes bookings), or null for « Peu importe ». */
export const setOwnPrefs = {
  run(s, input, ctx) {
    const { account } = own(s, ctx);
    const x = parse(prefsSchema, input || {});
    if (x.staffId === undefined) fail(400, 'invalid', 'staffId : obligatoire');
    if (x.staffId !== null) {
      const st = s.staff.get(x.staffId);
      if (!st || !st.active || !st.chair || !st.bookable) fail(400, 'invalid', 'Ce barbier ne prend plus de rendez-vous.');
    }
    if (((account.prefs && account.prefs.staffId) || null) === x.staffId) return { ok: true, changed: false };
    ctx.emit('account.prefs', { id: account.cid, cid: account.cid, patch: { staffId: x.staffId } });
    return { ok: true, changed: true };
  }
};

/** The owner's mail about a client's request: the file's first name only, and its id so that erasing the file blanks it. */
function mailOwner(s, ctx, c, o) {
  const to = ownerEmail(s);
  if (!s.settings.messages.email || !isEmail(to)) return null;
  const site = String((ctx.meta && ctx.meta.siteUrl) || '').replace(/\/+$/, '');
  return queueMessage(s, ctx, {
    key: o.key, channel: 'email', template: o.template, to, cid: c.id, vars: {}, subject: o.subject + (c.first || 'Client'),
    text: [o.subject + (c.first || 'Client') + ' — ' + o.what, ...(site ? ['', 'Le Comptoir : ' + site + '/comptoir/clients/' + c.id] : [])].join('\n'),
    links: site ? [site + '/comptoir/clients/' + c.id] : []
  });
}

/**
 * « Demander l’effacement »: one request per space (a second tap writes nothing), the owner told by mail and in the feed.
 * The file is not touched: the owner erases it from Clients (the guard on what is still open stays his).
 */
export const requestErasure = {
  run(s, input, ctx) {
    const { c, account } = own(s, ctx, true);
    if (account.eraseAt) return { ok: true, already: true, at: account.eraseAt };
    ctx.emit('account.eraseRequested', { id: account.cid, cid: account.cid });
    mailOwner(s, ctx, c, { key: 'oera_' + c.id, template: 'owner_erase', subject: 'Demande d’effacement · ', what: 'à traiter sous un mois (Clients › fiche › Effacer).' });
    return { ok: true, already: false, at: ctx.now };
  }
};

/**
 * « Télécharger mes données »: a copy of the file by e-mail, at the address the salon holds (the JSON is built by the
 * route, from the same words as the salon's own export, and travels as the mail's attachment, in pii like the mail).
 * No e-mail on file: nothing is sent, the owner is told by mail, the client is asked to call the salon.
 * @returns {{ ok: true, sent: boolean, id?: string, limit?: boolean, noEmail?: boolean }}
 */
export const requestExport = {
  run(s, input, ctx) {
    const { c } = own(s, ctx, true);
    const day = ctx.local.day;
    const json = input && typeof input.json === 'string' ? input.json : '';
    if (!c.email || !isEmail(c.email) || !s.settings.messages.email || !json) {
      mailOwner(s, ctx, c, { key: 'oexp_' + c.id + '_' + day, template: 'owner_export', subject: 'Demande de données · ', what: 'pas d’e-mail sur la fiche : à envoyer depuis Clients › fiche › Exporter.' });
      return { ok: true, sent: false, noEmail: true };
    }
    let n = 0;
    while (n < EXPORTS_PER_DAY && s.messages.has(messageId('dexp_' + c.id + '_' + day + '_' + n))) n++;
    if (n >= EXPORTS_PER_DAY) return { ok: true, sent: false, limit: true };
    const shop = s.settings.shop;
    const id = queueMessage(s, ctx, {
      key: 'dexp_' + c.id + '_' + day + '_' + n, channel: 'email', template: 'dataExport', to: c.email, cid: c.id, vars: {},
      subject: 'Tes données chez ' + shop.name,
      text: ['Bonjour' + (c.first ? ' ' + c.first : '') + ',', '', 'Tu as demandé une copie de tes données depuis ton espace : elle est en pièce jointe (un fichier JSON, lisible dans un éditeur de texte).',
        'Ce n’est pas toi ? Préviens le salon' + (shop.phone ? ' au ' + shop.phone : '') + ', et ne transfère pas ce message.', '', shop.name].join('\n'),
      attachments: [{ name: 'mes-donnees-larchitecte.json', type: 'application/json', content: json }]
    });
    return { ok: true, sent: !!id, ...(id ? { id } : {}) };
  }
};

const inviteSchema = obj({ cid: str({ min: 1, max: 64 }), link: str({ min: 1, max: 160, pattern: /^https?:\/\/\S+$/ }) });
/**
 * « Envoyer le lien de son espace » (client.edit): the salon texts a client the way into his space ({lien} is a signed
 * /moi?garder= link the route minted, good 48 h). One of the three link texts a file gets a day (domain/linkcap.js).
 * @returns {{ ok: true, sent: boolean, id?: string, limit?: boolean }}
 */
export const sendSpaceInvite = {
  run(s, input, ctx) {
    ctx.need('client.edit');
    const x = parse(inviteSchema, input || {});
    const c = getClient(s, x.cid);
    if (c.erased) fail(409, 'erased', 'Cette fiche a été effacée.');
    if (!c.phone) fail(409, 'no_phone', 'Cette fiche n’a pas de numéro.');
    if (!accountsOn(s)) fail(409, 'disabled', 'L’espace client n’est pas ouvert (Réglages › Réservation).');
    const day = ctx.local.day;
    if (!linkAllowed(s, c.id, day)) return { ok: true, sent: false, limit: true };
    let n = 0;
    while (s.messages.has(messageId('invite_' + c.id + '_' + day + '_' + n))) n++;
    const id = queueMessage(s, ctx, { key: 'invite_' + c.id + '_' + day + '_' + n, template: 'accesInvite', to: c.phone, cid: c.id, vars: { lien: x.link } });
    return { ok: true, sent: !!id, ...(id ? { id } : {}) };
  }
};
