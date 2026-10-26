// @ts-check
// Client files. Identity is the phone number: a client booking online with a known number lands on their file.
import { fail } from '../core/engine.js';
import { str, bool, opt, obj, arr, parse } from '../lib/validate.js';
import { normPhone, isEmail, capFirst } from '../lib/util.js';
import { getClient } from './common.js';

const fields = {
  first: opt(str({ min: 1, max: 40 })), last: opt(str({ max: 40 })), phone: opt(str({ max: 24 })), email: opt(str({ max: 120, lower: true })),
  notes: opt(str({ max: 1000 })), tech: opt(str({ max: 500 })), birthday: opt(str({ max: 5, pattern: /^(\d{2}-\d{2})?$/ })),
  tags: opt(arr(str({ min: 1, max: 24 }), { max: 8 })), sms: opt(bool()), marketing: opt(bool())
};
const addSchema = obj(fields);
const patchSchema = obj(fields);

/** Validate and normalise identity fields; returns the pii part and the plain part. */
export function clientParts(x) {
  const pii = {};
  if (x.first !== undefined) pii.first = capFirst(x.first);
  if (x.last !== undefined) pii.last = capFirst(x.last);
  if (x.phone !== undefined) {
    const p = x.phone ? normPhone(x.phone) : '';
    if (x.phone && !p) fail(400, 'invalid', 'Numéro de téléphone invalide.');
    pii.phone = p;
  }
  if (x.email !== undefined) {
    if (x.email && !isEmail(x.email)) fail(400, 'invalid', 'E-mail invalide.');
    pii.email = x.email;
  }
  for (const k of ['notes', 'tech', 'birthday']) if (x[k] !== undefined) pii[k] = x[k];
  const plain = {};
  for (const k of ['tags', 'sms', 'marketing']) if (x[k] !== undefined) plain[k] = x[k];
  return { pii, plain };
}

/** Emit a new client, or return the existing one with that phone. Used by bookings too. */
export function upsertClient(s, ctx, x, source) {
  const { pii, plain } = clientParts(x);
  if (pii.phone) {
    const existing = s.clientByPhone.get(pii.phone);
    if (existing) return { id: getClient(s, existing).id, created: false };
  }
  if (!pii.first) fail(400, 'invalid', 'Le prénom est obligatoire.');
  const cid = ctx.id('cl');
  ctx.emit('client.added', { id: cid, cid, source, sms: plain.sms !== false, marketing: !!plain.marketing, tags: plain.tags || [] }, pii);
  return { id: cid, created: true };
}

export const addClient = {
  run(s, input, ctx) {
    ctx.need('client.edit');
    const x = parse(addSchema, input);
    const { pii } = clientParts(x);
    if (pii.phone && s.clientByPhone.has(pii.phone)) fail(409, 'exists', 'Un client a déjà ce numéro.', { id: s.clientByPhone.get(pii.phone) });
    return upsertClient(s, ctx, x, 'salon');
  }
};

export const updateClient = {
  run(s, input, ctx) {
    ctx.need('client.edit');
    const c = getClient(s, input.id);
    if (c.erased) fail(409, 'erased', 'Cette fiche a été effacée.');
    const x = parse(patchSchema, input.patch || {});
    const { pii, plain } = clientParts(x);
    if (pii.phone && pii.phone !== c.phone && s.clientByPhone.has(pii.phone)) fail(409, 'exists', 'Un autre client a déjà ce numéro.', { id: s.clientByPhone.get(pii.phone) });
    if (!Object.keys(pii).length && !Object.keys(plain).length) return { ok: true };
    ctx.emit('client.updated', { id: c.id, cid: c.id, patch: plain, fields: Object.keys(pii) }, Object.keys(pii).length ? pii : undefined);
    return { ok: true };
  }
};

export const mergeClients = {
  run(s, input, ctx) {
    ctx.need('client.edit');
    if (!ctx.can('agenda.edit')) fail(403, 'forbidden', 'La fusion de fiches est réservée à l’accueil et au gérant.');
    const from = getClient(s, input.from), into = getClient(s, input.into);
    if (from.id === into.id) fail(400, 'invalid', 'Ce sont déjà les mêmes fiches.');
    const fill = {};
    for (const k of ['last', 'phone', 'email', 'tech', 'birthday']) if (!into[k] && from[k]) fill[k] = from[k];
    if (from.notes) fill.notes = [into.notes, from.notes].filter(Boolean).join('\n');
    ctx.emit('client.merged', { from: from.id, into: into.id });
    if (Object.keys(fill).length) ctx.emit('client.updated', { id: into.id, cid: into.id, patch: {}, fields: Object.keys(fill) }, fill);
    return { id: into.id };
  }
};

export const eraseClient = {
  run(s, input, ctx) {
    ctx.need('client.erase');
    const c = getClient(s, input.id);
    if (c.erased) return { ok: true };
    const ids = [c.id, ...[...s.clients.values()].filter((x) => x.mergedInto === c.id).map((x) => x.id)];
    ctx.emit('client.erased', { id: c.id, cid: c.id, ids });
    return { ok: true };
  }
};
