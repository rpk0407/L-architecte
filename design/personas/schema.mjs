// What a persona is, and the validator that keeps the atlas honest.
//
// Personas are not decoration: the harness runs them. Each persona owns scenes (a pinned clock, a device, a network, a colour
// scheme, an intent and the trials to run), so adding a persona or a scene adds browser coverage without touching a trial.
// Everything a persona claims carries an evidence class, because the independent research on barber-shop UX is thin: most of
// what is written about it is vendor marketing. A claim is a hypothesis until the salon’s own journal says otherwise.
import { DEVICES, NETWORKS, CLOCKS } from '../instruments/lib/surface.mjs';
import { MOMENTS } from '../programme/moments.mjs';

/** How we know what we claim. The dossier prints this next to every persona claim. */
export const EVIDENCE = {
  O: 'Observed in the product or its code: anyone can verify it',
  J: 'Validated on the salon’s own journal',
  D: 'Domain knowledge of the trade, not verified for this shop',
  V: 'Vendor-published claim: commercial interest, directional only',
  H: 'Hypothesis of the Cabinet: to be tested'
};

export const PRIORITIES = ['core', 'growth', 'edge'];
export const SCHEMES = ['light', 'dark'];

/** The trials that exist (design/instruments/trials/<id>.mjs). A test keeps this list and the folder in step. */
export const TRIALS = ['rue', 'pouce', 'chrono', 'clavier', 'tram', 'retour', 'nuit', 'ancien', 'guichet', 'mains', 'atelier', 'duo'];

/** The booking and staff flows a scene can ask a trial to drive. */
export const FLOWS = ['fastest', 'first-visit', 'rebook', 'deposit', 'duo', 'barber', 'desk', 'owner', 'questions'];

/**
 * @typedef {{ id: string, q: string, kind: 'text'|'link'|'tel'|'contact', re?: RegExp, scope?: 'viewport'|'page', weight?: number }} Question
 * @typedef {{ id: string, label: string, clock: string, device: string, network: string, scheme: 'light'|'dark', motion?: 'reduce', intent: string,
 *   trials: string[], flow?: string, route?: string, via?: RegExp, questions?: Question[] }} Scene
 * @typedef {{ claim: string, cls: keyof typeof EVIDENCE, source?: string, validate: string }} Evidence
 * @typedef {{ id: string, kind: 'client'|'staff', archetype: string, name: string, age: number, role: string, headline: string, life: string,
 *   jobs: string[], fears: string[], delights: string[], says: string[], avoids: string[], rhythm: string,
 *   priority: 'core'|'growth'|'edge', weight: number, why: string, budget: { seconds: number, taps: number, chars: number },
 *   moments: string[], scenes: Scene[], success: string, failure: string, tells: string, protect: string[], evidence: Evidence[] }} Persona
 */

const text = (v) => typeof v === 'string' && v.trim().length > 0;
const list = (v) => Array.isArray(v) && v.length > 0 && v.every(text);

/** The problems with one persona, as readable lines (empty when it is sound). @param {Persona} p @returns {string[]} */
export function validatePersona(p) {
  const bad = [];
  const need = (ok, msg) => { if (!ok) bad.push(`${p.id || '(no id)'}: ${msg}`); };
  for (const k of ['id', 'archetype', 'name', 'role', 'headline', 'life', 'rhythm', 'why', 'success', 'failure', 'tells']) need(text(p[k]), `${k} is empty`);
  need(p.kind === 'client' || p.kind === 'staff', 'kind must be client or staff');
  need(Number.isInteger(p.age) && p.age >= 10 && p.age <= 99, 'age must be a whole number');
  for (const k of ['jobs', 'fears', 'delights', 'says', 'avoids', 'protect']) need(list(p[k]), `${k} must be a non-empty list of text`);
  need(PRIORITIES.includes(p.priority), `priority must be one of ${PRIORITIES.join(', ')}`);
  need(typeof p.weight === 'number' && p.weight > 0 && p.weight <= 1, 'weight must be in (0, 1]');
  need(p.budget && ['seconds', 'taps', 'chars'].every((k) => Number.isFinite(p.budget[k]) && p.budget[k] >= 0), 'budget needs seconds, taps and chars');
  need(Array.isArray(p.moments) && p.moments.length > 0, 'moments is empty');
  for (const m of p.moments || []) need(MOMENTS.some((x) => x.id === m), `unknown moment ${m}`);
  need(Array.isArray(p.scenes) && p.scenes.length > 0, 'a persona needs at least one scene');
  for (const s of p.scenes || []) {
    const at = `scene ${s.id}`;
    need(text(s.id) && s.id.startsWith(p.id + '.'), `${at}: the id must start with “${p.id}.”`);
    need(text(s.label) && text(s.intent), `${at}: label and intent are required`);
    need(s.clock in CLOCKS, `${at}: unknown clock ${s.clock}`);
    need(s.device in DEVICES, `${at}: unknown device ${s.device}`);
    need(s.network in NETWORKS, `${at}: unknown network ${s.network}`);
    need(SCHEMES.includes(s.scheme), `${at}: scheme must be light or dark`);
    need(Array.isArray(s.trials) && s.trials.length > 0 && s.trials.every((t) => TRIALS.includes(t)), `${at}: trials must come from ${TRIALS.join(', ')}`);
    need(s.flow == null || FLOWS.includes(s.flow), `${at}: unknown flow ${s.flow}`);
    for (const q of s.questions || []) need(text(q.id) && text(q.q) && ['text', 'link', 'tel', 'contact'].includes(q.kind) && (q.kind === 'tel' || q.kind === 'contact' || q.re instanceof RegExp), `${at}: question ${q.id} is malformed`);
  }
  need(Array.isArray(p.evidence) && p.evidence.length > 0, 'a persona needs evidence entries');
  for (const e of p.evidence || []) {
    need(text(e.claim) && e.cls in EVIDENCE && text(e.validate), `evidence “${String(e.claim).slice(0, 40)}” needs a claim, a class (${Object.keys(EVIDENCE).join('/')}) and how to validate it`);
    if (e.cls === 'V') need(/^https?:\/\//.test(e.source || ''), `vendor claim “${String(e.claim).slice(0, 40)}” must cite its URL`);
    if (e.cls === 'O') need(text(e.source), `observed claim “${String(e.claim).slice(0, 40)}” must say where it can be observed`);
  }
  return bad;
}

/** The problems with the whole roster: unique ids, weights that add up to 1 per side. @param {Persona[]} all @returns {string[]} */
export function validateRoster(all) {
  const bad = all.flatMap(validatePersona);
  const ids = all.map((p) => p.id);
  if (new Set(ids).size !== ids.length) bad.push('persona ids are not unique');
  const scenes = all.flatMap((p) => p.scenes.map((s) => s.id));
  if (new Set(scenes).size !== scenes.length) bad.push('scene ids are not unique');
  for (const kind of ['client', 'staff']) {
    const sum = all.filter((p) => p.kind === kind).reduce((a, p) => a + p.weight, 0);
    if (Math.abs(sum - 1) > 0.001) bad.push(`${kind} weights add up to ${sum.toFixed(3)}, not 1`);
  }
  return bad;
}
