// The roster. Import from here, never from clients.mjs or staff.mjs directly.
import { CLIENTS } from './clients.mjs';
import { STAFF_PERSONAS } from './staff.mjs';

/** @typedef {import('./schema.mjs').Persona} Persona */
/** @typedef {import('./schema.mjs').Scene} Scene */

/** @type {Persona[]} */
export const PERSONAS = [...CLIENTS, ...STAFF_PERSONAS];
export { CLIENTS, STAFF_PERSONAS };

export const personaById = (/** @type {string} */ id) => PERSONAS.find((p) => p.id === id);

/** Every scene in the roster, each carrying its persona’s id. @returns {(Scene & { persona: string })[]} */
export const allScenes = () => PERSONAS.flatMap((p) => p.scenes.map((s) => ({ ...s, persona: p.id })));

/** The scenes a trial should run (a persona’s scene lists the trials it wants). @param {string} trial */
export const scenesFor = (trial) => allScenes().filter((s) => s.trials.includes(trial));
