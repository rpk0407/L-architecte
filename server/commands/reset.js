// @ts-check
// « Mot de passe oublié »: whoever signs in with an e-mail and a password (the owner, a manager) asks for a link at the
// address of his account. The link is signed, lives 30 minutes, works once, and a newer one replaces it. Using it sets
// the new password and closes every session of that person. The link itself is never written in the journal: the event
// keeps its nonce, which opens nothing without the server's signature (auth/session.js signLink, kind 'pwd').
import { fail } from '../core/engine.js';

export const RESET_MS = 30 * 60000;
const hashPattern = /^scrypt\$\d+\$\d+\$\d+\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/;

/**
 * Who may get a link: an active person who already signs in with an e-mail and a password. A barber whose e-mail is on
 * file but who was never given a password does not get one this way: opening that door stays the owner's choice (Équipe).
 */
export const resettable = (s, email) => {
  const e = String(email || '').trim().toLowerCase();
  return e ? [...s.staff.values()].find((x) => x.active && x.hasPwd && x.email && x.email === e) || null : null;
};

export const issuePasswordReset = {
  run(s, input, ctx) {
    if (ctx.actor.t !== 'system') fail(403, 'forbidden', 'Action réservée au serveur.');
    const st = s.staff.get(String(input.staffId || ''));
    if (!st || !st.active || !st.email || !st.hasPwd) fail(404, 'not_found', 'Compte introuvable.');
    const id = ctx.id('pr');
    const exp = ctx.now + RESET_MS;
    ctx.emit('pwd.resetIssued', { id, staffId: st.id, exp });
    return { id, staffId: st.id, exp };
  }
};

/** What a link is worth right now: the person it is for, or why not. Said before the form and checked again by the write. */
export function resetOf(s, staffId, nonce, now) {
  const l = s.pwdResets.get(String(staffId || ''));
  const st = l ? s.staff.get(l.staffId) : null;
  if (!l || l.id !== nonce || !st || !st.active) fail(404, 'bad_link', 'Ce lien n’est pas valide. Demande-en un nouveau.');
  if (l.used) fail(409, 'used', 'Ce lien a déjà servi. Demande-en un nouveau.');
  if (now > l.exp) fail(410, 'expired', 'Ce lien a expiré (30 minutes). Demande-en un nouveau.');
  return { st, link: l };
}

export const usePasswordReset = {
  run(s, input, ctx) {
    if (ctx.actor.t !== 'system') fail(403, 'forbidden', 'Action réservée au serveur.');
    const { st, link } = resetOf(s, input.staffId, input.nonce, ctx.now);
    if (!hashPattern.test(String(input.pwdHash || ''))) fail(400, 'invalid', 'Mot de passe invalide.');
    // revoke: every session of this person ends, wherever it is open (core/state.js)
    ctx.emit('staff.credentials', { id: st.id, revoke: true }, { pwd: input.pwdHash });
    ctx.emit('pwd.resetUsed', { id: link.id, staffId: st.id });
    return { staffId: st.id };
  }
};
