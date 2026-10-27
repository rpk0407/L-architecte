// @ts-check
// New event types without touching state.js. A REGISTRY: a package that adds events imports its module here and
// lists it in EXTENSIONS. The projection calls init when it builds an empty state and folds each event type an
// extension handles through `on`. Handlers follow evolve's rules: only for stored events, no clock, no randomness, no I/O.
// Core types reach `on` only where state.js hands them on: client.erased does, after its own case, so an extension's
// copy of personal data leaves memory with the file.
// The types in `feed` show in the Comptoir's live feed through `item`, which turns a feed entry into a line for that
// request, or null to hide it (routes-staff.js feedItem). Without `item` they are not kept in the feed at all, so
// unseen entries never push real bookings and sales out of its window.
// item() returns `staffId` for anything about an appointment or a ticket; null when the item must reach only holders of the cap it names (its subject, if any, in `aboutStaffId`).
// Keep this part in its own module (e.g. server/projections/<name>.js) that imports neither core/engine.js nor
// core/state.js, directly or through commands/*: the projection loads it, so such an import is a cycle that breaks
// whichever file is imported first. The commands stay in commands/<name>.js and import the engine as usual.

/**
 * @typedef {{
 *   init?: (s: any) => void,
 *   on: Record<string, (s: any, e: import('./journal.js').JEvent, d: any, p: any) => void>,
 *   feed?: string[],
 *   item?: (r: any, f: { v: number, type: string, at: number, actor: any, data: any }) => object | null
 * }} Extension
 */

import { inquiriesExtension } from '../projections/inquiries.js';
import { reviewsExtension } from '../projections/reviews.js';
import { membershipsExtension } from '../projections/memberships.js';
import { governanceExtension } from '../projections/governance.js';
import { fiscalExtension } from '../projections/fiscal.js';
import { informedExtension } from '../projections/informed.js';
import { paymentsExtension } from '../projections/payments.js';
import { importsExtension } from '../projections/imports.js';
import { basculeExtension } from '../projections/bascule.js';

// one entry per line, so extensions added by different branches merge cleanly
/** @type {Extension[]} */
export const EXTENSIONS = [
  inquiriesExtension,
  reviewsExtension,
  membershipsExtension,
  governanceExtension,
  fiscalExtension,
  informedExtension,
  paymentsExtension,
  importsExtension,
  basculeExtension
];
