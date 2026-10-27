// @ts-check
// Les formations: what /formations says (public/formations.html reads it from /api/public/trainings). The owner edits it
// in the Comptoir (Le site › Formations, commands/inquiries.js updateTrainings). Defaults are the four modules of the old
// WordPress page, with its words; their ids are the page's anchors (/formations#barbe, the old addresses redirect there).
//   modules   price in cents, null for « sur devis »; duration in words ('2 jours · 14 h'), '' when not said
//   sessions  dates to come, each for one module, with the seats left
//   nda       the training body's declaration number (numéro de déclaration d’activité), shown with its legal mention
//   qualiopi  the certificate (number or certifier): without it, the page never mentions the CPF, which needs it
// No import of the engine here: the settings registry (index.js) loads this file while the engine is still loading.
import { str, int, opt, nullable, obj, arr, money, InvalidInput } from '../lib/validate.js';
import { isDay } from '../../shared/dates.js';

export const LIMITS = { intro: 800, modules: 8, points: 8, sessions: 30, message: 1000 };
/** a module's id is the page's anchor: lower case, digits and dashes */
export const MODULE_ID = /^[a-z0-9][a-z0-9-]{0,29}$/;
/** ids /formations already uses (the form #demande, the sections, the headings tm-…, the fields dm-…): a module never takes one */
export const RESERVED_ID = /^(main|demande|(t|tm|dm)-.*)$/;

/** a real calendar day ('2026-02-30' is not) */
const realDay = () => ({ parse(/** @type {any} */ x, /** @type {string} */ p) {
  if (!isDay(x) || new Date(x + 'T12:00:00Z').toISOString().slice(0, 10) !== x) throw new InvalidInput(p, 'date AAAA-MM-JJ attendue');
  return /** @type {string} */ (x);
} });
const moduleSchema = () => obj({
  id: str({ min: 1, max: 30, pattern: MODULE_ID }),
  title: str({ min: 2, max: 100 }),
  points: opt(arr(str({ min: 1, max: 160 }), { max: LIMITS.points })),
  duration: opt(str({ max: 60 })),
  price: nullable(money(1000000))
});
const sessionSchema = () => obj({ moduleId: str({ min: 1, max: 30, pattern: MODULE_ID }), date: realDay(), seats: int({ min: 0, max: 50 }) });

/** Whichever path saves it (Le site › Formations, or a settings patch): module ids once each, sessions of a module the patch lists. */
const trainingsSchema = (() => {
  const o = obj({
    intro: opt(str({ max: LIMITS.intro })),
    modules: opt(arr(moduleSchema(), { max: LIMITS.modules })),
    sessions: opt(arr(sessionSchema(), { max: LIMITS.sessions })),
    nda: opt(str({ max: 40, pattern: /^[\dA-Za-z .-]*$/ })),
    qualiopi: opt(str({ max: 120 }))
  });
  return { parse(/** @type {any} */ x, /** @type {string} */ p) {
    const v = o.parse(x, p);
    const at = (k) => (p ? p + '.' : '') + k;
    if (v.modules) {
      const seen = new Set();
      v.modules.forEach((m, i) => { if (RESERVED_ID.test(m.id)) throw new InvalidInput(at('modules[' + i + '].id'), 'code déjà pris par la page'); if (seen.has(m.id)) throw new InvalidInput(at('modules[' + i + '].id'), 'deux modules ont le même code'); seen.add(m.id); });
      for (const m of v.modules) { m.points = (m.points || []).filter(Boolean); m.duration = m.duration || ''; m.price = m.price ?? null; }
    }
    if (v.modules && v.sessions) v.sessions.forEach((x, i) => { if (!v.modules.some((m) => m.id === x.moduleId)) throw new InvalidInput(at('sessions[' + i + '].moduleId'), 'module inconnu'); });
    return v;
  } };
})();
export { trainingsSchema };

function defaults() {
  return {
    intro: 'Titulaire d’un agrément de formateur en coiffure, L’Architecte propose des stages, dans le cadre de formations diplômantes ou simplement pour connaître et maîtriser ses atouts capillaires. Ils s’adressent aux débutants qui veulent gagner en aisance comme aux coiffeurs qui veulent se perfectionner dans une technique de la coiffure homme.',
    modules: [
      { id: 'barbe', title: 'Taille et entretien de la coupe et de la barbe', points: ['Devenir spécialiste de la taille de barbe et du traçage.', 'Savoir conseiller selon la morphologie, le type de barbe et la tendance.', 'Maîtriser les différentes tailles de barbes et de moustaches courtes.'], duration: '', price: /** @type {number|null} */ (null) },
      { id: 'classique', title: 'La coupe homme classique et ses subtilités', points: ['Comprendre la morphologie pour réaliser une coupe classique et un fondu de nuque.', 'Connaître les coupes tendances et les collections homme.', 'L’art du rasage et de l’effilage.'], duration: '', price: /** @type {number|null} */ (null) },
      { id: 'complexe', title: 'La coupe homme complexe et ses techniques', points: ['Ombre et lumière du dégradé à zéro.', 'Réaliser, entretenir et harmoniser les volumes d’une coupe complexe.', 'Notions de hair design.'], duration: '', price: /** @type {number|null} */ (null) },
      { id: 'image', title: 'Conseiller en image', points: ['Recommandée aux professionnels de la revente de produits de coiffure.'], duration: '', price: /** @type {number|null} */ (null) }
    ],
    sessions: /** @type {{ moduleId: string, date: string, seats: number }[]} */ ([]),
    nda: '',
    qualiopi: ''
  };
}
/** @typedef {ReturnType<typeof defaults>} Trainings */

export default /** @type {const} */ ({ key: 'trainings', defaults, schema: trainingsSchema });

/**
 * What /formations shows: the modules in order, each with its sessions still to come (orphans left out), and the CPF
 * line only with a Qualiopi certificate. Never anything personal.
 * @param {any} settings @param {string} today
 */
export function publicTrainings(settings, today) {
  const t = /** @type {Trainings} */ ({ ...defaults(), ...(settings.trainings || {}) });
  const modules = (Array.isArray(t.modules) ? t.modules : []).map((m) => ({
    id: m.id, title: m.title, points: m.points || [], duration: m.duration || '', price: m.price ?? null,
    sessions: (t.sessions || []).filter((x) => x.moduleId === m.id && x.date >= today).sort((a, b) => (a.date < b.date ? -1 : 1)).map((x) => ({ date: x.date, seats: x.seats }))
  }));
  return { intro: t.intro || '', modules, nda: t.nda || '', qualiopi: t.qualiopi || '', cpf: !!(t.qualiopi || '').trim() };
}
