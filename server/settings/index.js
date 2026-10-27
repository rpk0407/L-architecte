// @ts-check
// The salon's settings, one file per section. A REGISTRY: a new section is a file exporting { key, defaults(), schema }
// that is imported here and listed in SECTIONS. Order is the order of the keys in the settings object.
// schema validates a patch of that key (PATCH /api/v1/settings); null means the key is written by its own commands.
import { opt, obj } from '../lib/validate.js';
import shop from './shop.js';
import hours, { closures, openings } from './hours.js';
import booking from './booking.js';
import deposits from './deposits.js';
import payments from './payments.js';
import messages from './messages.js';
import team from './team.js';
import goals from './goals.js';
import notify from './notify.js';
import trainings from './trainings.js';
import membership from './membership.js';
import fiscal from './fiscal.js';
import loyalty from './loyalty.js';
import accounts from './accounts.js';

// one entry per line, so sections added by different branches merge cleanly. A section taken out stays readable: `site`
// (the texts and photos of the old Le site editor) is still in some journals' settings.updated; replay keeps it in the
// projection, nothing reads it, and a patch can no longer write it.
const TYPED = /** @type {const} */ ([
  shop,
  hours,
  closures,
  openings,
  booking,
  deposits,
  payments,
  messages,
  team,
  goals,
  notify,
  trainings,
  membership,
  fiscal,
  loyalty,
  accounts
]);
export const SECTIONS = TYPED;

/** @typedef {typeof SECTIONS[number]} Section */
/** @typedef {{ -readonly [S in Section as S['key']]: ReturnType<S['defaults']> }} Settings */
/** A valid patch: each section that has a schema, optional. */
/** @typedef {{ [S in Section as S['schema'] extends null ? never : S['key']]?: S['schema'] extends import('../lib/validate.js').Schema<infer T> ? T : never }} SettingsPatch */

/** A fresh object on every call, built from each section's defaults. */
export function defaultSettings() {
  /** @type {any} */
  const o = {};
  for (const x of SECTIONS) o[x.key] = x.defaults();
  return /** @type {Settings} */ (o);
}

/** @type {Record<string, import('../lib/validate.js').Schema<any>>} */
const shape = {};
for (const x of SECTIONS) if (x.schema) shape[x.key] = opt(x.schema);
export const settingsSchema = /** @type {import('../lib/validate.js').Schema<SettingsPatch>} */ (obj(shape));
