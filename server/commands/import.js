// @ts-check
// Taking over the old WordPress salon (Salon Booking System): client files, past visits, upcoming bookings,
// paper gift cards and carnets. The browser reads the exports (web/src/lib/wpimport.ts) and sends them in
// batches; this decides what each row becomes. Running the same files again adds nothing (ext.wp, phone, e-mail,
// card code), so the cut-over day is a delta run: what changed on the old site since (cancelled, moved, taken place,
// deleted) is carried over. Nothing here queues a message or checks the chairs' hours: the old site already accepted
// these bookings, and its clients were told by the old site.
// A run (startImportRun … finishImportRun) leaves a record that adds up (projections/imports.js): each batch writes
// its counts, the rows it skipped by reason and references to the rows that want a look, never a name or a number.
import { fail } from '../core/engine.js';
import { str, int, bool, opt, obj, arr, day, id, oneOf, money, record, parse, InvalidInput } from '../lib/validate.js';
import { normPhoneImport, isEmail, isLandline, capFirst, sha256, normGiftCode, giftCode } from '../lib/util.js';
import { addDays, instantOf, dayShort, fmtTime } from '../../shared/dates.js';
import { fmtEur } from '../../shared/money.js';
import { retentionCutoff } from '../../shared/retention.js';
import { getClient, totalDur } from './common.js';
import { erasedTomb } from './clients.js';
import { runOpen } from '../projections/imports.js';

/** Salon Booking System's statuses (sln-b-…), as the browser normalises them from the French or English labels. */
export const WP_STATUS = /** @type {const} */ (['confirmed', 'pending', 'pendingpayment', 'paid', 'paylater', 'canceled', 'error']);
export const LEGACY_STAFF = 'legacy';
/** The built-in choice for an old service nobody matched: the archived « Ancienne prestation » (created when first needed), like LEGACY_STAFF for barbers. */
export const LEGACY_SERVICE = 'legacy';
const ACTIVE = new Set(['pending', 'booked', 'arrived', 'in_chair']);
export const GONE_REASON = 'Supprimé sur l’ancien site';
export const CANCEL_REASON = 'Annulé sur l’ancien site';
/** The reasons of the cancellations this import makes: a booking cancelled for one of them (and by nobody else) comes back if the old site confirms it again. */
const IMPORT_CANCELS = new Set([CANCEL_REASON, GONE_REASON]);

/**
 * What each row of the review list says. {x} is filled from what is known; a [group] holding a missing {x} is
 * dropped, so the same text serves the live answer (with names) and the report rebuilt later (refs only).
 * 'kind:v' is a variant of a kind.
 */
export const KIND_TEXT = {
  pending: 'En attente sur l’ancien site : confirme avec le client',
  paid: 'Acompte de {amount} payé sur l’ancien site : à la caisse, encaisse-le avec « Payé sur l’ancien site »',
  'paid:full': 'Déjà payé en entier sur l’ancien site ({amount}) : à la caisse, encaisse-le avec « Payé sur l’ancien site »',
  'paid:late': 'Acompte de {amount} payé sur l’ancien site depuis le premier import : à la caisse, encaisse-le avec « Payé sur l’ancien site »',
  'paid:fulllate': 'Payé en entier sur l’ancien site depuis le premier import ({amount}) : à la caisse, encaisse-le avec « Payé sur l’ancien site »',
  refund: 'Annulé sur l’ancien site alors qu’un acompte[ de {amount}] y était payé : rembourse-le si besoin, depuis l’ancien site',
  changed: 'Modifié sur l’ancien site depuis le premier import[ ({names})] : mis à jour ici, vérifie',
  'changed:handled': 'Modifié sur l’ancien site[ ({names})], mais déjà pris en charge ici : pas changé, vérifie',
  overlap: 'Chevauche un autre rendez-vous',
  today: 'Terminé aujourd’hui sur l’ancien site : s’il y a été encaissé, ne l’encaisse pas ici',
  moved: 'Déplacé sur l’ancien site[ : était {was}]',
  'moved:both': 'Déplacé ici et sur l’ancien site : vérifie le créneau[ (ici {was})]',
  cancelled: 'Annulé sur l’ancien site, mais déjà pris en charge ici : vérifie',
  service: 'Prestation inconnue[ : {names}] (ligne ignorée)',
  'service:upcoming': 'Prestation inconnue[ : {names}] : ce rendez-vous à venir n’est pas dans l’agenda, ajoute-le à la main',
  staff: 'À venir sans barbier actif : choisis-en un et relance l’import (ligne ignorée)',
  'staff:unknown': 'Barbier inconnu (ligne ignorée)',
  phone: 'Numéro illisible[ : « {phone} »]',
  erased: 'Client effacé à sa demande : ses lignes sont ignorées',
  'erased:retention': 'Fiche anonymisée après 3 ans sans visite : ses lignes sont ignorées',
  giftcard: 'Carte cadeau non reprise',
  'giftcard:short': 'Code trop court',
  'giftcard:expired': 'Carte expirée[ le {day}]',
  'giftcard:zero': 'Solde nul',
  pack: 'Carnet non repris',
  'pack:expired': 'Carnet expiré[ le {day}]',
  'pack:nofile': 'Aucun client avec ce numéro : ajoute son prénom',
  error: 'État « Erreur » sur l’ancien site : ignoré',
  'error:since': 'État « Erreur » sur l’ancien site depuis le premier import : rendez-vous gardé ici, vérifie avec le client',
  unpaid: 'Paiement en ligne jamais terminé sur l’ancien site : ignoré',
  retention: 'Plus de 3 ans sans visite : pas repris (règle de conservation)',
  gone: 'Supprimé sur l’ancien site : annulé ici, sans SMS',
  'gone-handled': 'Supprimé sur l’ancien site, mais déjà pris en charge ici : vérifie',
  name: 'Même numéro, autre prénom[ (« {typed} »)] : mis sur la fiche[ de {file}]. Famille ?',
  'name:fixed': 'Prénom changé sur l’ancien site[ (« {typed} »)] : gardé sur ce rendez-vous, pas sur la fiche[ de {file}]',
  'email-elsewhere': 'Cet e-mail est déjà sur la fiche[ de {other}] : pas copié',
  'new-number': 'Nouveau numéro sur l’ancien site[ pour {file}] : numéro gardé, à vérifier',
  'new-number:fixed': 'Autre numéro sur l’ancien site[ pour {file}] : mis sur la fiche (celui du rendez-vous le plus récent), vérifie',
  'new-number:edited': 'Numéro changé ici depuis la reprise[ pour {file}] : gardé tel que tu l’as mis, l’ancien site a encore l’autre',
  'new-number:detached': 'Numéro détaché ici[ pour {file}], l’ancien site en donne un : pas remis sur la fiche',
  'new-email': 'Autre e-mail sur l’ancien site[ pour {file}] : e-mail gardé, à vérifier',
  'new-email:fixed': 'E-mail corrigé sur l’ancien site[ pour {file}] : mis sur la fiche, vérifie',
  'new-email:edited': 'E-mail changé ici depuis la reprise[ pour {file}] : gardé tel que tu l’as mis, l’ancien site a encore l’autre',
  'status-unknown': 'État inconnu sur l’ancien site : ligne ignorée',
  reopened: 'Rétabli sur l’ancien site : remis dans l’agenda, vérifie le créneau',
  person: 'Même e-mail que[ {other}] mais une autre personne : fiche séparée, à vérifier',
  landline: 'Numéro fixe : pas de SMS, appelle le client pour le rappel',
  unreadable: 'Ligne que la lecture n’a pas pu comprendre',
  email: 'E-mail illisible[ : « {email} »] : pas gardé'
};
/** The kinds that ask the owner to do something (« À faire »); the rest is « Pour info ». */
export const TODO_KINDS = new Set(['pending', 'paid', 'refund', 'changed', 'overlap', 'today', 'moved', 'cancelled', 'gone-handled', 'name', 'new-number', 'new-email', 'staff', 'giftcard', 'pack', 'reopened', 'person', 'unreadable']);
/** Variants of a kind that ask something of the owner although the kind is only « Pour info »: an upcoming booking lost to its service label, a booking that turned « Erreur » after it came in. */
const TODO_VARIANTS = new Set(['service:upcoming', 'error:since']);
const isTodo = (kind, v) => TODO_KINDS.has(kind) || TODO_VARIANTS.has(kind + ':' + (v || ''));

/** The kinds about a client file rather than a booking. */
const FILE_KINDS = new Set(['name', 'new-number', 'new-email', 'email-elsewhere', 'person', 'landline']);

/** The text of a review row. @param {string} kind @param {Record<string, any>} [vars] @param {string} [v] */
export function say(kind, vars = {}, v = '') {
  const t = /** @type {Record<string, string>} */ (KIND_TEXT)[v ? kind + ':' + v : kind] ?? /** @type {Record<string, string>} */ (KIND_TEXT)[kind] ?? kind;
  const need = (g) => (g.match(/\{(\w+)\}/g) || []).every((m) => vars[m.slice(1, -1)]);
  return t.replace(/\[([^\]]*)\]/g, (_, g) => (need(g) ? g : '')).replace(/\{(\w+)\}/g, (_, k) => (vars[k] == null ? '' : String(vars[k])));
}

/** Rows keep the exact fields the schema names: a field it does not know is refused, not silently trimmed (no import can ever set a consent). */
const strict = (shape) => {
  const o = obj(shape), keys = new Set(Object.keys(shape));
  return { parse(x, p) { if (x && typeof x === 'object' && !Array.isArray(x)) for (const k of Object.keys(x)) if (!keys.has(k)) throw new InvalidInput(p ? p + '.' + k : k, 'champ inconnu'); return o.parse(x, p); } };
};
const wpId = int({ min: 1, max: 999999999999 });
const who = { first: opt(str({ max: 60 })), last: opt(str({ max: 60 })), phone: opt(str({ max: 32 })), prefix: opt(str({ max: 6 })), email: opt(str({ max: 160, lower: true })) };
/** A creation time the old site printed: any instant JavaScript can hold (a bad one is dropped by pastInstant, never a reason to refuse the batch). */
const when = () => opt(int({ min: -8640000000000000, max: 8640000000000000 }));
const clientRow = strict({ ...who, notes: opt(str({ max: 1000 })), createdAt: when(), wpUser: opt(wpId), source: opt(oneOf(['files', 'site'])) });
const apptRow = strict({
  wp: wpId, uniq: opt(str({ max: 64, pattern: /^[A-Za-z0-9]+$/ })), day: day(), start: int({ min: 0, max: 1439 }), dur: opt(int({ min: 5, max: 600 })),
  createdAt: when(), ...who, serviceIds: arr(id(), { max: 6 }), staffId: id(), price: opt(money(1000000)), paid: opt(money(1000000)),
  status: oneOf(WP_STATUS), noShow: opt(bool()), note: opt(str({ max: 300 })), wpUser: opt(wpId), source: opt(oneOf(['files', 'site'])),
  // the old site's names for the services the owner left unmatched (a service name is not personal): the report says which
  wpServices: opt(arr(str({ max: 80 }), { max: 6 }))
});
const giftRow = strict({ code: str({ min: 1, max: 40 }), amount: money(100000), expires: opt(day()), buyer: opt(str({ max: 60 })), recipient: opt(str({ max: 60 })) });
const packRow = strict({ ...who, clientId: opt(id()), left: int({ min: 1, max: 50 }), expires: day(), serviceId: opt(id()) });
export const batchSchema = obj({
  clients: opt(arr(clientRow, { max: 150 })), appts: opt(arr(apptRow, { max: 150 })), giftcards: opt(arr(giftRow, { max: 150 })), packs: opt(arr(packRow, { max: 150 })),
  // the bookings the old site no longer has (the browser's call, see wpimport.ts), the run this batch belongs to and its place in it
  gone: opt(arr(wpId, { max: 150 })), run: opt(id()), i: opt(int({ min: 0, max: 100000 }))
});
const oneGift = obj({ code: opt(str({ max: 40 })), amount: money(100000), expires: day(), buyer: opt(str({ max: 60 })), recipient: opt(str({ max: 60 })) });
const onePack = obj({ clientId: id(), left: int({ min: 1, max: 50 }), expires: day(), serviceId: opt(id()) });

const count = int({ min: 0, max: 1000000 });
const startSchema = obj({
  source: oneOf(['files', 'site']),
  // at: the file's own date, newest: the newest creation time among its bookings (ms): how fresh an export is (Jour J compares it to the freeze)
  files: arr(obj({ name: str({ max: 80 }), kind: str({ max: 20 }), rows: count, sha: str({ max: 16, pattern: /^[0-9a-f]*$/ }), at: opt(int({ min: 0, max: 8640000000000000 })), newest: opt(int({ min: 0, max: 8640000000000000 })) }), { max: 30 }),
  window: arr(obj({ from: day(), to: day() }), { max: 12 }),
  map: obj({ services: record(/^.{0,80}$/, id(), { max: 300 }), staff: record(/^.{0,80}$/, id(), { max: 100 }) }),
  totals: obj({ bookings: count, clients: count, giftcards: count, packs: count }),
  // by: what was left out, per kind of record (the table's « Hors conservation » column); the four reasons count people (retention, noVisit) or rows
  excluded: obj({ retention: count, noVisit: count, duplicate: count, unreadable: count, by: opt(obj({ bookings: count, clients: count, giftcards: count, packs: count })) }),
  // people whose every row is ignored because their file was erased (the Clients row's « Ignorés »)
  skippedPeople: opt(count),
  // the old site's address for a site run, never a login
  site: opt(obj({ url: str({ max: 200 }) })),
  // how many batches the browser plans, to say « interrompue à 3/12 » when it stops
  parts: opt(int({ min: 0, max: 5000 })),
  // the lines nobody could read (file, line, WordPress number, the bad value), kept so the report lists them: 500 at most, the count stays exact
  problems: opt(arr(obj({ file: str({ max: 80 }), line: int({ min: 0, max: 100000000 }), wp: opt(wpId), text: str({ max: 160 }) }), { max: 500 }))
});

/* ---------------- what the state does not index: e-mails, legacy packs, the old barbers' profile ---------------- */

// rebuilt lazily when the journal moved, so a batch of 150 rows never scans every client 150 times
const lazy = new WeakMap();
function known(s) {
  let x = lazy.get(s);
  if (!x || x.v !== s.version) {
    x = { v: s.version, email: new Map(), wp: new Map(), packs: new Set(), legacyStaff: /** @type {string|null} */ (null), legacyService: /** @type {string|null} */ (null) };
    for (const c of s.clients.values()) {
      if (c.erased || c.mergedInto) continue;
      if (c.email && !x.email.has(c.email)) x.email.set(c.email, c.id);
      if (c.ext && c.ext.wp && !x.wp.has(c.ext.wp)) x.wp.set(c.ext.wp, c.id);
    }
    for (const k of s.packs.values()) if (k.legacy) x.packs.add(k.clientId);
    for (const st of s.staff.values()) if (st.legacy) x.legacyStaff = st.id;
    for (const sv of s.services.values()) if (sv.legacy) x.legacyService = sv.id;
    lazy.set(s, x);
  }
  return x;
}

/**
 * Is there already a client file for this person? 'salon' is the preview's 'fusionnés' (as the batch counts them),
 * 'wordpress' a file an earlier run created, 'erased' someone whose file was erased (the batch skips their older rows).
 * @returns {'salon'|'wordpress'|'erased'|null}
 */
export function knownClient(s, x, tombKey = '') {
  const phone = x.phone ? normPhoneImport(x.phone, x.prefix) : null;
  const email = x.email && isEmail(String(x.email).toLowerCase()) ? String(x.email).toLowerCase() : '';
  const cid = (x.wpUser && known(s).wp.get(x.wpUser)) || (phone && s.clientByPhone.get(phone)) || (email && known(s).email.get(email)) || null;
  if (!cid) return rowTomb(s, x, tombKey) ? 'erased' : null;
  return getClient(s, cid).source === 'wordpress' ? 'wordpress' : 'salon';
}

/** The tombstone of an erased file this row's number or e-mail matches (clients.js erasedTomb), or null. */
export function rowTomb(s, x, tombKey) {
  const phone = x.phone ? normPhoneImport(x.phone, x.prefix) : null;
  const email = x.email && isEmail(String(x.email).toLowerCase()) ? String(x.email).toLowerCase() : '';
  return erasedTomb(s, tombKey, phone, email);
}

/** The number a row gives, normalised (null: none, or unreadable), and its e-mail (lower case, '' when it cannot be one). */
const phoneOf = (x) => (x.phone ? normPhoneImport(x.phone, x.prefix) : null);
const emailOf = (x) => (x.email && isEmail(String(x.email).toLowerCase()) ? String(x.email).toLowerCase() : '');

/**
 * What the old site now says about the person of a booking (number, e-mail, last name), set against the file the booking is on, once an
 * earlier run made or met that file. Only an import's own gift is ever replaced: c.wpPhone and c.wpEmail (personal data, so kept in pii; no
 * view shows them) are the number and the e-mail an import last gave the file. A file still holding them was not touched here, so it follows
 * the old site (the booking with the highest WordPress number speaks, ext.pw and ext.ew: two bookings never undo each other). A number or an
 * e-mail the owner changed or took away since, and a number detached for good (phoneDetachedAt), are never put back, only listed. A file
 * with no such memory (a salon's file, a run from before the memory) takes what it lacks and is otherwise only listed.
 * Read only: the batch and the preview (priorView) decide the same way.
 * @param {any} c the file
 * @param {{ phone: string|null, pw: number, email: string, ew: number, last?: string }} w the old site's, from the rows that speak for the file
 * @param {{ phone: (p: string) => string|undefined, email: (e: string) => string|undefined }} taken the file that already holds a number, an e-mail
 * @returns {{ fill: Record<string, string>, gave: Record<string, string>, ext: Record<string, number>, lines: { of: 'phone'|'email', kind: string, v?: string, o?: string }[] }}
 * fill: what goes on the file; gave: what the file remembers having been given (pii); ext: the counters; lines: what to say
 */
export function judge(c, w, taken) {
  const fill = /** @type {Record<string, string>} */ ({}), gave = /** @type {Record<string, string>} */ ({}), ext = /** @type {Record<string, number>} */ ({}), lines = /** @type {any[]} */ ([]);
  const mem = c.ext || {};
  if (w.last && !c.last) fill.last = capFirst(w.last).slice(0, 40);
  if (w.phone && w.phone !== c.phone) {
    const other = taken.phone(w.phone), said = w.phone === c.wpPhone;
    if (other && other !== c.id) lines.push({ of: 'phone', kind: 'new-number' });
    // the owner took the number off this file for good: the old site still has it, and it does not come back
    else if (c.phoneDetachedAt) { if (!said) lines.push({ of: 'phone', kind: 'new-number', v: 'detached' }); }
    else if (!c.wpPhone) { if (!c.phone) { fill.phone = w.phone; gave.wpPhone = w.phone; } else lines.push({ of: 'phone', kind: 'new-number' }); }
    else if (c.phone === c.wpPhone) { if (!((mem.pw || 0) >= w.pw)) { fill.phone = w.phone; gave.wpPhone = w.phone; ext.pw = w.pw; lines.push({ of: 'phone', kind: 'new-number', v: 'fixed' }); } }
    else lines.push({ of: 'phone', kind: 'new-number', ...(said ? { v: 'edited' } : {}) });
  }
  if (w.email && w.email !== String(c.email || '').toLowerCase()) {
    const other = taken.email(w.email), said = w.email === c.wpEmail;
    if (other && other !== c.id) { if (c.email) lines.push({ of: 'email', kind: 'email-elsewhere', o: other }); }
    else if (!c.wpEmail) { if (!c.email) { fill.email = w.email; gave.wpEmail = w.email; } else lines.push({ of: 'email', kind: 'new-email' }); }
    else if (String(c.email || '').toLowerCase() === c.wpEmail) { if (!((mem.ew || 0) >= w.ew)) { fill.email = w.email; gave.wpEmail = w.email; ext.ew = w.ew; lines.push({ of: 'email', kind: 'new-email', v: 'fixed' }); } }
    else lines.push({ of: 'email', kind: 'new-email', ...(said ? { v: 'edited' } : {}) });
  }
  return { fill, gave, ext, lines };
}

/**
 * The name a booking keeps after a pass, when the row types a first name that is not the file's (a father booking for his sons) or corrects
 * the one it had: null when nothing changes. now: the file's number once the pass is through (the same number is what makes it the same person).
 * fixed: the booking already carried another name, so the old site corrected it rather than a second person booking.
 * @param {any} c the file, or null when the booking has none @param {any} a the booking @param {any} x the row @param {string} now
 * @returns {{ name: string, fixed: boolean }|null}
 */
function nameFor(c, a, x, now) {
  const typed = [x.first, x.last].filter(Boolean).join(' ').slice(0, 40);
  if (!c) return typed && typed !== a.name ? { name: typed, fixed: false } : null;
  const phone = phoneOf(x);
  if (x.first && c.first && c.first !== 'Client' && (!phone || phone === now)) {
    const p = fold(x.first), q = fold(c.first);
    if (p && q && !p.startsWith(q) && !q.startsWith(p) && typed !== a.name) return { name: typed, fixed: !!a.name };
  }
  return null;
}

/**
 * What a pass would change on the person of an imported booking, for the preview (the same rules as revisit() below, one row at a time). Only
 * a booking nobody handled here is revisited. fix: the words for what is on the booking's own row (note, nom, prénom). A number and an e-mail
 * come from the booking with the highest WordPress number of the file, which no single row knows: who gives, for the file (cid), whether this
 * row has a number and an e-mail (0 none, 1 nothing to change, 2 the file would take it), and the browser keeps the row with the highest number
 * (lib/wpimport.ts applyFixes).
 * @param {any} s @param {any} a the booking @param {any} x the row (wp, first, last, phone, prefix, email, note)
 * @returns {{ fix: string[], who?: { cid: string, phone: 0|1|2, email: 0|1|2 } }}
 */
function fixOf(s, a, x) {
  if (!isOpen(a) || movedHere(a)) return { fix: [] };
  const fix = [];
  // the old site's note, when the booking does not hold it yet (carry() adds it)
  if (x.note && !String(a.note || '').includes(x.note.slice(0, 100))) fix.push('note');
  if (!a.clientId) { if (nameFor(null, a, x, '')) fix.push('prénom'); return { fix }; }
  const c = getClient(s, a.clientId);
  if (c.erased) return { fix };
  const j = judge(c, { phone: phoneOf(x), pw: x.wp, email: emailOf(x), ew: x.wp, last: x.last }, { phone: (p) => s.clientByPhone.get(p), email: (e) => known(s).email.get(e) });
  if (j.fill.last) fix.push('nom');
  if (nameFor(c, a, x, j.fill.phone || c.phone)) fix.push('prénom');
  return { fix, who: { cid: c.id, phone: !phoneOf(x) ? 0 : j.fill.phone ? 2 : 1, email: !emailOf(x) ? 0 : j.fill.email ? 2 : 1 } };
}

/**
 * Where the bookings an earlier run brought in stand now, for the wizard's preview of a delta run (the same rules
 * as delta() below decide; this only reads). open: nobody handled it here yet; movedHere: moved in the agenda since; live: still in the
 * agenda and not paid at the till (a deposit paid on the old site since can still be taken); late: a past visit taken over as done (the WXR can turn it into a no-show); uniq, note: the booking already has the old
 * e-mails' link secret, a note. `who`: the identity the files give those bookings, so fix and who say what a pass would change on the person
 * (numéro, e-mail, nom, prénom, note): without it the preview could call a run « rien de nouveau » that still corrects a number.
 * @param {any} s @param {number[]} wps @param {{ wp: number, first?: string, last?: string, phone?: string, prefix?: string, email?: string, note?: string }[]} [who]
 */
export function priorView(s, wps, who = []) {
  const rows = new Map(who.map((r) => [r.wp, r]));
  const out = [];
  for (const w of wps) {
    const a = s.appts.get(s.apptByWp.get(String(w)) || '');
    if (!a) continue;
    const x = a.ext || {};
    // price, services and deposit as the old site last said them (what the preview compares the new export to), and whether a deposit can still be cashed
    out.push({ wp: w, day: a.day, start: a.start, dur: a.dur, staffId: a.staffId, status: a.status, open: isOpen(a), movedHere: movedHere(a), cancelledByImport: cancelledByImport(a), price: x.wpPrice ?? a.price, paid: x.paid || 0, svc: x.wpSvc ?? sortedIds(a.services.map((v) => v.id)), live: ACTIVE.has(a.status) && !a.saleId && !a.legacy, late: !!a.legacy && a.status === 'done' && !a.saleId, uniq: !!x.uniq, note: !!a.note, ...(rows.has(w) ? fixOf(s, a, rows.get(w)) : { fix: [] }) });
  }
  return out;
}
/** Nobody handled it here yet: not checked in, not paid, not a closed visit of the old site. */
const isOpen = (a) => (a.status === 'booked' || a.status === 'pending') && !a.saleId && !a.legacy;
const movedHere = (a) => a.moves > ((a.ext && a.ext.moves) || 0);
/** Cancelled by this import itself (« Annulé » or « Supprimé sur l’ancien site », by the salon), and never paid: the old site may confirm it again. */
const cancelledByImport = (a) => a.status === 'cancelled' && !a.saleId && !!a.cancel && a.cancel.by === 'salon' && IMPORT_CANCELS.has(a.cancel.reason);

/**
 * The imported bookings still to come inside the periods a file covers: what the browser compares to the export to find
 * the ones the old site deleted. At most 5 000.
 * @param {any} s @param {{ from: string, to: string }[]} windows @param {string} today
 */
export function inWindow(s, windows, today) {
  const out = [];
  for (const [wp, aid] of s.apptByWp) {
    const a = s.appts.get(aid);
    if (!a || a.day < today || !windows.some((w) => a.day >= w.from && a.day <= w.to)) continue;
    out.push({ wp: Number(wp), day: a.day, start: a.start, staffId: a.staffId, status: a.status, open: isOpen(a) && !movedHere(a) });
    if (out.length >= 5000) break;
  }
  return out;
}

/**
 * Which of these cards and carnets are already here, for a second drop of the same file: the indexes of the codes whose card exists, and of
 * the numbers whose client already has a carnet taken over. Read only.
 * @param {any} s @param {string[]} [codes] @param {{ phone?: string, prefix?: string }[]} [packs]
 */
export function haveView(s, codes = [], packs = []) {
  const cards = [], carnets = [];
  codes.forEach((c, i) => { const n = normGiftCode(c); if (n.length >= 4 && s.giftByHash.has(sha256(n))) cards.push(i); });
  packs.forEach((k, i) => { const p = k.phone ? normPhoneImport(k.phone, k.prefix) : null; const cid = p && s.clientByPhone.get(p); if (cid && known(s).packs.has(cid)) carnets.push(i); });
  return { cards, carnets };
}

/** The agenda's active bookings on these days, so the preview checks double bookings against it as the batch does. @param {any} s @param {string[]} days */
export function busyView(s, days) {
  const out = [];
  for (const d of days) for (const aid of s.apptsByDay.get(d) || []) {
    const a = s.appts.get(aid);
    if (a && ACTIVE.has(a.status)) out.push({ day: a.day, staffId: a.staffId, start: a.start, dur: a.dur });
  }
  return out;
}

/** WordPress time of creation, kept only when it makes sense (not in the future, not before the plugin existed). */
const pastInstant = (t, now) => (t && t > 1262304000000 && t <= now ? t : undefined);

const fold = (t) => String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
const fileName = (c) => (c.erased ? 'Client effacé' : [c.first, c.last].filter(Boolean).join(' '));

/**
 * One run's view of the clients: the state plus the files created earlier in the same batch. A row is matched to a
 * file by the WordPress customer id first (the number may have changed), then the number, then the e-mail.
 * @param {any} s @param {import('../core/engine.js').Ctx} ctx @param {any} out @param {string} [rid] the run this batch belongs to
 */
function people(s, ctx, out, rid) {
  const byPhone = new Map(), byEmail = new Map(), byWp = new Map(), created = new Set(), touched = new Set(), told = new Set();
  /** the files this batch made (not in the state yet), by id */
  const made = new Map();
  const file = (cid) => made.get(cid) || getClient(s, cid);
  /** every file this batch made or met, once each */
  const met = new Set();
  /** the oldest creation time the old site gave for the rows of a file (« client depuis »): applied once, at the end of the batch */
  const earliest = new Map();
  /** the files whose gaps were already filled in by this batch (once each) */
  const filled = new Set();
  const K = known(s);
  const run = rid ? { run: rid } : {};
  /** the rows that speak for a file in this batch (see speak()): its number and its e-mail come from the booking with the highest WordPress number */
  const lead = /** @type {Map<string, { phone?: any, email?: any }>} */ (new Map());
  /** who already holds a number or an e-mail: a file of this batch, then the state */
  const taken = { phone: (p) => byPhone.get(p) || s.clientByPhone.get(p), email: (e) => byEmail.get(e) || K.email.get(e) };
  /**
   * Was this person's file erased (at their request, or after 3 years without a visit)? Then none of their rows from
   * before comes back: not the file, not a booking under their name. Said once per person, without the name.
   * A row the old site created after the erasure is someone who came back (booked again there): it comes in.
   */
  function gone(x, row) {
    const phone = phoneOf(x), email = emailOf(x);
    const tomb = rowTomb(s, x, ctx.meta.tombKey);
    if (!tomb || (x.createdAt && x.createdAt > tomb.at)) return false;
    const why = tomb.why;
    // a row with both the number and the e-mail ties them: the rows that carry only one are the same person
    if (!(phone && told.has(phone)) && !(email && told.has(email))) {
      for (const k of [phone, email]) if (k) told.add(k);
      const { name, ...where } = row;
      out.review.push({ ...where, kind: 'erased', text: say('erased', {}, why === 'retention' ? 'retention' : ''), ...(why === 'retention' ? { v: 'retention' } : {}) });
    }
    return true;
  }
  /** The file this row belongs to, if there is one (nothing is written). @returns {{ cid: string, via: 'wp'|'phone'|'email' }|null} */
  function lookup(x) {
    const phone = phoneOf(x), email = emailOf(x);
    const w = x.wpUser && (byWp.get(x.wpUser) || K.wp.get(x.wpUser));
    if (w) return { cid: file(w).id, via: 'wp' };
    const p = phone && (byPhone.get(phone) || s.clientByPhone.get(phone));
    if (p) return { cid: file(p).id, via: 'phone' };
    const e = email && (byEmail.get(email) || K.email.get(email));
    return e ? { cid: file(e).id, via: 'email' } : null;
  }
  /**
   * @param {any} x the row @param {any} row where it comes from, for the review list
   * @param {{ named?: boolean }} [note] set when the row's first name is not the file's (the booking keeps the typed name)
   * @returns {string|null} the client id, null when the row has neither a usable number nor an e-mail (or the person was erased)
   */
  function find(x, row, note = {}) {
    if (gone(x, row)) return null;
    const phone = phoneOf(x);
    if (x.phone && !phone) out.review.push({ ...row, kind: 'phone', text: say('phone', { phone: x.phone }) });
    const email = x.email && isEmail(x.email) ? x.email : '';
    // an address that cannot be one (a `?bcc=` in it, two addresses in one cell) is not kept, and said
    if (x.email && !email) out.review.push({ ...row, kind: 'email', text: say('email', { email: String(x.email).slice(0, 60) }) });
    const hit0 = lookup(x);
    // two people on one e-mail (a couple, a parent and a child, the desk's dummy address): this row has a number the file does not,
    // the file has another, and the first names differ: not the same person. The e-mail stays on the first file, this one is apart
    const apart = !!hit0 && hit0.via === 'email' && !!phone && sameEmailOtherPerson(hit0.cid, x, phone);
    const hit = apart ? null : hit0;
    let cid = hit ? hit.cid : null;
    if (hit) {
      const c = file(hit.cid);
      meet(cid);
      // the e-mail the old site gives for this number is already another client's: not copied (first file wins)
      const other = email && (byEmail.get(email) || K.email.get(email));
      const elsewhere = other && file(other).id !== cid ? file(other).id : null;
      if (elsewhere) out.review.push({ ...row, kind: 'email-elsewhere', text: say('email-elsewhere', { other: fileName(file(elsewhere)) }), cid, o: elsewhere });
      // the old site may know what the file lacks: never overwrite, only fill in (once per file and batch). Not what the owner took away: a
      // number detached for good, an e-mail or a number an import gave and that is gone now (the file remembers: wpPhone, wpEmail)
      if (!filled.has(cid)) {
        filled.add(cid);
        const fill = {}, gave = {}, patch = {};
        if (email && !c.email && !c.wpEmail && !byEmail.has(email) && !elsewhere) { fill.email = email; gave.wpEmail = email; }
        if (phone && !c.phone && !c.wpPhone && !c.phoneDetachedAt && !s.clientByPhone.has(phone) && !byPhone.has(phone)) { fill.phone = phone; gave.wpPhone = phone; }
        if (x.last && !c.last) fill.last = capFirst(x.last).slice(0, 40);
        if (x.wpUser && !(c.ext && c.ext.wp) && !created.has(cid)) patch.ext = { ...(c.ext || {}), wp: x.wpUser };
        if (Object.keys(fill).length || Object.keys(patch).length) ctx.emit('client.updated', { id: cid, cid, patch, fields: Object.keys(fill), ...run }, Object.keys(fill).length ? { ...fill, ...gave } : undefined);
      }
      // same number, other first name (a father booking for his sons): the booking keeps the name that was typed
      if (hit.via === 'phone' && x.first && c.first && c.first !== 'Client' && !c.erased) {
        const a = fold(x.first), b = fold(c.first);
        if (a && b && !a.startsWith(b) && !b.startsWith(a)) {
          note.named = true;
          out.review.push({ ...row, kind: 'name', text: say('name', { typed: capFirst(x.first), file: fileName(c) }), cid });
        }
      }
      // the customer id is the same person, the number is not: kept as it was, for a look
      if (hit.via === 'wp' && phone && c.phone && c.phone !== phone) out.review.push({ ...row, kind: 'new-number', text: say('new-number', { file: fileName(c) }), cid });
      if (phone) byPhone.set(phone, cid);
      if (email && !elsewhere) byEmail.set(email, cid);
      if (x.wpUser) byWp.set(x.wpUser, cid);
      return cid;
    }
    if (!phone && !email) return null;
    cid = ctx.id('cl');
    const mail = apart ? '' : email;
    // wpPhone, wpEmail: what this import gave the file, so a later pass tells the old site's correction from the owner's edit (judge)
    const pii = { first: capFirst(x.first || '').slice(0, 40) || 'Client', last: capFirst(x.last || '').slice(0, 40), phone: phone || '', email: mail, ...(x.notes ? { notes: x.notes } : {}), ...(phone ? { wpPhone: phone } : {}), ...(mail ? { wpEmail: mail } : {}) };
    const ext = { ...run, ...(x.wpUser ? { wp: x.wpUser } : {}) };
    const born = pastInstant(x.createdAt, ctx.now);
    // consent: service texts yes (they booked with their number), promotions no, and nobody ever asked on the old site: marketingSrc says so
    ctx.emit('client.added', { id: cid, cid, source: 'wordpress', sms: true, marketing: false, marketingSrc: 'wordpress', marketingAt: ctx.now, tags: [], createdAt: born, ...(Object.keys(ext).length ? { ext } : {}) }, pii);
    created.add(cid);
    filled.add(cid);
    met.add(cid);
    made.set(cid, { id: cid, first: pii.first, last: pii.last, phone: pii.phone, email: mail, ext, source: 'wordpress', createdAt: born || ctx.now, ...(phone ? { wpPhone: phone } : {}), ...(mail ? { wpEmail: mail } : {}) });
    out.clients.added++;
    if (apart && hit0) out.review.push({ ...row, kind: 'person', text: say('person', { other: fileName(file(hit0.cid)) }), cid, o: hit0.cid });
    if (phone && isLandline(phone)) out.review.push({ ...row, kind: 'landline', text: say('landline'), cid });
    if (phone) byPhone.set(phone, cid);
    if (mail) byEmail.set(mail, cid);
    if (x.wpUser) byWp.set(x.wpUser, cid);
    return cid;
  }
  /**
   * A booking an earlier run brought in, seen again while nobody handled it here: what the old site corrected about the person. What the file
   * lacks (an e-mail, a last name, a number) is filled in, as find() does; a number or an e-mail it still holds from an import follows the old
   * site, and one the owner changed or took away is kept and listed (judge()). It is decided once per file and batch, by the rows that speak for
   * it (speak()): the booking with the highest WordPress number, whatever the order of the rows. A first name that is not the file's stays on
   * the booking, and is said (the family case, or the old site's correction).
   * @param {any} x the row @param {any} row where it comes from, for the review list @param {any} a the booking in the state
   * @returns {{ name?: string, touched: boolean }} name: the name the booking keeps now
   */
  function revisit(x, row, a) {
    const res = /** @type {{ name?: string, touched: boolean }} */ ({ touched: false });
    if (!a.clientId) {
      // no file: the booking keeps the name the old site gives, corrected when it was
      const n = nameFor(null, a, x, '');
      if (n) { res.name = n.name; res.touched = true; }
      return res;
    }
    const cid = file(a.clientId).id, c = file(cid);
    if (c.erased) return res;
    let now = c.phone;
    if (!filled.has(cid)) {
      filled.add(cid);
      if (!lead.has(cid)) speak(cid, x);
      const sp = lead.get(cid) || {};
      const j = judge(c, { phone: sp.phone ? phoneOf(sp.phone) : null, pw: sp.phone ? sp.phone.wp : 0, email: sp.email ? emailOf(sp.email) : '', ew: sp.email ? sp.email.wp : 0, last: x.last }, taken);
      for (const l of j.lines) {
        const at = (l.of === 'phone' ? sp.phone : sp.email) || x;
        const where = { wp: at.wp, day: at.day, start: at.start, name: [at.first, at.last].filter(Boolean).join(' ') };
        out.review.push({ ...where, kind: l.kind, text: say(l.kind, { file: fileName(c), other: l.o ? fileName(file(l.o)) : '' }, l.v), ...(l.v ? { v: l.v } : {}), cid, ...(l.o ? { o: l.o } : {}) });
      }
      const pii = { ...j.fill, ...j.gave };
      if (Object.keys(j.fill).length || Object.keys(j.ext).length) {
        ctx.emit('client.updated', { id: cid, cid, patch: Object.keys(j.ext).length ? { ext: { ...(c.ext || {}), ...j.ext } } : {}, fields: Object.keys(j.fill), ...run }, Object.keys(pii).length ? pii : undefined);
        res.touched = true;
        if (j.fill.phone) { now = j.fill.phone; byPhone.set(j.fill.phone, cid); if (c.phone && byPhone.get(c.phone) === cid) byPhone.delete(c.phone); }
        if (j.fill.email) byEmail.set(j.fill.email, cid);
      }
    }
    // the same number, another first name (a father booking for his sons): the booking keeps the name that was typed
    const n = nameFor(c, a, x, now);
    if (n) {
      res.name = n.name; res.touched = true;
      out.review.push({ ...row, kind: 'name', text: say('name', { typed: capFirst(x.first), file: fileName(c) }, n.fixed ? 'fixed' : ''), ...(n.fixed ? { v: 'fixed' } : {}), cid });
    }
    return res;
  }
  /**
   * A booking that revisit() will go through speaks for its file: of the rows of the batch that do, the one with the highest WordPress
   * number gives the number, and the one that gives an e-mail with the highest gives that (the newest booking is the latest word of the
   * client), so the file ends the same whatever the order of the rows.
   */
  function speak(cid, x) {
    const l = lead.get(cid) || {};
    if (phoneOf(x) && !(l.phone && l.phone.wp >= x.wp)) l.phone = x;
    if (emailOf(x) && !(l.email && l.email.wp >= x.wp)) l.email = x;
    lead.set(cid, l);
  }
  /** Is the file this e-mail leads to somebody else? It has another number than the row's, and another first name. */
  function sameEmailOtherPerson(cid, x, phone) {
    const c = file(cid);
    if (c.erased || !c.phone || c.phone === phone || !x.first || !c.first || c.first === 'Client') return false;
    if (s.clientByPhone.has(phone) || byPhone.has(phone)) return false;
    const a = fold(x.first), b = fold(c.first);
    return !!a && !!b && !a.startsWith(b) && !b.startsWith(a);
  }
  /** The row of this file was made on the old site at t: « client depuis » is the oldest of them (rows come most recent first). */
  function since(cid, t) {
    if (!cid || !t) return;
    if (!earliest.has(cid) || t < /** @type {number} */ (earliest.get(cid))) earliest.set(cid, t);
  }
  /** End of the batch: the files an import made get the oldest creation time known for them, when it is older than theirs. */
  function settle() {
    for (const [cid, t] of earliest) {
      const c = file(cid);
      if (!c || c.erased || c.source !== 'wordpress') continue;
      const cur = made.has(cid) ? made.get(cid).createdAt : c.createdAt;
      if (cur && t < cur) { ctx.emit('client.updated', { id: cid, cid, patch: { createdAt: t }, fields: [], ...run }); if (made.has(cid)) made.get(cid).createdAt = t; }
    }
  }
  /** A file met: counted once for the batch, as merged (a file of the salon) or again (one an earlier run made). Also for a booking carried over by a re-run. */
  function meet(cid) {
    if (!cid) return;
    const c = file(cid);
    if (created.has(c.id) || touched.has(c.id)) return;
    touched.add(c.id);
    met.add(c.id);
    if (c.source !== 'wordpress') { if (!out.clients.merged.includes(c.id)) out.clients.merged.push(c.id); } else out.again.add(c.id);
  }
  /** Does this person already have a file (in the salon, or made earlier in this batch)? */
  const has = (x) => !!lookup(x);
  return { find, revisit, speak, gone, has, meet, created, met, since, settle };
}

/** The old barbers who left (John, JBlades…): one archived profile without a chair (out of the team's figures), created when first needed. */
function legacyStaff(s, ctx, run) {
  if (run.legacyStaff) return run.legacyStaff;
  const have = known(s).legacyStaff;
  if (have) return (run.legacyStaff = have);
  const sid = ctx.id('st');
  ctx.emit('staff.added', { id: sid, staff: { name: 'Ancien barbier', role: 'barber', legacy: true, color: '#8A857D', initials: 'AB', bookable: false, chair: false, services: 'all', schedule: {}, commission: { service: 0, product: 0 }, order: 99 } });
  ctx.emit('staff.archived', { id: sid });
  return (run.legacyStaff = sid);
}

/**
 * The old services nobody matched (a one-off, a formula that is gone, a label nobody can read): one archived service, « Ancienne prestation »,
 * out of the catalogue and the site, created when first needed. A visit on it counts for the client's rhythm and spend, never for a chair.
 */
function legacyService(s, ctx, run) {
  if (run.legacyService) return run.legacyService;
  const have = known(s).legacyService;
  if (have) return (run.legacyService = have);
  const sid = ctx.id('sv');
  ctx.emit('service.added', { id: sid, service: { name: 'Ancienne prestation', short: 'Ancienne prestation', slug: 'ancienne-prestation', category: 'Autres', price: 0, dur: 30, buffer: 0, online: false, vat: s.settings.payments.vat, order: 999, from: false, includes: [], legacy: true } });
  ctx.emit('service.archived', { id: sid });
  return (run.legacyService = sid);
}
/** A service of the state, or the stand-in for LEGACY_SERVICE (the real one is only created once a booking really uses it). */
const serviceOf = (s, sid) => (sid === LEGACY_SERVICE ? { id: LEGACY_SERVICE, name: 'Ancienne prestation', price: 0, dur: 30, buffer: 0, from: false } : s.services.get(sid));

/**
 * What a WordPress booking becomes here, or null when it is not worth keeping.
 * Past: confirmed, paid, pay later or pending → done; cancelled → cancelled; no-show (WXR) → no_show; error and an
 * unpaid deposit → skipped. Upcoming: cancelled → cancelled, everything else → booked. An upcoming 'En attente' is
 * booked too, not 'pending': here 'pending' means an online deposit being paid, which the scheduler cancels after
 * its window, so the client would lose the slot minutes after the import. It goes to the review list instead.
 */
export function mapStatus(st, noShow, past) {
  if (st === 'error') return null;
  if (st === 'canceled') return 'cancelled';
  if (!past) return 'booked';
  if (noShow) return 'no_show';
  if (st === 'pendingpayment') return null;
  return 'done';
}

function uniqueCode(s, ctx, taken) {
  for (let i = 0; i < 30; i++) { const c = ctx.code('LA'); if (!s.apptByCode.has(c) && !taken.has(c)) { taken.add(c); return c; } }
  const c = ctx.code('LA') + ctx.id('').slice(-2).toUpperCase();
  taken.add(c);
  return c;
}

/** The services of an old booking, priced so they add up to what the client paid (or the menu price without one). */
function snapshot(s, ids, total) {
  const list = ids.map((sid) => serviceOf(s, sid)).map((sv) => ({ id: sv.id, name: sv.name, price: sv.price, from: !!sv.from, dur: sv.dur, buffer: sv.buffer || 0 }));
  if (total == null) return list;
  const menu = list.reduce((t, x) => t + x.price, 0);
  let left = total;
  return list.map((x, i) => {
    const p = i === list.length - 1 ? left : menu ? Math.round((total * x.price) / menu) : Math.floor(total / list.length);
    left -= p;
    return { ...x, price: p };
  });
}

/** One row of the review list: its text from KIND_TEXT, plus the variant that was used (the report rebuilds the same words). */
function note(out, row, kind, vars = {}, v = '') { out.review.push({ ...row, kind, text: say(kind, vars, v), ...(v ? { v } : {}), ...(kind === 'changed' && vars.names ? { names: vars.names } : {}) }); }

const fmtDay = (k) => dayShort(k) + ' ' + k.slice(0, 4);
const fmtSlot = (a, s) => dayShort(a.day) + ' ' + fmtTime(a.start) + ' · ' + ((s.staff.get(a.staffId) || {}).name || '?');
/** An upcoming booking needs a chair here: one the agenda draws and the online booking sees as taken. */
const chairOf = (s, sid) => { const st = s.staff.get(sid); return st && st.active && st.chair && !st.legacy ? st : null; };

/** Bookings of the run and of the agenda on one chair and day, to report a double booking (rules are skipped). */
function overlaps(s, mine, b, ignore) {
  const others = [...(s.apptsByDay.get(b.day) || [])].map((aid) => s.appts.get(aid)).filter((x) => x && x.id !== ignore && x.staffId === b.staffId && ACTIVE.has(x.status)).concat(mine.get(b.day + '|' + b.staffId) || []);
  const hit = others.some((x) => x.start < b.start + b.dur && b.start < x.start + x.dur);
  mine.set(b.day + '|' + b.staffId, [...(mine.get(b.day + '|' + b.staffId) || []), { start: b.start, dur: b.dur }]);
  return hit;
}

/** The deposit sentence at the start of an upcoming booking's note, as the first run wrote it: a new amount replaces it, the rest of the note stays. */
const PAID_NOTE = /^(?:Déjà payé en entier sur l’ancien site \([^)]*\)|Acompte de [^·]*? déjà payé sur l’ancien site)(?: · |$)/;
const paidNote = (paid, price) => (paid ? (paid >= price ? 'Déjà payé en entier sur l’ancien site (' + fmtEur(paid) + ')' : 'Acompte de ' + fmtEur(paid) + ' déjà payé sur l’ancien site') : '');
const sortedIds = (ids) => [...ids].sort().join(',');

/**
 * The cut-over day's re-run, for a booking a first run already brought in: what the old site changed since is carried
 * over (cancelled, moved, taken place; for one still to come also its price and services, the deposit paid since, its note,
 * the corrected number and name, see carry), but only while nobody handled it here (checked in, paid, moved in the agenda);
 * otherwise it is listed for a look. What the first run lacked (often the CSV alone) is filled in: link secret, note.
 * @returns {'cancelled'|'moved'|'closed'|'changed'|'updated'|'already'}
 */
function delta(s, ctx, r, a, row, run) {
  const out = run.out, today = ctx.local.day, tag = run.tag;
  const ext = a.ext || {};
  const status = mapStatus(r.status, !!r.noShow, instantOf(r.day, r.start + (r.dur || a.dur)) <= ctx.now);
  const open = isOpen(a);
  const moved = movedHere(a);
  // the slot the old site gave last time: tells a move made there from one made only here
  const wpSlot = r.day + '|' + r.start;
  const wpMoved = ext.slot ? ext.slot !== wpSlot : true;
  const patch = {}, pii = {};
  const ext2 = { ...ext };
  if (r.uniq && !ext.uniq) ext2.uniq = sha256(r.uniq.toLowerCase());
  if (r.note && !a.note) pii.note = r.note.slice(0, 300);
  let did = /** @type {'cancelled'|'moved'|'closed'|'changed'|'updated'|'already'} */ ('already');
  /** where the booking stands once this run is through (a longer visit may now run into the next one) */
  let slot = { day: a.day, start: a.start, staffId: a.staffId };
  if (open && status === 'cancelled') {
    ctx.emit('appt.cancelled', { id: a.id, by: 'salon', reason: CANCEL_REASON, cid: a.clientId || undefined, ...tag });
    // a deposit paid there: nothing gives it back on its own, the client may be owed it
    const prepaid = Math.max(ext.paid || 0, r.paid || 0);
    if (prepaid) { ext2.paid = prepaid; note(out, row, 'refund', { amount: fmtEur(prepaid) }); }
    did = 'cancelled';
  } else if (open && (status === 'done' || status === 'no_show')) {
    // it took place on the old site between the two runs; today's stays for the till, which may still cash it
    if (a.day < today) {
      ctx.emit('appt.status', { id: a.id, status, prev: a.status, cid: a.clientId || undefined, ...tag });
      patch.legacy = true;
      did = 'closed';
    } else note(out, row, 'today');
  } else if (open && status === 'booked') {
    const to = { day: r.day, start: r.start, staffId: chairOf(s, r.staffId) ? r.staffId : a.staffId, dur: r.dur || a.dur };
    const was = fmtSlot(a, s);
    if (to.day !== a.day || to.start !== a.start || to.staffId !== a.staffId) {
      if (moved) { if (wpMoved) note(out, row, 'moved', { was }, 'both'); }
      else {
        ctx.emit('appt.moved', { id: a.id, ...to, from: { day: a.day, start: a.start, staffId: a.staffId }, by: 'import', cid: a.clientId || undefined, ...tag });
        // remember this move as the old site's, so a move made here later is told apart
        ext2.moves = a.moves + 1;
        ext2.slot = wpSlot;
        note(out, row, 'moved', { was });
        if (overlaps(s, run.mine, to, a.id)) note(out, row, 'overlap');
        slot = { day: to.day, start: to.start, staffId: to.staffId };
        did = 'moved';
      }
    } else if (to.dur !== a.dur) patch.dur = to.dur; // the WXR's real length, after a CSV-only first run
  } else if (!open && status === 'cancelled' && ACTIVE.has(a.status)) note(out, row, 'cancelled');
  else if (a.legacy && a.status === 'done' && status === 'no_show' && !a.saleId) {
    // the WXR dropped after the CSV: a past visit was in fact a no-show
    ctx.emit('appt.status', { id: a.id, status: 'no_show', prev: a.status, cid: a.clientId || undefined, ...tag });
    did = 'closed';
  }
  // what else changed on a booking still in the agenda; or an « Erreur » it was given since
  const payable = ACTIVE.has(a.status) && !a.saleId && !a.legacy;
  let changed = false;
  if (status === 'booked' && payable) {
    changed = carry(s, ctx, r, a, row, run, { free: open && !moved, ext2, patch, pii });
    // a longer visit (other services) may now run into the next booking
    if (patch.dur && patch.dur > a.dur && did !== 'moved' && open && overlaps(s, run.mine, { ...slot, dur: patch.dur }, a.id)) note(out, row, 'overlap');
  } else if (r.status === 'error' && payable) note(out, row, 'error', {}, 'since');
  if (changed && did === 'already') did = 'changed';
  if (Object.keys(ext2).some((k) => ext2[k] !== ext[k])) patch.ext = ext2;
  if (Object.keys(patch).length || Object.keys(pii).length) {
    ctx.emit('appt.updated', { id: a.id, patch, cid: a.clientId || undefined, ...tag }, Object.keys(pii).length ? pii : undefined);
    if (did === 'already') did = 'updated';
  }
  return did;
}

/**
 * What the old site changed on a booking still in the agenda since an earlier run. The deposit paid since is always carried (until it is
 * cashed): it is money the client already gave. The price, the services, the note, the corrected number and name only while nobody handled
 * the booking here (`free`); otherwise a line asks for a look and nothing changes. What the old site said last time is kept on the booking
 * (ext.wpPrice, ext.wpSvc), so a change made here in the agenda is never taken for the old site's.
 * @returns {boolean} something was carried over
 */
function carry(s, ctx, r, a, row, run, { free, ext2, patch, pii }) {
  const out = run.out, ext = a.ext || {};
  let changed = false;
  // services and price
  const ids = r.serviceIds.length && r.serviceIds.every((sid) => sid !== LEGACY_SERVICE && s.services.has(sid)) ? r.serviceIds : [];
  const have = a.services.map((v) => v.id);
  const svcNew = ids.length > 0 && sortedIds(ids) !== (ext.wpSvc ?? sortedIds(have));
  const priceNew = r.price != null && r.price !== (ext.wpPrice ?? a.price);
  let price = a.price;
  if (svcNew || priceNew) {
    const services = snapshot(s, svcNew ? ids : have, r.price ?? null);
    price = r.price ?? services.reduce((t, v) => t + v.price, 0);
    const bits = [];
    if (svcNew) bits.push('prestation : ' + a.services.map((v) => v.name).join(' + ') + ' → ' + services.map((v) => v.name).join(' + '));
    if (price !== a.price) bits.push('prix : ' + fmtEur(a.price) + ' → ' + fmtEur(price));
    if (!free) { if (bits.length) note(out, row, 'changed', { names: bits.join(' · ').slice(0, 160) }, 'handled'); price = a.price; }
    else {
      if (bits.length) {
        patch.services = services; patch.price = price;
        if (svcNew && !r.dur) patch.dur = totalDur(services);
        note(out, row, 'changed', { names: bits.join(' · ').slice(0, 160) });
        changed = true;
      }
      if (svcNew) ext2.wpSvc = sortedIds(ids);
      if (r.price != null) ext2.wpPrice = r.price;
    }
  }
  // the deposit paid since (or paid up): to be cashed at the till with « Payé sur l’ancien site »
  const paid = ext.paid || 0, deposit = !!r.paid && r.paid > paid;
  if (deposit) {
    ext2.paid = r.paid;
    note(out, row, 'paid', { amount: fmtEur(r.paid) }, (r.paid >= price ? 'full' : '') + 'late');
    changed = true;
  }
  // the note: the deposit sentence first, the old site's note added when it is new
  if (deposit || (free && r.note)) {
    let text = pii.note ?? a.note ?? '';
    if (deposit) text = [paidNote(r.paid, price), text.replace(PAID_NOTE, '')].filter(Boolean).join(' · ');
    if (free && r.note && !text.includes(r.note.slice(0, 100))) text = [text, r.note].filter(Boolean).join(' · ');
    text = text.slice(0, 300);
    if (text !== (a.note || '')) pii.note = text;
  }
  // the number or the name corrected on the old site
  if (free) {
    const who = run.P.revisit(r, row, a);
    if (who.name !== undefined) pii.name = who.name;
    if (who.touched) changed = true;
  }
  return changed;
}

export const importBatch = {
  run(s, input, ctx) {
    ctx.need('settings');
    const x = parse(batchSchema, input);
    const rid = x.run;
    if (rid && !runOpen(s, rid)) fail(409, 'run_closed', 'Cette reprise est terminée : relance l’import, rien ne sera compté deux fois.');
    const out = {
      clients: { added: 0, merged: /** @type {string[]} */ ([]), again: 0 },
      // updated: details filled in; moved, closed (took place there), cancelled, changed (price, services, deposit, number, name): what the old site changed since a first run
      appts: /** @type {Record<string, number>} */ ({ done: 0, noShow: 0, cancelled: 0, booked: 0, skipped: 0, already: 0, updated: 0, moved: 0, closed: 0, changed: 0 }),
      giftcards: { added: 0, already: 0, skipped: 0 }, packs: { added: 0, already: 0, skipped: 0 },
      /** why rows were skipped: the report's « Ignorés » */
      skip: { error: 0, unpaid: 0, service: 0, staff: 0, erased: 0, retention: 0, phone: 0, giftcard: 0, pack: 0 },
      /** @type {{ kind: string, text: string, wp?: number, day?: string, start?: number, name?: string, cid?: string, o?: string, v?: string, names?: string }[]} */
      review: [],
      /** pre-existing files of an earlier run met in this batch (internal) */
      again: /** @type {Set<string>} */ (new Set())
    };
    const P = people(s, ctx, out, rid);
    const run = { legacyStaff: /** @type {string|null} */ (null), legacyService: /** @type {string|null} */ (null) };
    const today = ctx.local.day, cutoff = retentionCutoff(today);

    for (const c of x.clients || []) {
      const row = { name: [c.first, c.last].filter(Boolean).join(' ') };
      if (P.gone(c, row)) { out.skip.erased++; continue; }
      if (!P.find(c, row)) out.skip.phone++;
    }

    // who has a booking since the cutoff in this batch: their older rows come in with them. Only a row that will make a booking
    // counts (the browser decides the same way): a person whose recent rows are all errors, unpaid or unmatched has no visit to keep
    const keysOf = (r) => { const p = r.phone ? normPhoneImport(r.phone, r.prefix) : null; return [r.wpUser ? 'w' + r.wpUser : '', p ? 'p' + p : '', r.email && isEmail(String(r.email).toLowerCase()) ? 'e' + String(r.email).toLowerCase() : ''].filter(Boolean); };
    const wouldBook = (r) => {
      const ids = r.serviceIds;
      if (!ids.length || ids.some((sid) => sid !== LEGACY_SERVICE && !s.services.has(sid))) return false;
      const dur = r.dur || totalDur(ids.map((sid) => serviceOf(s, sid)));
      const status = mapStatus(r.status, !!r.noShow, instantOf(r.day, r.start + dur) <= ctx.now);
      if (!status) return false;
      return status !== 'booked' || (!ids.includes(LEGACY_SERVICE) && !!chairOf(s, r.staffId));
    };
    const recent = new Set((x.appts || []).filter((r) => r.day >= cutoff && wouldBook(r)).flatMap(keysOf));
    const seen = new Set(), codes = new Set();
    /** upcoming bookings of this run, per chair and day, to report overlaps between them too */
    const mine = new Map();
    const pass = { out, mine, P, tag: rid ? { run: rid } : {} };
    // the bookings an earlier run brought in that this one goes through again (delta → carry → revisit): the rows of a same file are heard
    // before any is applied, so the file takes the number of its newest booking whatever the order of the rows
    for (const r of x.appts || []) {
      const prev = s.appts.get(s.apptByWp.get(String(r.wp)) || '');
      if (!prev || !prev.clientId || !isOpen(prev) || movedHere(prev)) continue;
      // a row of someone erased is skipped by the loop below: it does not speak
      const tomb = rowTomb(s, r, ctx.meta.tombKey);
      if (tomb && !(r.createdAt && r.createdAt > tomb.at)) continue;
      if (mapStatus(r.status, !!r.noShow, instantOf(r.day, r.start + (r.dur || prev.dur)) <= ctx.now) === 'booked') P.speak(getClient(s, prev.clientId).id, r);
    }
    for (const r of x.appts || []) {
      const key = String(r.wp);
      if (seen.has(key)) continue;
      seen.add(key);
      const name = [r.first, r.last].filter(Boolean).join(' ');
      const row = { wp: r.wp, day: r.day, start: r.start, name };
      // before the delta too: a re-run must not put an erased client's note back on an old booking
      if (P.gone(r, row)) { out.appts.skipped++; out.skip.erased++; continue; }
      let prev = s.apptByWp.get(key) ? s.appts.get(s.apptByWp.get(key)) : null;
      // this import cancelled it (« Annulé » or « Supprimé sur l’ancien site ») and the old site confirms it again, to come: it goes back in the
      // agenda as a new booking with the same WordPress number; the cancelled one stays in the history. A booking cancelled by the client or by hand never does.
      const reopened = !!prev && cancelledByImport(prev) && mapStatus(r.status, !!r.noShow, instantOf(r.day, r.start + (r.dur || prev.dur)) <= ctx.now) === 'booked';
      if (reopened) prev = null;
      if (prev) {
        P.meet(prev.clientId);
        const did = delta(s, ctx, r, prev, row, pass);
        out.appts[did]++;
        // what the old site cancelled since an earlier run, apart from the bookings that come in cancelled
        if (did === 'cancelled') out.appts.cancelledNow = (out.appts.cancelledNow || 0) + 1;
        continue;
      }
      const ids = r.serviceIds;
      const missing = ids.filter((sid) => sid !== LEGACY_SERVICE && !s.services.has(sid));
      let services = missing.length || !ids.length ? null : snapshot(s, ids, r.price ?? null);
      const dur = r.dur || (services ? totalDur(services) : 30);
      const past = instantOf(r.day, r.start + dur) <= ctx.now;
      const status = mapStatus(r.status, !!r.noShow, past);
      if (!status) { out.appts.skipped++; const why = r.status === 'error' ? 'error' : 'unpaid'; out.skip[why]++; note(out, row, why); continue; }
      // an upcoming booking on « Ancienne prestation » would be in the agenda as a service nobody sells: left out, and listed to be put back by hand
      if (services && status === 'booked' && ids.includes(LEGACY_SERVICE)) services = null;
      if (!services) {
        out.appts.skipped++; out.skip.service++;
        const names = (r.wpServices || []).join(', ').slice(0, 160);
        // to come: a client with no seat on the day (À faire); in the past: history only (Pour info)
        note(out, row, 'service', { names: names || 'aucune' }, status === 'booked' ? 'upcoming' : '');
        if (names) out.review[out.review.length - 1].names = names;
        continue;
      }
      let staffId = r.staffId;
      // an upcoming booking on the archived profile would be in no lane of the agenda, yet reminded and never blocking
      if (status === 'booked' && !chairOf(s, staffId)) { out.appts.skipped++; out.skip.staff++; note(out, row, 'staff'); continue; }
      if (staffId !== LEGACY_STAFF && !s.staff.has(staffId)) { out.appts.skipped++; out.skip.staff++; note(out, row, 'staff', {}, 'unknown'); continue; }
      // retention: nobody is collected only to be purged. Without a file, a booking from before the cutoff never creates one,
      // unless the same person has a visit since in this batch (the browser sends the recent rows first, so across batches the file exists)
      if (r.day < cutoff && !P.has(r) && !keysOf(r).some((k) => recent.has(k))) { out.appts.skipped++; out.skip.retention++; note(out, row, 'retention'); continue; }
      if (staffId === LEGACY_STAFF) staffId = legacyStaff(s, ctx, run);
      if (ids.includes(LEGACY_SERVICE)) { const lid = legacyService(s, ctx, run); services = services.map((v) => (v.id === LEGACY_SERVICE ? { ...v, id: lid } : v)); }
      const named = {};
      const clientId = P.find(r, row, named);
      const createdAt = pastInstant(r.createdAt, ctx.now);
      P.since(clientId, createdAt);
      const price = r.price ?? services.reduce((t, v) => t + v.price, 0);
      const paidText = past ? '' : paidNote(r.paid, price);
      // the deposit comes first: a long note of the client would cut it mid-word
      const notes = [paidText, r.note].filter(Boolean).join(' · ');
      const a = {
        id: ctx.id('ap'), code: uniqueCode(s, ctx, codes), clientId, staffId, anyStaff: false, day: r.day, start: r.start, dur,
        services, price, source: 'import', status, sms: true, deposit: null, cid: clientId || undefined,
        ...(createdAt ? { createdAt } : {}),
        // uniq is the secret of the old e-mail links: only its hash is kept, like any link token
        // wpPrice and wpSvc: what the old site said, so a later run tells its changes from the ones made here
        ext: { wp: r.wp, slot: r.day + '|' + r.start, ...(r.uniq ? { uniq: sha256(r.uniq.toLowerCase()) } : {}), ...(r.paid ? { paid: r.paid } : {}), ...(r.price != null ? { wpPrice: r.price } : {}), wpSvc: sortedIds(ids), ...(rid ? { run: rid } : {}) },
        ...(past ? { legacy: true } : {}),
        ...(status === 'cancelled' ? { cancel: { by: 'salon', reason: CANCEL_REASON, at: createdAt || ctx.now, late: false } } : {})
      };
      // a booking without a file keeps the name on it; so does one whose typed first name is not the file's (erased with the file)
      const pii = { ...(clientId && !named.named ? {} : { name: name.slice(0, 40) || 'Client' }), ...(notes ? { note: notes.slice(0, 300) } : {}) };
      ctx.emit('appt.booked', a, Object.keys(pii).length ? pii : undefined);
      out.appts[status === 'no_show' ? 'noShow' : status]++;
      // cancelled before it was due, after a deposit: the client may be owed it back
      if (status === 'cancelled' && r.paid && !past) note(out, row, 'refund', { amount: fmtEur(r.paid) });
      if (status !== 'booked') continue;
      if (reopened) { out.appts.reopened = (out.appts.reopened || 0) + 1; note(out, row, 'reopened'); }
      if (r.status === 'pending' || r.status === 'pendingpayment') note(out, row, 'pending');
      if (paidText) note(out, row, 'paid', { amount: fmtEur(r.paid) }, r.paid >= price ? 'full' : '');
      // availability rules are skipped (the old site accepted it), but a double booking is worth a look
      if (overlaps(s, mine, { day: r.day, start: r.start, dur, staffId }, a.id)) note(out, row, 'overlap');
    }
    // the files this batch made keep the oldest creation time the old site gave their rows
    P.settle();

    // bookings the old site no longer has (deleted, not cancelled: they are in no export): the browser compares the
    // export to what an earlier run brought in, and says which. Cancelled here, with no message, while nobody handled them
    if (x.gone) out.appts.gone = 0;
    for (const w of new Set(x.gone || [])) {
      const a = s.appts.get(s.apptByWp.get(String(w)) || '');
      if (!a || a.day < today || a.status === 'cancelled') continue;
      const c = a.clientId ? getClient(s, a.clientId) : null;
      const row = { wp: w, day: a.day, start: a.start, name: c ? fileName(c) : a.name };
      if (isOpen(a) && !movedHere(a)) {
        ctx.emit('appt.cancelled', { id: a.id, by: 'salon', reason: GONE_REASON, gone: true, cid: a.clientId || undefined, ...pass.tag });
        out.appts.gone++;
        note(out, row, 'gone');
      } else note(out, row, 'gone-handled');
    }

    const hashes = new Set();
    for (const g of x.giftcards || []) {
      const r = issueGift(s, ctx, g, { today, hashes, run: rid });
      // named by what is not personal: the last four characters of the code and the balance, so the report says which card it was
      const mask = '•••• ' + (normGiftCode(g.code).slice(-4) || '?') + ' · ' + fmtEur(g.amount);
      if (r.error) { out.giftcards.skipped++; out.skip.giftcard++; out.review.push({ kind: 'giftcard', name: mask, names: mask, text: r.error, v: r.v, ...(r.day ? { day: r.day } : {}) }); }
      else if (r.already) out.giftcards.already++;
      else out.giftcards.added++;
    }

    const packed = new Set();
    for (const k of x.packs || []) {
      const label = [k.first, k.last].filter(Boolean).join(' ') || k.phone || '';
      // the report names a carnet by the last four digits of the number, never by the name or the number
      const digits = String(k.phone || '').replace(/\D/g, '');
      const mask = digits.length >= 4 ? '•••• ' + digits.slice(-4) : 'Carnet sans numéro';
      if (!k.clientId && P.gone(k, {})) { out.packs.skipped++; out.skip.erased++; continue; }
      if (k.expires < today) { out.packs.skipped++; out.skip.pack++; out.review.push({ kind: 'pack', name: label, names: mask, text: say('pack', { day: fmtDay(k.expires) }, 'expired'), v: 'expired', day: k.expires }); continue; }
      const cid = k.clientId ? getClient(s, k.clientId).id : k.phone || k.email ? (k.first ? P.find(k, { name: label }) : findOnly(s, k, P)) : null;
      if (!cid) { out.packs.skipped++; out.skip.pack++; out.review.push({ kind: 'pack', name: label, names: mask, text: say('pack', {}, 'nofile'), v: 'nofile' }); continue; }
      if (known(s).packs.has(cid) || packed.has(cid)) { out.packs.already++; continue; }
      packed.add(cid);
      issuePack(s, ctx, cid, k, rid);
      out.packs.added++;
    }

    // a person counts once for the whole run, whatever the number of batches: the files an earlier batch met are not met again
    const before = rid ? s.imports.seen.get(rid) : null;
    if (before) out.clients.merged = out.clients.merged.filter((c) => !before.has(c));
    out.clients.again = [...out.again].filter((c) => !before || !before.has(c)).length;
    const { again, ...answer } = out;
    if (rid) {
      const refs = out.review.map((r) => { const o = { kind: r.kind }; for (const k of ['wp', 'day', 'start', 'cid', 'o', 'v', 'names']) if (r[k] !== undefined) o[k] = r[k]; return o; });
      ctx.emit('import.batch', {
        run: rid, i: x.i ?? null,
        counts: { clients: { added: out.clients.added, merged: out.clients.merged.length, again: out.clients.again }, appts: out.appts, giftcards: out.giftcards, packs: out.packs },
        skip: out.skip, review: refs, cids: [...P.met]
      });
    }
    return answer;
  },
  /** The answer to a batch sent again after its first answer was lost (another instance, a restart): from its events. */
  replay(events) {
    const b = events.find((e) => e.type === 'import.batch');
    const n = (t) => events.filter((e) => e.type === t).length;
    if (!b) return { clients: { added: n('client.added'), merged: [], again: 0 }, appts: { done: 0, noShow: 0, cancelled: 0, booked: n('appt.booked'), skipped: 0, already: 0, updated: 0, moved: 0, closed: 0, changed: 0 }, giftcards: { added: n('giftcard.issued'), already: 0, skipped: 0 }, packs: { added: n('pack.sold'), already: 0, skipped: 0 }, skip: {}, review: [] };
    const c = b.data.counts;
    return { clients: { added: c.clients.added, merged: [], again: c.clients.again }, appts: c.appts, giftcards: c.giftcards, packs: c.packs, skip: b.data.skip, review: b.data.review.map((r) => ({ ...r, text: say(r.kind, {}, r.v), name: '' })) };
  }
};

/** A pack row without a name only attaches to an existing file. */
function findOnly(s, k, P) {
  const phone = k.phone ? normPhoneImport(k.phone, k.prefix) : null;
  const email = k.email && isEmail(k.email) ? k.email : '';
  if ((phone && s.clientByPhone.has(phone)) || (email && known(s).email.has(email))) return P.find(k, {});
  return null;
}

/** A paper card sold before the switch: stored value outside any sale, so it is in no Z and counts once. */
function issueGift(s, ctx, g, { today, hashes, run }) {
  const norm = normGiftCode(g.code);
  if (norm.length < 4) return { error: say('giftcard', {}, 'short'), v: 'short' };
  const codeHash = sha256(norm);
  if (s.giftByHash.has(codeHash) || hashes.has(codeHash)) return { already: true };
  const expires = g.expires || addDays(today, 365);
  if (expires < today) return { error: say('giftcard', { day: fmtDay(expires) }, 'expired'), v: 'expired', day: expires };
  if (g.amount < 100) return { error: say('giftcard', {}, 'zero'), v: 'zero' };
  hashes.add(codeHash);
  const gid = ctx.id('gc');
  ctx.emit('giftcard.issued', { id: gid, codeHash, last4: norm.slice(-4), amount: g.amount, expires, legacy: true, ...(run ? { run } : {}) }, { buyer: g.buyer || '', recipient: g.recipient || '' });
  return { id: gid, last4: norm.slice(-4) };
}

/** A carnet started on the old site: the cuts left, until its expiry, on the salon's carnet. */
function issuePack(s, ctx, clientId, k, run) {
  const sv = (k.serviceId && s.services.get(k.serviceId)?.pack ? s.services.get(k.serviceId) : null) || [...s.services.values()].find((x) => x.active && x.pack) || null;
  const pid = ctx.id('pk');
  ctx.emit('pack.sold', { id: pid, clientId, cid: clientId, name: sv ? sv.name : 'Carnet', total: k.left, serviceIds: (sv && sv.pack.serviceIds) || [], expires: k.expires, serviceId: sv ? sv.id : null, legacy: true, ...(run ? { run } : {}) });
  return pid;
}

/** One paper card taken over at the counter (the code typed, or a new one printed for it). */
export const importGiftcard = {
  run(s, input, ctx) {
    ctx.need('settings');
    const x = parse(oneGift, input);
    // no code typed, or one with nothing usable in it ('---'): a new one is printed for the card, and returned
    const printed = !(x.code && normGiftCode(x.code));
    const code = printed ? giftCode() : x.code;
    if (x.expires < ctx.local.day) fail(400, 'invalid', 'Cette carte a déjà expiré.');
    const r = issueGift(s, ctx, { ...x, code }, { today: ctx.local.day, hashes: new Set(), run: undefined });
    if (r.already) fail(409, 'exists', 'Cette carte est déjà enregistrée.');
    if (r.error) fail(400, 'invalid', r.error + '.');
    return { id: r.id, last4: r.last4, ...(printed ? { code } : {}) };
  }
};

/** One carnet taken over from a client file. */
export const importPack = {
  run(s, input, ctx) {
    ctx.need('settings');
    const x = parse(onePack, input);
    const c = getClient(s, x.clientId);
    if (c.erased) fail(409, 'erased', 'Cette fiche a été effacée.');
    if (x.expires < ctx.local.day) fail(400, 'invalid', 'Ce carnet a déjà expiré.');
    if ([...s.packs.values()].some((k) => k.legacy && k.clientId === c.id && k.used < k.total && k.expires >= ctx.local.day)) fail(409, 'exists', 'Un carnet repris est déjà en cours sur cette fiche.');
    return { id: issuePack(s, ctx, c.id, x) };
  }
};

/* ---------------- the record of a run ---------------- */

/**
 * Opens a run: what the files held and what the browser left out before sending (retention, repeats, unreadable lines),
 * so the report can say that the numbers add up. Idempotent by request id (the engine replays the answer).
 */
export const startImportRun = {
  run(s, input, ctx) {
    ctx.need('settings');
    const x = parse(startSchema, input);
    const id = ctx.id('ir');
    ctx.emit('import.started', { id, ...x });
    return { id };
  }
};

/** Closes a run: it takes no more batches, and a run that never gets here reads as interrupted. Closing twice changes nothing. */
export const finishImportRun = {
  run(s, input, ctx) {
    ctx.need('settings');
    const x = parse(obj({ id: id() }), input);
    const r = s.imports.runs.get(x.id);
    if (!r) fail(404, 'not_found', 'Cette reprise n’existe pas.');
    if (r.undoneAt) fail(409, 'run_closed', 'Cette reprise est terminée : relance l’import, rien ne sera compté deux fois.');
    if (!r.finishedAt) ctx.emit('import.finished', { id: r.id });
    return { id: r.id };
  }
};

/** A run for the list: everything but the lines. @param {any} s @param {any} r */
export function runSummary(s, r) {
  const { review, problems, ...rest } = r;
  const by = s.staff.get(r.by);
  return { ...rest, by: by ? by.name : '', reviewKept: review.length, problemsKept: (problems || []).length };
}

/**
 * The lines of a run's report, rebuilt from the references its batches wrote: the name comes from the client file now
 * (« Client effacé » once erased) or from the booking's own, the words from KIND_TEXT. Nothing personal was ever stored in the run.
 * @param {any} s @param {any} r
 */
export function runLines(s, r) {
  const lines = r.review.map((ref) => {
    const a = ref.wp ? s.appts.get(s.apptByWp.get(String(ref.wp)) || '') : null;
    const cid = (a && a.clientId) || ref.cid;
    const c = cid ? s.clients.get(cid) : null;
    const f = c ? getClient(s, c.id) : null;
    const name = f ? fileName(f) : a ? a.name || 'Client effacé' : '';
    const other = ref.o ? s.clients.get(ref.o) : null;
    const typed = a && a.name && f && !f.erased ? a.name.split(' ')[0] : '';
    const paid = a && a.ext && a.ext.paid ? fmtEur(a.ext.paid) : '';
    const st = a ? s.staff.get(a.staffId) : null;
    // about the file itself: once the client is erased there is nothing left to do
    const done = f && f.erased && FILE_KINDS.has(ref.kind);
    const text = done ? 'Client effacé : rien à faire' : say(ref.kind, { typed, file: f ? fileName(f) : '', other: other ? fileName(getClient(s, other.id)) : '', amount: paid, day: ref.day ? fmtDay(ref.day) : '', names: ref.names || '' }, ref.v);
    // a card or a carnet is named by its masked identifier (the last digits: not personal), the other lines by the client file
    const label = (ref.kind === 'giftcard' || ref.kind === 'pack') && ref.names ? ref.names : name;
    return { kind: ref.kind, wp: ref.wp || 0, day: ref.day || (a ? a.day : ''), start: ref.start ?? (a ? a.start : null), name: label, staff: st ? st.name : '', text, todo: isTodo(ref.kind, ref.v) && !done };
  });
  // what the reader could not understand, with its file and line: it must never vanish into a count
  for (const x of r.problems || []) lines.push({ kind: 'unreadable', wp: x.wp || 0, day: '', start: null, name: '', staff: '', text: x.file + (x.line ? ' · ligne ' + x.line : '') + ' · ' + x.text, todo: true });
  return lines;
}
