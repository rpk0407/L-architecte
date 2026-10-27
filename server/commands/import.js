// @ts-check
// Taking over the old WordPress salon (Salon Booking System): client files, past visits, upcoming bookings,
// paper gift cards and subscriptions. The browser reads the exports (web/src/lib/wpimport.ts) and sends them in
// batches; this decides what each row becomes. Running the same files again adds nothing (ext.wp, phone, e-mail,
// card code), so the cut-over day is a delta run: what changed on the old site since (cancelled, moved, taken place)
// is carried over. Nothing here queues a message or checks the chairs' hours: the old site already accepted these
// bookings, and its clients were told by the old site.
import { fail } from '../core/engine.js';
import { str, int, bool, opt, obj, arr, day, id, oneOf, money, parse } from '../lib/validate.js';
import { normPhoneImport, isEmail, capFirst, sha256, normGiftCode, giftCode } from '../lib/util.js';
import { addDays, instantOf, dayShort, fmtTime } from '../../shared/dates.js';
import { fmtEur } from '../../shared/money.js';
import { getClient, totalDur } from './common.js';

/** Salon Booking System's statuses (sln-b-…), as the browser normalises them from the French or English labels. */
export const WP_STATUS = /** @type {const} */ (['confirmed', 'pending', 'pendingpayment', 'paid', 'paylater', 'canceled', 'error']);
export const LEGACY_STAFF = 'legacy';
const ACTIVE = new Set(['pending', 'booked', 'arrived', 'in_chair']);

const who = { first: opt(str({ max: 60 })), last: opt(str({ max: 60 })), phone: opt(str({ max: 32 })), prefix: opt(str({ max: 6 })), email: opt(str({ max: 160, lower: true })) };
const clientRow = obj({ ...who, notes: opt(str({ max: 1000 })), createdAt: opt(int({ min: 0, max: 8640000000000000 })) });
const apptRow = obj({
  wp: int({ min: 1, max: 999999999999 }), uniq: opt(str({ max: 64, pattern: /^[A-Za-z0-9]+$/ })), day: day(), start: int({ min: 0, max: 1439 }), dur: opt(int({ min: 5, max: 600 })),
  createdAt: opt(int({ min: 0, max: 8640000000000000 })), ...who, serviceIds: arr(id(), { max: 6 }), staffId: id(), price: opt(money(1000000)), paid: opt(money(1000000)),
  status: oneOf(WP_STATUS), noShow: opt(bool()), note: opt(str({ max: 300 }))
});
const giftRow = obj({ code: str({ min: 1, max: 40 }), amount: money(100000), expires: opt(day()), buyer: opt(str({ max: 60 })), recipient: opt(str({ max: 60 })) });
const packRow = obj({ ...who, clientId: opt(id()), left: int({ min: 1, max: 50 }), expires: day(), serviceId: opt(id()) });
const batchSchema = obj({ clients: opt(arr(clientRow, { max: 150 })), appts: opt(arr(apptRow, { max: 150 })), giftcards: opt(arr(giftRow, { max: 150 })), packs: opt(arr(packRow, { max: 150 })) });
const oneGift = obj({ code: opt(str({ max: 40 })), amount: money(100000), expires: day(), buyer: opt(str({ max: 60 })), recipient: opt(str({ max: 60 })) });
const onePack = obj({ clientId: id(), left: int({ min: 1, max: 50 }), expires: day(), serviceId: opt(id()) });

/* ---------------- what the state does not index: e-mails, legacy packs, the old barbers' profile ---------------- */

// rebuilt lazily when the journal moved, so a batch of 150 rows never scans every client 150 times
const lazy = new WeakMap();
function known(s) {
  let x = lazy.get(s);
  if (!x || x.v !== s.version) {
    x = { v: s.version, email: new Map(), packs: new Set(), legacyStaff: /** @type {string|null} */ (null) };
    for (const c of s.clients.values()) if (c.email && !c.erased && !c.mergedInto && !x.email.has(c.email)) x.email.set(c.email, c.id);
    for (const k of s.packs.values()) if (k.legacy) x.packs.add(k.clientId);
    for (const st of s.staff.values()) if (st.legacy) x.legacyStaff = st.id;
    lazy.set(s, x);
  }
  return x;
}

/**
 * Is there already a client file for this person? 'salon' is the preview's 'fusionnés' (as the batch counts them),
 * 'wordpress' a file an earlier run created.
 * @returns {'salon'|'wordpress'|null}
 */
export function knownClient(s, x) {
  const phone = x.phone ? normPhoneImport(x.phone, x.prefix) : null;
  const email = x.email && isEmail(String(x.email).toLowerCase()) ? String(x.email).toLowerCase() : '';
  const cid = (phone && s.clientByPhone.get(phone)) || (email && known(s).email.get(email)) || null;
  if (!cid) return null;
  return getClient(s, cid).source === 'wordpress' ? 'wordpress' : 'salon';
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
    const open = (a.status === 'booked' || a.status === 'pending') && !a.saleId && !a.legacy;
    out.push({ wp: w, day: a.day, start: a.start, dur: a.dur, staffId: a.staffId, status: a.status, open, movedHere: a.moves > ((a.ext && a.ext.moves) || 0) });
  }
  return out;
}

/** WordPress time of creation, kept only when it makes sense (not in the future, not before the plugin existed). */
const pastInstant = (t, now) => (t && t > 1262304000000 && t <= now ? t : undefined);

/**
 * One run's view of the clients: the state plus the files created earlier in the same run.
 * @param {any} s @param {import('../core/engine.js').Ctx} ctx @param {any} out
 */
function people(s, ctx, out) {
  const byPhone = new Map(), byEmail = new Map(), created = new Set(), touched = new Set();
  const K = known(s);
  /** @returns {string|null} the client id, null when the row has neither a usable number nor an e-mail */
  function find(x, row) {
    const phone = x.phone ? normPhoneImport(x.phone, x.prefix) : null;
    if (x.phone && !phone) out.review.push({ ...row, kind: 'phone', text: 'Numéro illisible : « ' + x.phone + ' »' });
    const email = x.email && isEmail(x.email) ? x.email : '';
    let cid = (phone && (byPhone.get(phone) || s.clientByPhone.get(phone))) || (email && (byEmail.get(email) || K.email.get(email))) || null;
    if (cid) {
      if (!created.has(cid) && !touched.has(cid)) {
        const c = getClient(s, cid);
        cid = c.id;
        touched.add(cid);
        if (c.source !== 'wordpress' && !out.clients.merged.includes(cid)) out.clients.merged.push(cid);
        // the old site may know what the file lacks: never overwrite, only fill in
        const fill = {};
        if (email && !c.email && !byEmail.has(email)) fill.email = email;
        if (phone && !c.phone && !s.clientByPhone.has(phone) && !byPhone.has(phone)) fill.phone = phone;
        if (x.last && !c.last) fill.last = capFirst(x.last).slice(0, 40);
        if (Object.keys(fill).length) ctx.emit('client.updated', { id: cid, cid, patch: {}, fields: Object.keys(fill) }, fill);
      }
      if (phone) byPhone.set(phone, cid);
      if (email) byEmail.set(email, cid);
      return cid;
    }
    if (!phone && !email) return null;
    cid = ctx.id('cl');
    const pii = { first: capFirst(x.first || '').slice(0, 40) || 'Client', last: capFirst(x.last || '').slice(0, 40), phone: phone || '', email, ...(x.notes ? { notes: x.notes } : {}) };
    // consent: service texts yes (they booked with their number), promotions no (never asked on the old site)
    ctx.emit('client.added', { id: cid, cid, source: 'wordpress', sms: true, marketing: false, tags: [], createdAt: pastInstant(x.createdAt, ctx.now) }, pii);
    created.add(cid);
    out.clients.added++;
    if (phone) byPhone.set(phone, cid);
    if (email) byEmail.set(email, cid);
    return cid;
  }
  return { find, created };
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
  const out = run.out, today = ctx.local.day;
  const ext = a.ext || {};
  const status = mapStatus(r.status, !!r.noShow, instantOf(r.day, r.start + (r.dur || a.dur)) <= ctx.now);
  const open = (a.status === 'booked' || a.status === 'pending') && !a.saleId && !a.legacy;
  const movedHere = a.moves > (ext.moves || 0);
  // the slot the old site gave last time: tells a move made there from one made only here
  const wpSlot = r.day + '|' + r.start;
  const wpMoved = ext.slot ? ext.slot !== wpSlot : true;
  const patch = {}, pii = {};
  const ext2 = { ...ext };
  if (r.uniq && !ext.uniq) ext2.uniq = sha256(r.uniq.toLowerCase());
  if (r.note && !a.note) pii.note = r.note.slice(0, 300);
  let did = /** @type {'cancelled'|'moved'|'closed'|'updated'|'already'} */ ('already');
  if (open && status === 'cancelled') {
    ctx.emit('appt.cancelled', { id: a.id, by: 'salon', reason: 'Annulé sur l’ancien site', cid: a.clientId || undefined });
    did = 'cancelled';
  } else if (open && (status === 'done' || status === 'no_show')) {
    // it took place on the old site between the two runs; today's stays for the till, which may still cash it
    if (a.day < today) {
      ctx.emit('appt.status', { id: a.id, status, prev: a.status, cid: a.clientId || undefined });
      patch.legacy = true;
      did = 'closed';
    } else out.review.push({ ...row, kind: 'today', text: 'Terminé aujourd’hui sur l’ancien site : s’il y a été encaissé, ne l’encaisse pas ici' });
  } else if (open && status === 'booked') {
    const to = { day: r.day, start: r.start, staffId: chairOf(s, r.staffId) ? r.staffId : a.staffId, dur: r.dur || a.dur };
    const was = fmtSlot(a, s);
    if (to.day !== a.day || to.start !== a.start || to.staffId !== a.staffId) {
      if (movedHere) { if (wpMoved) out.review.push({ ...row, kind: 'moved', text: 'Déplacé ici et sur l’ancien site : vérifie le créneau (ici ' + was + ')' }); }
      else {
        ctx.emit('appt.moved', { id: a.id, ...to, from: { day: a.day, start: a.start, staffId: a.staffId }, by: 'import', cid: a.clientId || undefined });
        // remember this move as the old site's, so a move made here later is told apart
        ext2.moves = a.moves + 1;
        ext2.slot = wpSlot;
        out.review.push({ ...row, kind: 'moved', text: 'Déplacé sur l’ancien site : était ' + was });
        if (overlaps(s, run.mine, to, a.id)) out.review.push({ ...row, kind: 'overlap', text: 'Chevauche un autre rendez-vous' });
        did = 'moved';
      }
    } else if (to.dur !== a.dur) patch.dur = to.dur; // the WXR's real length, after a CSV-only first run
  } else if (!open && status === 'cancelled' && ACTIVE.has(a.status)) out.review.push({ ...row, kind: 'cancelled', text: 'Annulé sur l’ancien site, mais déjà pris en charge ici : vérifie' });
  else if (a.legacy && a.status === 'done' && status === 'no_show' && !a.saleId) {
    // the WXR dropped after the CSV: a past visit was in fact a no-show
    ctx.emit('appt.status', { id: a.id, status: 'no_show', prev: a.status, cid: a.clientId || undefined });
    did = 'closed';
  }
  if (ext2.uniq !== ext.uniq || ext2.moves !== ext.moves || ext2.slot !== ext.slot) patch.ext = ext2;
  if (Object.keys(patch).length || Object.keys(pii).length) {
    ctx.emit('appt.updated', { id: a.id, patch, cid: a.clientId || undefined }, Object.keys(pii).length ? pii : undefined);
    if (did === 'already') did = 'updated';
  }
  return did;
}

export const importBatch = {
  run(s, input, ctx) {
    ctx.need('settings');
    const x = parse(batchSchema, input);
    const out = {
      clients: { added: 0, merged: /** @type {string[]} */ ([]) },
      // updated: details filled in; moved, closed (took place there), cancelled: what the old site changed since a first run
      appts: { done: 0, noShow: 0, cancelled: 0, booked: 0, skipped: 0, already: 0, updated: 0, moved: 0, closed: 0 },
      giftcards: { added: 0, already: 0, skipped: 0 }, packs: { added: 0, already: 0, skipped: 0 },
      /** @type {{ kind: string, text: string, wp?: number, day?: string, start?: number, name?: string }[]} */
      review: []
    };
    const P = people(s, ctx, out);
    const run = { legacyStaff: /** @type {string|null} */ (null) };
    const today = ctx.local.day;

    for (const c of x.clients || []) P.find(c, { name: [c.first, c.last].filter(Boolean).join(' ') });

    const seen = new Set(), codes = new Set();
    /** upcoming bookings of this run, per chair and day, to report overlaps between them too */
    const mine = new Map();
    const pass = { out, mine };
    for (const r of x.appts || []) {
      const key = String(r.wp);
      if (seen.has(key)) continue;
      seen.add(key);
      const name = [r.first, r.last].filter(Boolean).join(' ');
      const row = { wp: r.wp, day: r.day, start: r.start, name };
      const prev = s.apptByWp.get(key) ? s.appts.get(s.apptByWp.get(key)) : null;
      if (prev) { out.appts[delta(s, ctx, r, prev, row, pass)]++; continue; }
      const missing = r.serviceIds.filter((sid) => !s.services.has(sid));
      const services = missing.length || !r.serviceIds.length ? null : snapshot(s, r.serviceIds, r.price ?? null);
      const dur = r.dur || (services ? totalDur(services) : 30);
      const past = instantOf(r.day, r.start + dur) <= ctx.now;
      const status = mapStatus(r.status, !!r.noShow, past);
      if (!status) { out.appts.skipped++; continue; }
      if (!services) { out.appts.skipped++; out.review.push({ ...row, kind: 'service', text: 'Prestation inconnue : ' + (missing.join(', ') || 'aucune') + ' (ligne ignorée)' }); continue; }
      let staffId = r.staffId;
      // an upcoming booking on the archived profile would be in no lane of the agenda, yet reminded and never blocking
      if (status === 'booked' && !chairOf(s, staffId)) { out.appts.skipped++; out.review.push({ ...row, kind: 'staff', text: 'À venir sans barbier actif : choisis-en un et relance l’import (ligne ignorée)' }); continue; }
      if (staffId === LEGACY_STAFF) staffId = legacyStaff(s, ctx, run);
      else if (!s.staff.has(staffId)) { out.appts.skipped++; out.review.push({ ...row, kind: 'staff', text: 'Barbier inconnu (ligne ignorée)' }); continue; }
      const clientId = P.find(r, row);
      const createdAt = pastInstant(r.createdAt, ctx.now);
      const price = r.price ?? services.reduce((t, v) => t + v.price, 0);
      const paidText = !past && r.paid ? (r.paid >= price ? 'Déjà payé en entier sur l’ancien site (' + fmtEur(r.paid) + ')' : 'Acompte de ' + fmtEur(r.paid) + ' déjà payé sur l’ancien site') : '';
      const notes = [r.note, paidText].filter(Boolean).join(' · ');
      const a = {
        id: ctx.id('ap'), code: uniqueCode(s, ctx, codes), clientId, staffId, anyStaff: false, day: r.day, start: r.start, dur,
        services, price, source: 'import', status, sms: true, deposit: null, cid: clientId || undefined,
        ...(createdAt ? { createdAt } : {}),
        // uniq is the secret of the old e-mail links: only its hash is kept, like any link token
        ext: { wp: r.wp, slot: r.day + '|' + r.start, ...(r.uniq ? { uniq: sha256(r.uniq.toLowerCase()) } : {}), ...(r.paid ? { paid: r.paid } : {}) },
        ...(past ? { legacy: true } : {}),
        ...(status === 'cancelled' ? { cancel: { by: 'salon', reason: 'Annulé sur l’ancien site', at: createdAt || ctx.now, late: false } } : {})
      };
      const pii = { ...(clientId ? {} : { name: name.slice(0, 40) || 'Client' }), ...(notes ? { note: notes.slice(0, 300) } : {}) };
      ctx.emit('appt.booked', a, Object.keys(pii).length ? pii : undefined);
      out.appts[status === 'no_show' ? 'noShow' : status]++;
      if (status !== 'booked') continue;
      if (r.status === 'pending' || r.status === 'pendingpayment') out.review.push({ ...row, kind: 'pending', text: 'En attente sur l’ancien site : confirme avec le client' });
      if (paidText) out.review.push({ ...row, kind: 'paid', text: paidText + ' : à déduire en caisse' });
      // availability rules are skipped (the old site accepted it), but a double booking is worth a look
      if (overlaps(s, mine, { day: r.day, start: r.start, dur, staffId }, a.id)) out.review.push({ ...row, kind: 'overlap', text: 'Chevauche un autre rendez-vous' });
    }

    const hashes = new Set();
    for (const g of x.giftcards || []) {
      const r = issueGift(s, ctx, g, { today, hashes });
      if (r.error) { out.giftcards.skipped++; out.review.push({ kind: 'giftcard', name: '•••• ' + normGiftCode(g.code).slice(-4), text: r.error }); }
      else if (r.already) out.giftcards.already++;
      else out.giftcards.added++;
    }

    const packed = new Set();
    for (const k of x.packs || []) {
      const label = [k.first, k.last].filter(Boolean).join(' ') || k.phone || '';
      if (k.expires < today) { out.packs.skipped++; out.review.push({ kind: 'pack', name: label, text: 'Abonnement expiré le ' + fmtDay(k.expires) }); continue; }
      const cid = k.clientId ? getClient(s, k.clientId).id : k.phone || k.email ? (k.first ? P.find(k, { name: label }) : findOnly(s, k, P)) : null;
      if (!cid) { out.packs.skipped++; out.review.push({ kind: 'pack', name: label, text: 'Aucun client avec ce numéro : ajoute son prénom' }); continue; }
      if (known(s).packs.has(cid) || packed.has(cid)) { out.packs.already++; continue; }
      packed.add(cid);
      issuePack(s, ctx, cid, k);
      out.packs.added++;
    }
    return out;
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
function issueGift(s, ctx, g, { today, hashes }) {
  const norm = normGiftCode(g.code);
  if (norm.length < 4) return { error: 'Code trop court' };
  const codeHash = sha256(norm);
  if (s.giftByHash.has(codeHash) || hashes.has(codeHash)) return { already: true };
  const expires = g.expires || addDays(today, 365);
  if (expires < today) return { error: 'Carte expirée le ' + fmtDay(expires) };
  if (g.amount < 100) return { error: 'Solde nul' };
  hashes.add(codeHash);
  const gid = ctx.id('gc');
  ctx.emit('giftcard.issued', { id: gid, codeHash, last4: norm.slice(-4), amount: g.amount, expires, legacy: true }, { buyer: g.buyer || '', recipient: g.recipient || '' });
  return { id: gid, last4: norm.slice(-4) };
}

/** A subscription started on the old site: the cuts left, until its expiry, on the salon's subscription. */
function issuePack(s, ctx, clientId, k) {
  const sv = (k.serviceId && s.services.get(k.serviceId)?.pack ? s.services.get(k.serviceId) : null) || [...s.services.values()].find((x) => x.active && x.pack) || null;
  const pid = ctx.id('pk');
  ctx.emit('pack.sold', { id: pid, clientId, cid: clientId, name: sv ? sv.name : 'Abonnement', total: k.left, serviceIds: (sv && sv.pack.serviceIds) || [], expires: k.expires, serviceId: sv ? sv.id : null, legacy: true });
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
    const r = issueGift(s, ctx, { ...x, code }, { today: ctx.local.day, hashes: new Set() });
    if (r.already) fail(409, 'exists', 'Cette carte est déjà enregistrée.');
    if (r.error) fail(400, 'invalid', r.error + '.');
    return { id: r.id, last4: r.last4, ...(printed ? { code } : {}) };
  }
};

/** One subscription taken over from a client file. */
export const importPack = {
  run(s, input, ctx) {
    ctx.need('settings');
    const x = parse(onePack, input);
    const c = getClient(s, x.clientId);
    if (c.erased) fail(409, 'erased', 'Cette fiche a été effacée.');
    if (x.expires < ctx.local.day) fail(400, 'invalid', 'Cet abonnement a déjà expiré.');
    if ([...s.packs.values()].some((k) => k.legacy && k.clientId === c.id && k.used < k.total && k.expires >= ctx.local.day)) fail(409, 'exists', 'Un abonnement repris est déjà en cours sur cette fiche.');
    return { id: issuePack(s, ctx, c.id, x) };
  }
};
