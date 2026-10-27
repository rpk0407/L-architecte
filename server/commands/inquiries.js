// @ts-check
// Les demandes: what the WordPress contact widget and the Contact Form 7 form on /formations used to e-mail the owner.
// A visitor writes from /contact or /formations (routes-inquiries.js); the request lands in Relances › Demandes, the
// owner gets an e-mail (settings.notify, as for an online booking), and answers by SMS or marks it handled.
// The person's first name, number, e-mail and words travel in pii only: an erasure takes them out of the journal.
// Also here: Le site › Formations, the modules, sessions and certificates /formations shows (settings/trainings.js).
import { fail } from '../core/engine.js';
import { str, id, opt, bool, obj, parse } from '../lib/validate.js';
import { normPhone, isEmail, fmtPhone } from '../lib/util.js';
import { queueMessage } from '../domain/messages.js';
import { ownerEmail } from '../domain/mails.js';
import { trainingsSchema, LIMITS } from '../settings/trainings.js';
import { moduleTitle, gone } from '../projections/inquiries.js';

export const KINDS = /** @type {const} */ (['contact', 'formation']);
/** The id of the owner's e-mail about a request: erasing the request blanks it too. */
export const ownerMailId = (/** @type {string} */ inqId) => 'msg_oinq_' + inqId;

/** A typed text, control characters out, within max; a fail the page can show beside the field otherwise. */
function text(x, max, field, tooLong) {
  // only a robot sends an object or a list: refused, rather than '[object Object]' in the owner's inbox
  if (x != null && typeof x !== 'string') fail(400, 'invalid', 'Vérifie ce champ.', { field });
  const v = String(x ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim();
  if (v.length > max) fail(400, 'invalid', tooLong, { field });
  return v;
}

/**
 * A request from the site. No account: the actor is the anonymous visitor (routes-inquiries.js); the honeypot and the
 * rate limit are checked there, before this runs.
 */
export const receiveInquiry = {
  run(/** @type {any} */ s, /** @type {any} */ input, /** @type {import('../core/engine.js').Ctx} */ ctx) {
    const x = input && typeof input === 'object' ? input : {};
    const kind = KINDS.includes(x.kind) ? x.kind : fail(400, 'invalid', 'Type de demande inconnu.');
    // one line: the first name heads the inbox card, the feed line and the owner's e-mail
    const first = text(x.first, 60, 'first', 'Ton prénom : 60 caractères au plus.').replace(/\s+/g, ' ');
    if (!first) fail(400, 'invalid', 'Donne ton prénom.', { field: 'first' });
    const rawPhone = text(x.phone, 32, 'phone', 'Vérifie ton numéro : 10 chiffres, comme 06 12 34 56 78.');
    const phone = rawPhone ? normPhone(rawPhone) : '';
    if (rawPhone && !phone) fail(400, 'invalid', 'Vérifie ton numéro : 10 chiffres, comme 06 12 34 56 78.', { field: 'phone' });
    const email = text(x.email, 120, 'email', 'Vérifie ton e-mail.').toLowerCase();
    if (email && !isEmail(email)) fail(400, 'invalid', 'Vérifie ton e-mail : il manque quelque chose (comme prenom@exemple.fr).', { field: 'email' });
    if (!phone && !email) fail(400, 'invalid', 'Laisse un numéro ou un e-mail, qu’on puisse te répondre.', { field: 'phone' });
    const message = text(x.message, LIMITS.message, 'message', 'Ton message : ' + LIMITS.message + ' caractères au plus.');
    if (kind === 'contact' && message.length < 2) fail(400, 'invalid', 'Écris ton message.', { field: 'message' });
    let module = '';
    if (kind === 'formation' && x.module) {
      module = text(x.module, 30, 'module', 'Choisis un module dans la liste.');
      if (!(s.settings.trainings.modules || []).some((m) => m.id === module)) fail(400, 'invalid', 'Choisis un module dans la liste.', { field: 'module' });
    }
    // a known number links the request to the client's file: erasing the file erases the request with it
    const cid0 = phone ? s.clientByPhone.get(phone) : null;
    const c = cid0 ? s.clients.get(cid0) : null;
    const cid = c && !c.erased ? c.mergedInto || c.id : null;

    const inq = ctx.id('inq');
    ctx.emit('inquiry.received', { id: inq, kind, module, ...(cid ? { cid } : {}) }, { first, phone, email, message });
    mailOwner(s, ctx, { id: inq, kind, module, first, phone, email, message, cid });
    return { ok: true, id: inq };
  }
};

/**
 * 'Demande de formation · La coupe homme classique et ses subtilités', with everything needed to call back in the text.
 * No name in the subject: an erasure blanks the text and the address, and the subject is what the outbox still shows.
 */
function mailOwner(s, ctx, q) {
  const to = ownerEmail(s);
  if (!isEmail(to)) return null;
  const mod = q.module ? moduleTitle(s, q.module) : '';
  const head = q.kind === 'formation' ? 'Demande de formation' + (mod ? ' · ' + mod : '') : 'Nouveau message depuis le site';
  const inbox = ctx.meta && ctx.meta.siteUrl ? ctx.meta.siteUrl.replace(/\/+$/, '') + '/comptoir/relances/demandes' : '';
  const body = [
    q.first + ' a écrit depuis la page ' + (q.kind === 'formation' ? 'Formations' : 'Contact') + ' du site.', '',
    ...(mod ? ['Module : ' + mod] : []),
    ...(q.phone ? ['Téléphone : ' + fmtPhone(q.phone)] : []),
    ...(q.email ? ['E-mail : ' + q.email] : []),
    ...(q.message ? ['', '« ' + q.message + ' »'] : []),
    ...(inbox ? ['', 'Répondre par SMS ou marquer traité : ' + inbox] : [])
  ].join('\n');
  return queueMessage(s, ctx, {
    key: 'oinq_' + q.id, channel: 'email', template: 'owner_inquiry', to, cid: q.cid || null, vars: {}, subject: head, text: body,
    cta: inbox ? { label: 'Ouvrir les demandes', url: inbox } : undefined, links: [inbox]
  });
}

/** @param {any} s @param {string} inqId */
function inquiryOf(s, inqId) {
  const q = inqId ? s.inquiries.get(inqId) : null;
  if (!q) fail(404, 'not_found', 'Demande introuvable.');
  return q;
}

const handledSchema = obj({ id: id(), undo: opt(bool()) });
/** 'Marquer traité' (or back to unread with undo). Twice is once: nothing new to say, no event. */
export const markInquiryHandled = {
  run(/** @type {any} */ s, /** @type {any} */ input, /** @type {import('../core/engine.js').Ctx} */ ctx) {
    ctx.need('marketing');
    const x = parse(handledSchema, input);
    const q = inquiryOf(s, x.id);
    // erased (itself or with the client file): handled for good, nothing left to reopen
    if (gone(s, q)) return x.undo ? fail(409, 'erased', 'Cette demande a été effacée.') : { ok: true, status: 'handled' };
    if ((q.status === 'handled') === !x.undo) return { ok: true, status: q.status };
    ctx.emit('inquiry.handled', { id: q.id, ...(x.undo ? { undo: true } : {}) });
    return { ok: true, status: x.undo ? 'new' : 'handled' };
  }
};

const replySchema = obj({ id: id(), text: str({ min: 2, max: 480 }) });
/**
 * 'Répondre par SMS': a service text to the number the person left, asked for by them, so it leaves at once (no quiet
 * hours, no STOP mention). {prenom} is their first name. Answering marks the request handled.
 */
export const replyInquiry = {
  run(/** @type {any} */ s, /** @type {any} */ input, /** @type {import('../core/engine.js').Ctx} */ ctx) {
    ctx.need('marketing');
    const x = parse(replySchema, input);
    const q = inquiryOf(s, x.id);
    // the client file erased since counts too: no text to that number, no number back in the journal
    if (gone(s, q)) fail(409, 'erased', 'Cette demande a été effacée.');
    if (!q.phone) fail(409, 'no_phone', 'Pas de numéro sur cette demande : réponds par e-mail.');
    const msgId = queueMessage(s, ctx, { key: 'inqr_' + q.id + '_' + q.replies.length, template: 'inquiry_reply', text: x.text, to: q.phone, cid: q.cid || null, vars: { prenom: q.first } });
    if (!msgId) fail(409, 'not_sent', 'Ce numéro n’est pas dans les pays où le salon envoie des SMS.');
    ctx.emit('inquiry.replied', { id: q.id, msgId });
    return { ok: true, msgId };
  }
};

/**
 * Effacer (RGPD): the person's details and words leave the journal (store and memory) with the owner's e-mail and the
 * SMS answers, through client.erased's drop list, as the retention purge does for data outside any file.
 */
export const eraseInquiry = {
  run(/** @type {any} */ s, /** @type {any} */ input, /** @type {import('../core/engine.js').Ctx} */ ctx) {
    ctx.need('client.erase');
    const q = inquiryOf(s, parse(obj({ id: id() }), input).id);
    if (q.erased) return { ok: true };
    const drop = [q.id, ownerMailId(q.id), ...q.replies.map((x) => x.msgId).filter(Boolean)];
    ctx.emit('inquiry.erased', { id: q.id });
    ctx.emit('client.erased', { ids: [], drop, inquiry: q.id, files: 0 });
    return { ok: true };
  }
};

/** Le site › Formations: owner and managers, like the rest of the site's content (`catalog`). */
export const updateTrainings = {
  run(/** @type {any} */ s, /** @type {any} */ input, /** @type {import('../core/engine.js').Ctx} */ ctx) {
    ctx.need('catalog');
    const patch = parse(trainingsSchema, input || {});
    if (!Object.keys(patch).length) return { ok: true };
    const modules = patch.modules || s.settings.trainings.modules || [];
    const has = (/** @type {string} */ m) => modules.some((x) => x.id === m);
    if (patch.sessions) patch.sessions.forEach((x, i) => { if (!has(x.moduleId)) fail(400, 'invalid', 'Session ' + (i + 1) + ' : ce module n’existe plus.'); });
    // a module taken out takes its sessions with it, so the page never lists a date for nothing
    else if (patch.modules && (s.settings.trainings.sessions || []).some((x) => !has(x.moduleId))) patch.sessions = s.settings.trainings.sessions.filter((x) => has(x.moduleId));
    ctx.emit('settings.updated', { patch: { trainings: patch } });
    return { ok: true };
  }
};

