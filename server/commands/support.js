// @ts-check
// « Accès prestataire »: the owner lets the person who set the salon up work in his Comptoir for a day, without
// giving his password. The prestataire makes a key on his own machine and sends only its fingerprint (the « demande »,
// a SHA-256: useless to anyone who reads it); the owner accepts it from Réglages, with his password. The key then
// opens the API as the owner (http/app.js), every action signed « Prestataire », until the access ends or is removed.
// What it never reaches: passwords, codes, phones and devices, a client's erasure, another access (http/app.js).
import { fail } from '../core/engine.js';

export const SUPPORT_HOURS = 24;
export const SUPPORT_MAX = 3;
const HOUR = 3600000;

/** The accesses still open at `now`. */
export const openSupport = (s, now) => [...s.support.values()].filter((g) => !g.revoked && g.exp > now).sort((a, b) => b.at - a.at);
/** What both sides read aloud before the owner accepts: the first 8 signs of the request. */
export const supportCode = (hash) => (hash.slice(0, 4) + '-' + hash.slice(4, 8)).toUpperCase();

export const grantSupport = {
  run(s, input, ctx) {
    if (!ctx.staff || ctx.staff.role !== 'owner' || ctx.actor.via) fail(403, 'forbidden', 'Seul le gérant peut ouvrir un accès prestataire.');
    const hash = String(input.hash || '').trim().toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(hash)) fail(400, 'invalid', 'Cette demande d’accès n’est pas valide. Demande un nouveau lien.');
    if (s.supportByHash.has(hash)) fail(409, 'used', 'Cette demande a déjà servi. Demande un nouveau lien.');
    if (openSupport(s, ctx.now).length >= SUPPORT_MAX) fail(409, 'too_many', 'Trois accès sont déjà ouverts : retires-en un d’abord.');
    const id = ctx.id('sp');
    const exp = ctx.now + SUPPORT_HOURS * HOUR;
    ctx.emit('support.granted', { id, hash, exp, staffId: ctx.staff.id, label: 'Prestataire' });
    return { id, exp, code: supportCode(hash) };
  }
};

/** The owner removes an access; the prestataire may close his own, and only his own. */
export const revokeSupport = {
  run(s, input, ctx) {
    if (!ctx.staff || ctx.staff.role !== 'owner') fail(403, 'forbidden', 'Seul le gérant peut retirer un accès prestataire.');
    const g = s.support.get(String(input.id || ''));
    if (!g || g.revoked) fail(404, 'not_found', 'Accès introuvable.');
    if (ctx.actor.via && ctx.actor.via !== g.id) fail(403, 'forbidden', 'Cet accès n’est pas le tien.');
    ctx.emit('support.revoked', { id: g.id });
    return { ok: true };
  }
};
