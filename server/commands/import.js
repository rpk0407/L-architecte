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
import { normPhoneImport, isEmail, capFirst, sha256, normGiftCode, giftCode } from '../lib/util.js';
import { addDays, instantOf, dayShort, fmtTime } from '../../shared/dates.js';
import { fmtEur } from '../../shared/money.js';
import { retentionCutoff } from '../../shared/retention.js';
import { getClient, totalDur } from './common.js';
import { erasedTomb } from './clients.js';
import { runOpen } from '../projections/imports.js';

/** Salon Booking System's statuses (sln-b-…), as the browser normalises them from the French or English labels. */
export const WP_STATUS = /** @type {const} */ (['confirmed', 'pending', 'pendingpayment', 'paid', 'paylater', 'canceled', 'error']);
export const LEGACY_STAFF = 'legacy';
const ACTIVE = new Set(['pending', 'booked', 'arrived', 'in_chair']);
export const GONE_REASON = 'Supprimé sur l’ancien site';

/**
 * What each row of the review list says. {x} is filled from what is known; a [group] holding a missing {x} is
 * dropped, so the same text serves the live answer (with names) and the report rebuilt later (refs only).
 * 'kind:v' is a variant of a kind.
 */
export const KIND_TEXT = {
  pending: 'En attente sur l’ancien site : confirme avec le client',
  paid: 'Acompte de {amount} déjà payé sur l’ancien site : à déduire en caisse',
  'paid:full': 'Déjà payé en entier sur l’ancien site ({amount}) : à déduire en caisse',
  overlap: 'Chevauche un autre rendez-vous',
  today: 'Terminé aujourd’hui sur l’ancien site : s’il y a été encaissé, ne l’encaisse pas ici',
  moved: 'Déplacé sur l’ancien site[ : était {was}]',
  'moved:both': 'Déplacé ici et sur l’ancien site : vérifie le créneau[ (ici {was})]',
  cancelled: 'Annulé sur l’ancien site, mais déjà pris en charge ici : vérifie',
  service: 'Prestation inconnue[ : {names}] (ligne ignorée)',
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
  unpaid: 'Paiement en ligne jamais terminé sur l’ancien site : ignoré',
  retention: 'Plus de 3 ans sans visite : pas repris (règle de conservation)',
  gone: 'Supprimé sur l’ancien site : annulé ici, sans SMS',
  'gone-handled': 'Supprimé sur l’ancien site, mais déjà pris en charge ici : vérifie',
  name: 'Même numéro, autre prénom[ (« {typed} »)] : mis sur la fiche[ de {file}]. Famille ?',
  'email-elsewhere': 'Cet e-mail est déjà sur la fiche[ de {other}] : pas copié',
  'new-number': 'Nouveau numéro sur l’ancien site[ pour {file}] : numéro gardé, à vérifier',
  'status-unknown': 'État inconnu sur l’ancien site : ligne ignorée'
};
/** The kinds that ask the owner to do something (« À faire »); the rest is « Pour info ». */
export const TODO_KINDS = new Set(['pending', 'paid', 'overlap', 'today', 'moved', 'cancelled', 'gone-handled', 'name', 'new-number', 'staff']);

/** The kinds about a client file rather than a booking. */
const FILE_KINDS = new Set(['name', 'new-number', 'email-elsewhere']);

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
const clientRow = strict({ ...who, notes: opt(str({ max: 1000 })), createdAt: opt(int({ min: 0, max: 8640000000000000 })), wpUser: opt(wpId), source: opt(oneOf(['files', 'site'])) });
const apptRow = strict({
  wp: wpId, uniq: opt(str({ max: 64, pattern: /^[A-Za-z0-9]+$/ })), day: day(), start: int({ min: 0, max: 1439 }), dur: opt(int({ min: 5, max: 600 })),
  createdAt: opt(int({ min: 0, max: 8640000000000000 })), ...who, serviceIds: arr(id(), { max: 6 }), staffId: id(), price: opt(money(1000000)), paid: opt(money(1000000)),
  status: oneOf(WP_STATUS), noShow: opt(bool()), note: opt(str({ max: 300 })), wpUser: opt(wpId), source: opt(oneOf(['files', 'site'])),
  // the old site's names for the services the owner left unmatched (a service name is not personal): the report says which
  wpServices: opt(arr(str({ max: 80 }), { max: 6 }))
});
const giftRow = strict({ code: str({ min: 1, max: 40 }), amount: money(100000), expires: opt(day()), buyer: opt(str({ max: 60 })), recipient: opt(str({ max: 60 })) });
const packRow = strict({ ...who, clientId: opt(id()), left: int({ min: 1, max: 50 }), expires: day(), serviceId: opt(id()) });
const batchSchema = obj({
  clients: opt(arr(clientRow, { max: 150 })), appts: opt(arr(apptRow, { max: 150 })), giftcards: opt(arr(giftRow, { max: 150 })), packs: opt(arr(packRow, { max: 150 })),
  // the bookings the old site no longer has (the browser's call, see wpimport.ts), the run this batch belongs to and its place in it
  gone: opt(arr(wpId, { max: 150 })), run: opt(id()), i: opt(int({ min: 0, max: 100000 }))
});
const oneGift = obj({ code: opt(str({ max: 40 })), amount: money(100000), expires: day(), buyer: opt(str({ max: 60 })), recipient: opt(str({ max: 60 })) });
const onePack = obj({ clientId: id(), left: int({ min: 1, max: 50 }), expires: day(), serviceId: opt(id()) });

const count = int({ min: 0, max: 1000000 });
const startSchema = obj({
  source: oneOf(['files', 'site']),
  files: arr(obj({ name: str({ max: 80 }), kind: str({ max: 20 }), rows: count, sha: str({ max: 16, pattern: /^[0-9a-f]*$/ }) }), { max: 30 }),
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
  parts: opt(int({ min: 0, max: 5000 }))
});

/* ---------------- what the state does not index: e-mails, legacy packs, the old barbers' profile ---------------- */

// rebuilt lazily when the journal moved, so a batch of 150 rows never scans every client 150 times
const lazy = new WeakMap();
function known(s) {
  let x = lazy.get(s);
  if (!x || x.v !== s.version) {
    x = { v: s.version, email: new Map(), wp: new Map(), packs: new Set(), legacyStaff: /** @type {string|null} */ (null) };
    for (const c of s.clients.values()) {
      if (c.erased || c.mergedInto) continue;
      if (c.email && !x.email.has(c.email)) x.email.set(c.email, c.id);
      if (c.ext && c.ext.wp && !x.wp.has(c.ext.wp)) x.wp.set(c.ext.wp, c.id);
    }
    for (const k of s.packs.values()) if (k.legacy) x.packs.add(k.clientId);
    for (const st of s.staff.values()) if (st.legacy) x.legacyStaff = st.id;
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

/**
 * Where the bookings an earlier run brought in stand now, for the wizard's preview of a delta run (the same rules
 * as delta() below decide; this only reads). open: nobody handled it here yet; movedHere: moved in the agenda since.
 * @param {any} s @param {number[]} wps
 */
export function priorView(s, wps) {
  const out = [];
  for (const w of wps) {
    const a = s.appts.get(s.apptByWp.get(String(w)) || '');
    if (!a) continue;
    out.push({ wp: w, day: a.day, start: a.start, dur: a.dur, staffId: a.staffId, status: a.status, open: isOpen(a), movedHere: movedHere(a) });
  }
  return out;
}
/** Nobody handled it here yet: not checked in, not paid, not a closed visit of the old site. */
const isOpen = (a) => (a.status === 'booked' || a.status === 'pending') && !a.saleId && !a.legacy;
const movedHere = (a) => a.moves > ((a.ext && a.ext.moves) || 0);

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
  /** the files whose gaps were already filled in by this batch (once each) */
  const filled = new Set();
  const K = known(s);
  const run = rid ? { run: rid } : {};
  const phoneOf = (x) => (x.phone ? normPhoneImport(x.phone, x.prefix) : null);
  const emailOf = (x) => (x.email && isEmail(String(x.email).toLowerCase()) ? String(x.email).toLowerCase() : '');
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
    const hit = lookup(x);
    let cid = hit ? hit.cid : null;
    if (hit) {
      const c = file(hit.cid);
      meet(cid);
      // the e-mail the old site gives for this number is already another client's: not copied (first file wins)
      const other = email && (byEmail.get(email) || K.email.get(email));
      const elsewhere = other && file(other).id !== cid ? file(other).id : null;
      if (elsewhere) out.review.push({ ...row, kind: 'email-elsewhere', text: say('email-elsewhere', { other: fileName(file(elsewhere)) }), cid, o: elsewhere });
      // the old site may know what the file lacks: never overwrite, only fill in (once per file and batch)
      if (!filled.has(cid)) {
        filled.add(cid);
        const fill = {}, patch = {};
        if (email && !c.email && !byEmail.has(email) && !elsewhere) fill.email = email;
        if (phone && !c.phone && !s.clientByPhone.has(phone) && !byPhone.has(phone)) fill.phone = phone;
        if (x.last && !c.last) fill.last = capFirst(x.last).slice(0, 40);
        if (x.wpUser && !(c.ext && c.ext.wp) && !created.has(cid)) patch.ext = { ...(c.ext || {}), wp: x.wpUser };
        if (Object.keys(fill).length || Object.keys(patch).length) ctx.emit('client.updated', { id: cid, cid, patch, fields: Object.keys(fill), ...run }, Object.keys(fill).length ? fill : undefined);
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
    const pii = { first: capFirst(x.first || '').slice(0, 40) || 'Client', last: capFirst(x.last || '').slice(0, 40), phone: phone || '', email, ...(x.notes ? { notes: x.notes } : {}) };
    const ext = { ...run, ...(x.wpUser ? { wp: x.wpUser } : {}) };
    // consent: service texts yes (they booked with their number), promotions no, and nobody ever asked on the old site: marketingSrc says so
    ctx.emit('client.added', { id: cid, cid, source: 'wordpress', sms: true, marketing: false, marketingSrc: 'wordpress', marketingAt: ctx.now, tags: [], createdAt: pastInstant(x.createdAt, ctx.now), ...(Object.keys(ext).length ? { ext } : {}) }, pii);
    created.add(cid);
    filled.add(cid);
    met.add(cid);
    made.set(cid, { id: cid, first: pii.first, last: pii.last, phone: pii.phone, email, ext });
    out.clients.added++;
    if (phone) byPhone.set(phone, cid);
    if (email) byEmail.set(email, cid);
    if (x.wpUser) byWp.set(x.wpUser, cid);
    return cid;
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
  return { find, gone, has, meet, created, met };
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
  const list = ids.map((sid) => s.services.get(sid)).map((sv) => ({ id: sv.id, name: sv.name, price: sv.price, from: !!sv.from, dur: sv.dur, buffer: sv.buffer || 0 }));
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
function note(out, row, kind, vars = {}, v = '') { out.review.push({ ...row, kind, text: say(kind, vars, v), ...(v ? { v } : {}) }); }

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

/**
 * The cut-over day's re-run, for a booking a first run already brought in: what the old site changed since is carried
 * over (cancelled, moved, taken place), but only while nobody handled it here (checked in, paid, moved in the agenda);
 * otherwise it is listed for a look. What the first run lacked (often the CSV alone) is filled in: link secret, note.
 * @returns {'cancelled'|'moved'|'closed'|'updated'|'already'}
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
  let did = /** @type {'cancelled'|'moved'|'closed'|'updated'|'already'} */ ('already');
  if (open && status === 'cancelled') {
    ctx.emit('appt.cancelled', { id: a.id, by: 'salon', reason: 'Annulé sur l’ancien site', cid: a.clientId || undefined, ...tag });
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
        did = 'moved';
      }
    } else if (to.dur !== a.dur) patch.dur = to.dur; // the WXR's real length, after a CSV-only first run
  } else if (!open && status === 'cancelled' && ACTIVE.has(a.status)) note(out, row, 'cancelled');
  else if (a.legacy && a.status === 'done' && status === 'no_show' && !a.saleId) {
    // the WXR dropped after the CSV: a past visit was in fact a no-show
    ctx.emit('appt.status', { id: a.id, status: 'no_show', prev: a.status, cid: a.clientId || undefined, ...tag });
    did = 'closed';
  }
  if (ext2.uniq !== ext.uniq || ext2.moves !== ext.moves || ext2.slot !== ext.slot) patch.ext = ext2;
  if (Object.keys(patch).length || Object.keys(pii).length) {
    ctx.emit('appt.updated', { id: a.id, patch, cid: a.clientId || undefined, ...tag }, Object.keys(pii).length ? pii : undefined);
    if (did === 'already') did = 'updated';
  }
  return did;
}

export const importBatch = {
  run(s, input, ctx) {
    ctx.need('settings');
    const x = parse(batchSchema, input);
    const rid = x.run;
    if (rid && !runOpen(s, rid)) fail(409, 'run_closed', 'Cette reprise est terminée : relance l’import, rien ne sera compté deux fois.');
    const out = {
      clients: { added: 0, merged: /** @type {string[]} */ ([]), again: 0 },
      // updated: details filled in; moved, closed (took place there), cancelled: what the old site changed since a first run
      appts: /** @type {Record<string, number>} */ ({ done: 0, noShow: 0, cancelled: 0, booked: 0, skipped: 0, already: 0, updated: 0, moved: 0, closed: 0 }),
      giftcards: { added: 0, already: 0, skipped: 0 }, packs: { added: 0, already: 0, skipped: 0 },
      /** why rows were skipped: the report's « Ignorés » */
      skip: { error: 0, unpaid: 0, service: 0, staff: 0, erased: 0, retention: 0, phone: 0, giftcard: 0, pack: 0 },
      /** @type {{ kind: string, text: string, wp?: number, day?: string, start?: number, name?: string, cid?: string, o?: string, v?: string, names?: string }[]} */
      review: [],
      /** pre-existing files of an earlier run met in this batch (internal) */
      again: /** @type {Set<string>} */ (new Set())
    };
    const P = people(s, ctx, out, rid);
    const run = { legacyStaff: /** @type {string|null} */ (null) };
    const today = ctx.local.day, cutoff = retentionCutoff(today);

    for (const c of x.clients || []) {
      const row = { name: [c.first, c.last].filter(Boolean).join(' ') };
      if (P.gone(c, row)) { out.skip.erased++; continue; }
      if (!P.find(c, row)) out.skip.phone++;
    }

    // who has a booking since the cutoff in this batch: their older rows come in with them
    const keysOf = (r) => { const p = r.phone ? normPhoneImport(r.phone, r.prefix) : null; return [r.wpUser ? 'w' + r.wpUser : '', p ? 'p' + p : '', r.email && isEmail(String(r.email).toLowerCase()) ? 'e' + String(r.email).toLowerCase() : ''].filter(Boolean); };
    const recent = new Set((x.appts || []).filter((r) => r.day >= cutoff).flatMap(keysOf));
    const seen = new Set(), codes = new Set();
    /** upcoming bookings of this run, per chair and day, to report overlaps between them too */
    const mine = new Map();
    const pass = { out, mine, tag: rid ? { run: rid } : {} };
    for (const r of x.appts || []) {
      const key = String(r.wp);
      if (seen.has(key)) continue;
      seen.add(key);
      const name = [r.first, r.last].filter(Boolean).join(' ');
      const row = { wp: r.wp, day: r.day, start: r.start, name };
      // before the delta too: a re-run must not put an erased client's note back on an old booking
      if (P.gone(r, row)) { out.appts.skipped++; out.skip.erased++; continue; }
      const prev = s.apptByWp.get(key) ? s.appts.get(s.apptByWp.get(key)) : null;
      if (prev) { P.meet(prev.clientId); out.appts[delta(s, ctx, r, prev, row, pass)]++; continue; }
      const missing = r.serviceIds.filter((sid) => !s.services.has(sid));
      const services = missing.length || !r.serviceIds.length ? null : snapshot(s, r.serviceIds, r.price ?? null);
      const dur = r.dur || (services ? totalDur(services) : 30);
      const past = instantOf(r.day, r.start + dur) <= ctx.now;
      const status = mapStatus(r.status, !!r.noShow, past);
      if (!status) { out.appts.skipped++; const why = r.status === 'error' ? 'error' : 'unpaid'; out.skip[why]++; note(out, row, why); continue; }
      if (!services) { out.appts.skipped++; out.skip.service++; const names = (r.wpServices || []).join(', ').slice(0, 160); note(out, row, 'service', { names: names || 'aucune' }); if (names) out.review[out.review.length - 1].names = names; continue; }
      let staffId = r.staffId;
      // an upcoming booking on the archived profile would be in no lane of the agenda, yet reminded and never blocking
      if (status === 'booked' && !chairOf(s, staffId)) { out.appts.skipped++; out.skip.staff++; note(out, row, 'staff'); continue; }
      if (staffId !== LEGACY_STAFF && !s.staff.has(staffId)) { out.appts.skipped++; out.skip.staff++; note(out, row, 'staff', {}, 'unknown'); continue; }
      // retention: nobody is collected only to be purged. Without a file, a booking from before the cutoff never creates one,
      // unless the same person has a visit since in this batch (the browser sends the recent rows first, so across batches the file exists)
      if (r.day < cutoff && !P.has(r) && !keysOf(r).some((k) => recent.has(k))) { out.appts.skipped++; out.skip.retention++; note(out, row, 'retention'); continue; }
      if (staffId === LEGACY_STAFF) staffId = legacyStaff(s, ctx, run);
      const named = {};
      const clientId = P.find(r, row, named);
      const createdAt = pastInstant(r.createdAt, ctx.now);
      const price = r.price ?? services.reduce((t, v) => t + v.price, 0);
      const paidText = !past && r.paid ? (r.paid >= price ? 'Déjà payé en entier sur l’ancien site (' + fmtEur(r.paid) + ')' : 'Acompte de ' + fmtEur(r.paid) + ' déjà payé sur l’ancien site') : '';
      const notes = [r.note, paidText].filter(Boolean).join(' · ');
      const a = {
        id: ctx.id('ap'), code: uniqueCode(s, ctx, codes), clientId, staffId, anyStaff: false, day: r.day, start: r.start, dur,
        services, price, source: 'import', status, sms: true, deposit: null, cid: clientId || undefined,
        ...(createdAt ? { createdAt } : {}),
        // uniq is the secret of the old e-mail links: only its hash is kept, like any link token
        ext: { wp: r.wp, slot: r.day + '|' + r.start, ...(r.uniq ? { uniq: sha256(r.uniq.toLowerCase()) } : {}), ...(r.paid ? { paid: r.paid } : {}), ...(rid ? { run: rid } : {}) },
        ...(past ? { legacy: true } : {}),
        ...(status === 'cancelled' ? { cancel: { by: 'salon', reason: 'Annulé sur l’ancien site', at: createdAt || ctx.now, late: false } } : {})
      };
      // a booking without a file keeps the name on it; so does one whose typed first name is not the file's (erased with the file)
      const pii = { ...(clientId && !named.named ? {} : { name: name.slice(0, 40) || 'Client' }), ...(notes ? { note: notes.slice(0, 300) } : {}) };
      ctx.emit('appt.booked', a, Object.keys(pii).length ? pii : undefined);
      out.appts[status === 'no_show' ? 'noShow' : status]++;
      if (status !== 'booked') continue;
      if (r.status === 'pending' || r.status === 'pendingpayment') note(out, row, 'pending');
      if (paidText) note(out, row, 'paid', { amount: fmtEur(r.paid) }, r.paid >= price ? 'full' : '');
      // availability rules are skipped (the old site accepted it), but a double booking is worth a look
      if (overlaps(s, mine, { day: r.day, start: r.start, dur, staffId }, a.id)) note(out, row, 'overlap');
    }

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
      if (r.error) { out.giftcards.skipped++; out.skip.giftcard++; out.review.push({ kind: 'giftcard', name: '•••• ' + normGiftCode(g.code).slice(-4), text: r.error, v: r.v, ...(r.day ? { day: r.day } : {}) }); }
      else if (r.already) out.giftcards.already++;
      else out.giftcards.added++;
    }

    const packed = new Set();
    for (const k of x.packs || []) {
      const label = [k.first, k.last].filter(Boolean).join(' ') || k.phone || '';
      if (!k.clientId && P.gone(k, {})) { out.packs.skipped++; out.skip.erased++; continue; }
      if (k.expires < today) { out.packs.skipped++; out.skip.pack++; out.review.push({ kind: 'pack', name: label, text: say('pack', { day: fmtDay(k.expires) }, 'expired'), v: 'expired', day: k.expires }); continue; }
      const cid = k.clientId ? getClient(s, k.clientId).id : k.phone || k.email ? (k.first ? P.find(k, { name: label }) : findOnly(s, k, P)) : null;
      if (!cid) { out.packs.skipped++; out.skip.pack++; out.review.push({ kind: 'pack', name: label, text: say('pack', {}, 'nofile'), v: 'nofile' }); continue; }
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
    if (!b) return { clients: { added: n('client.added'), merged: [], again: 0 }, appts: { done: 0, noShow: 0, cancelled: 0, booked: n('appt.booked'), skipped: 0, already: 0, updated: 0, moved: 0, closed: 0 }, giftcards: { added: n('giftcard.issued'), already: 0, skipped: 0 }, packs: { added: n('pack.sold'), already: 0, skipped: 0 }, skip: {}, review: [] };
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
  const { review, ...rest } = r;
  const by = s.staff.get(r.by);
  return { ...rest, by: by ? by.name : '', reviewKept: review.length };
}

/**
 * The lines of a run's report, rebuilt from the references its batches wrote: the name comes from the client file now
 * (« Client effacé » once erased) or from the booking's own, the words from KIND_TEXT. Nothing personal was ever stored in the run.
 * @param {any} s @param {any} r
 */
export function runLines(s, r) {
  return r.review.map((ref) => {
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
    return { kind: ref.kind, wp: ref.wp || 0, day: ref.day || (a ? a.day : ''), start: ref.start ?? (a ? a.start : null), name, staff: st ? st.name : '', text, todo: TODO_KINDS.has(ref.kind) && !done };
  });
}
