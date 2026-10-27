// @ts-check
// Réglages › Mise en route › Nouveautés: every switch that waits for something, in one place. No registry to edit: a
// settings section (settings/*.js, listed in settings/index.js) that has such a switch exports
//   golive: { label, to?, state(s, rt) → { on, blocker } }
// `on`: the feature runs; `blocker`: what it waits for when it does not (« En attente de la relecture des CGV »), empty
// when it is simply off. `to`: the Réglages section that holds its switch (settings.* otherwise: DEFAULT_TO, then the list).
// state() reads the projection and the runtime (rt.signer, rt.cfg…) and must not write anything.
import { SECTIONS } from '../settings/index.js';

/** Where each known section's switch lives in Réglages, for a section whose golive names no `to`. */
const DEFAULT_TO = /** @type {Record<string, string>} */ ({
  membership: 'paiements', fiscal: 'donnees', accounts: 'reservation', loyalty: 'reservation', suivi: 'messages', compta: 'donnees', deposits: 'reservation'
});

/**
 * @param {any} s the projection @param {any} rt the runtime
 * @returns {{ id: string, label: string, on: boolean, blocker: string, to: string }[]}
 */
export function featuresOf(s, rt) {
  const out = [];
  for (const sec of SECTIONS) {
    const g = /** @type {any} */ (sec).golive;
    if (!g || typeof g.state !== 'function') continue;
    let st;
    // a section that fails to say must not hide the others
    try { st = g.state(s, rt) || {}; } catch (err) { st = { on: false, blocker: 'Vérification impossible : ' + String(err && /** @type {any} */ (err).message || err) }; }
    out.push({ id: sec.key, label: String(g.label || sec.key), on: !!st.on, blocker: st.on ? '' : String(st.blocker || ''), to: String(g.to || DEFAULT_TO[sec.key] || 'mise-en-route') });
  }
  return out;
}
