// @ts-check
// The projection: what the journal means right now. `evolve` folds one event into the state.
// It is the only code that mutates state, and it runs only for events already stored.
import { GENESIS } from './journal.js';

/** @typedef {import('./journal.js').JEvent} JEvent */

// Written in the GSM alphabet (straight apostrophe, no ç, ê or ô) so each text costs one SMS, not three.
export const TEMPLATES = {
  confirmation: "L'Architecte : c'est noté {prenom} ! {date} à {heure} avec {barbier}. Gérer : {lien}",
  reminder: "L'Architecte : rappel, demain {heure} avec {barbier}. Un imprévu ? Déplace ou annule ici : {lien}",
  reminder2h: "L'Architecte : on t'attend à {heure} avec {barbier}, à tout à l'heure !",
  review: "Merci {prenom} ! 30 secondes pour un avis ? Ça nous aide énormément : {avis}",
  rebook: "Salut {prenom}, déjà {jours} jours depuis ta dernière coupe. On s'y remet ? Réserve ici : {lien}",
  waitlist: "L'Architecte : place libérée {date} à {heure} avec {barbier}, à toi pendant 30 min : {lien}",
  queue: "L'Architecte : c'est presque ton tour, {prenom}. Reviens au salon, on t'installe dans 5 minutes.",
  cancelled: "L'Architecte : ton rendez-vous du {date} à {heure} est annulé. Pour en reprendre un : {lien}",
  receipt: "L'Architecte : merci {prenom} ! Ton ticket {ticket} de {montant} : {lien}"
};

export function defaultSettings() {
  const day = [[540, 1110]];
  return {
    shop: {
      name: 'Barber L’Architecte', address: '16, place Pélabon', zip: '13013', city: 'Marseille',
      phone: '', email: 'larchitectebarber@gmail.com', siret: '', vatNumber: '', legalName: '',
      mapsUrl: 'https://www.google.com/maps/search/?api=1&query=L%27Architecte%20coiffeur&query_place_id=ChIJJSWkBLy_yRIRbgAQcMwb-JY',
      reviewUrl: 'https://search.google.com/local/writereview?placeid=ChIJJSWkBLy_yRIRbgAQcMwb-JY',
      instagram: 'https://www.instagram.com/barbershoplarchitecte/'
    },
    /** weekday (0 = Sunday) → open intervals in minutes */
    hours: { 0: [], 1: [], 2: day, 3: day, 4: day, 5: day, 6: day },
    /** @type {{ id: string, from: string, to: string, label: string }[]} */
    closures: [],
    booking: { enabled: true, stepMin: 30, minNoticeMin: 30, maxDaysAhead: 30, holdMin: 5, pendingPayMin: 15, cancelUntilHours: 12, waitlist: true, walkinWait: true },
    deposits: { mode: 'threshold', thresholdCents: 5000, percent: 30, noShowFeeCents: 1000 },
    payments: { card: true, cash: true, qr: true, giftcard: true, tips: true, tipPresets: [200, 500, 1000], vat: 2000, receiptFooter: 'Merci et à bientôt !' },
    messages: { confirmation: true, reminder: true, reminderHour: 18, reminder2h: false, review: true, reviewDelayMin: 120, rebook: true, waitlist: true, templates: { ...TEMPLATES } },
    team: { barberCheckout: true, barberAllAgenda: true, barberMaxDiscountPct: 10, barberSeeRevenue: false },
    goals: { monthCents: 2400000 }
  };
}

export function emptyState() {
  return {
    version: 0, head: GENESIS, mode: /** @type {null|'demo'|'production'} */ (null), createdAt: 0,
    settings: defaultSettings(),
    staff: new Map(), creds: new Map(), devices: new Map(), deviceByHash: new Map(),
    services: new Map(), products: new Map(),
    clients: new Map(), clientByPhone: new Map(),
    appts: new Map(), apptsByDay: new Map(), apptByToken: new Map(), apptByCode: new Map(),
    holds: new Map(), blocks: new Map(), blocksByDay: new Map(), timeoff: new Map(),
    queue: new Map(), waitlist: new Map(),
    sales: new Map(), salesByDay: new Map(), saleSeq: 0, refunds: new Map(), refundSeq: 0,
    payments: new Map(), paymentByRef: new Map(),
    drawer: /** @type {any} */ (null), drawers: new Map(),
    closures: new Map(), closureSeq: 0, grandTotal: 0,
    giftcards: new Map(), giftByHash: new Map(), packs: new Map(),
    messages: new Map(), eventIds: new Set(), demoDays: new Set(), cfgVersion: 0,
    /** small, recent activity feed for the Comptoir (id, type, at, actor) */
    feed: /** @type {any[]} */ ([])
  };
}
/** @typedef {ReturnType<typeof emptyState>} State */

function isObj(x) { return x && typeof x === 'object' && !Array.isArray(x); }
export function mergeDeep(a, b) {
  if (!isObj(a) || !isObj(b)) return b;
  const o = { ...a };
  for (const k of Object.keys(b)) o[k] = isObj(a[k]) && isObj(b[k]) ? mergeDeep(a[k], b[k]) : b[k];
  return o;
}
function index(map, key, id) { let s = map.get(key); if (!s) { s = new Set(); map.set(key, s); } s.add(id); }
function unindex(map, key, id) { const s = map.get(key); if (s) s.delete(id); }

/** Events that change what the Comptoir loads once at start (settings, team, catalogue). */
const CFG = /^(shop|settings|staff|timeoff|device|service|product|stock)\./;

/** Events worth showing in the live feed. */
const FEED = new Set(['appt.booked', 'appt.cancelled', 'appt.moved', 'appt.status', 'sale.completed', 'sale.refunded', 'payment.succeeded', 'waitlist.added', 'queue.added', 'day.closed', 'drawer.closed', 'stock.adjusted']);

/**
 * @param {State} s
 * @param {JEvent} e
 */
export function evolve(s, e) {
  const d = e.data || {};
  const p = e.pii || {};
  switch (e.type) {
    case 'shop.initialized':
      s.mode = d.mode; s.createdAt = e.at;
      if (d.settings) s.settings = mergeDeep(defaultSettings(), d.settings);
      break;
    case 'settings.updated':
      s.settings = mergeDeep(s.settings, d.patch);
      break;

    case 'staff.added':
      s.staff.set(d.id, { ...d.staff, id: d.id, email: p.email || '', active: true, revokedAt: 0, createdAt: e.at });
      break;
    case 'staff.updated': {
      const x = s.staff.get(d.id);
      if (x) s.staff.set(d.id, { ...x, ...d.patch, ...(p.email !== undefined ? { email: p.email } : {}) });
      break;
    }
    case 'staff.archived': { const x = s.staff.get(d.id); if (x) { x.active = false; x.revokedAt = e.at; } break; }
    case 'staff.restored': { const x = s.staff.get(d.id); if (x) x.active = true; break; }
    case 'staff.credentials': {
      const c = { ...(s.creds.get(d.id) || {}) };
      if (p.pwd !== undefined) c.pwd = p.pwd;
      if (p.pin !== undefined) c.pin = p.pin;
      s.creds.set(d.id, c);
      const x = s.staff.get(d.id);
      if (x) { x.hasPwd = !!c.pwd; x.hasPin = !!c.pin; if (d.revoke) x.revokedAt = e.at; }
      break;
    }
    case 'staff.revoked': { const x = s.staff.get(d.id); if (x) x.revokedAt = e.at; break; }
    case 'timeoff.added': s.timeoff.set(d.id, { ...d, at: e.at }); break;
    case 'timeoff.removed': s.timeoff.delete(d.id); break;

    case 'device.enrolled':
      s.devices.set(d.id, { id: d.id, name: d.name, tokenHash: d.tokenHash, by: e.actor.id, at: e.at, revoked: false });
      s.deviceByHash.set(d.tokenHash, d.id);
      break;
    case 'device.revoked': { const x = s.devices.get(d.id); if (x) { x.revoked = true; s.deviceByHash.delete(x.tokenHash); } break; }

    case 'service.added': s.services.set(d.id, { ...d.service, id: d.id, active: true }); break;
    case 'service.updated': { const x = s.services.get(d.id); if (x) s.services.set(d.id, { ...x, ...d.patch }); break; }
    case 'service.archived': { const x = s.services.get(d.id); if (x) x.active = false; break; }
    case 'product.added': s.products.set(d.id, { ...d.product, id: d.id, active: true }); break;
    case 'product.updated': { const x = s.products.get(d.id); if (x) s.products.set(d.id, { ...x, ...d.patch }); break; }
    case 'product.archived': { const x = s.products.get(d.id); if (x) x.active = false; break; }
    case 'stock.adjusted': { const x = s.products.get(d.productId); if (x) x.stock = (x.stock || 0) + d.delta; break; }

    case 'client.added': {
      const c = { id: d.id, first: p.first || '', last: p.last || '', phone: p.phone || '', email: p.email || '', notes: p.notes || '', tech: p.tech || '', birthday: p.birthday || '', tags: d.tags || [], sms: d.sms !== false, marketing: !!d.marketing, source: d.source || 'salon', createdAt: e.at, erased: false, mergedInto: null, demo: !!d.demo };
      s.clients.set(d.id, c);
      if (c.phone) s.clientByPhone.set(c.phone, d.id);
      break;
    }
    case 'client.updated': {
      const c = s.clients.get(d.id);
      if (!c) break;
      if (p.phone !== undefined && c.phone !== p.phone) { if (s.clientByPhone.get(c.phone) === c.id) s.clientByPhone.delete(c.phone); if (p.phone) s.clientByPhone.set(p.phone, c.id); }
      Object.assign(c, p, d.patch || {});
      break;
    }
    case 'client.merged': {
      const from = s.clients.get(d.from);
      if (!from) break;
      from.mergedInto = d.into;
      if (from.phone && s.clientByPhone.get(from.phone) === from.id) s.clientByPhone.set(from.phone, d.into);
      for (const a of s.appts.values()) if (a.clientId === d.from) a.clientId = d.into;
      for (const x of s.sales.values()) if (x.clientId === d.from) x.clientId = d.into;
      for (const x of s.packs.values()) if (x.clientId === d.from) x.clientId = d.into;
      break;
    }
    case 'client.erased': {
      const ids = new Set(d.ids || [d.id]);
      for (const cid of ids) {
        const c = s.clients.get(cid);
        if (!c) continue;
        if (c.phone && ids.has(s.clientByPhone.get(c.phone))) s.clientByPhone.delete(c.phone);
        Object.assign(c, { first: 'Client', last: 'effacé', phone: '', email: '', notes: '', tech: '', birthday: '', erased: true, sms: false, marketing: false });
      }
      for (const a of s.appts.values()) if (ids.has(a.clientId)) a.note = '';
      for (const m of s.messages.values()) if (ids.has(m.cid)) { m.to = ''; m.body = ''; }
      for (const w of s.waitlist.values()) if (ids.has(w.clientId)) { w.first = ''; w.phone = ''; }
      for (const q of s.queue.values()) if (ids.has(q.clientId)) { q.name = 'Client effacé'; q.phone = ''; }
      break;
    }

    case 'appt.held':
      s.holds.set(d.id, { ...d, at: e.at });
      break;
    case 'hold.released': s.holds.delete(d.id); break;
    case 'appt.booked': {
      const a = {
        id: d.id, code: d.code, tokenHash: d.tokenHash || '', clientId: d.clientId || null, name: p.name || '', note: p.note || '',
        staffId: d.staffId, anyStaff: !!d.anyStaff, day: d.day, start: d.start, dur: d.dur, services: d.services, price: d.price,
        source: d.source, status: d.status || 'booked', createdAt: d.createdAt || e.at, createdBy: e.actor.id, sms: d.sms !== false,
        deposit: d.deposit || null, saleId: null, cancel: null, moves: 0, demo: !!d.demo, statusAt: {}
      };
      s.appts.set(a.id, a);
      index(s.apptsByDay, a.day, a.id);
      if (a.tokenHash) s.apptByToken.set(a.tokenHash, a.id);
      if (a.code) s.apptByCode.set(a.code, a.id);
      if (d.holdId) s.holds.delete(d.holdId);
      break;
    }
    case 'appt.moved': {
      const a = s.appts.get(d.id);
      if (!a) break;
      if (d.day !== a.day) { unindex(s.apptsByDay, a.day, a.id); index(s.apptsByDay, d.day, a.id); }
      Object.assign(a, { day: d.day, start: d.start, staffId: d.staffId ?? a.staffId, dur: d.dur ?? a.dur, moves: a.moves + 1 });
      if (d.anyStaff !== undefined) a.anyStaff = d.anyStaff;
      if (d.holdId) s.holds.delete(d.holdId);
      break;
    }
    case 'appt.updated': {
      const a = s.appts.get(d.id);
      if (!a) break;
      Object.assign(a, d.patch || {});
      if (p.note !== undefined) a.note = p.note;
      if (p.name !== undefined) a.name = p.name;
      break;
    }
    case 'appt.status': {
      const a = s.appts.get(d.id);
      if (!a) break;
      a.status = d.status;
      a.statusAt = { ...a.statusAt, [d.status]: e.at };
      break;
    }
    case 'appt.confirmed': { const a = s.appts.get(d.id); if (a && a.status === 'pending') a.status = 'booked'; break; }
    case 'appt.cancelled': {
      const a = s.appts.get(d.id);
      if (!a) break;
      a.status = 'cancelled';
      a.cancel = { by: d.by, reason: d.reason || '', at: e.at, late: !!d.late, actor: e.actor.id };
      break;
    }

    case 'block.added': s.blocks.set(d.id, { ...d, at: e.at, by: e.actor.id }); index(s.blocksByDay, d.day, d.id); break;
    case 'block.removed': { const b = s.blocks.get(d.id); if (b) { unindex(s.blocksByDay, b.day, b.id); s.blocks.delete(d.id); } break; }

    case 'queue.added': s.queue.set(d.id, { ...d, name: p.name || 'Passage', phone: p.phone || '', at: e.at, status: 'waiting' }); break;
    case 'queue.updated': { const q = s.queue.get(d.id); if (q) Object.assign(q, d.patch, { updatedAt: e.at }); break; }
    case 'waitlist.added': s.waitlist.set(d.id, { ...d, first: p.first || '', phone: p.phone || '', at: e.at, status: 'waiting', offer: null }); break;
    case 'waitlist.updated': { const w = s.waitlist.get(d.id); if (w) Object.assign(w, d.patch); break; }

    case 'sale.completed': {
      const x = { ...d, at: d.at || e.at, by: e.actor.id, refunded: 0, refundIds: [] };
      s.sales.set(d.id, x);
      let list = s.salesByDay.get(d.day);
      if (!list) { list = []; s.salesByDay.set(d.day, list); }
      list.push(d.id);
      s.saleSeq = Math.max(s.saleSeq, d.number);
      if (d.apptId) { const a = s.appts.get(d.apptId); if (a) { a.status = 'done'; a.saleId = d.id; a.statusAt = { ...a.statusAt, done: e.at }; } }
      for (const pay of d.payments || []) {
        if (pay.paymentId) { const py = s.payments.get(pay.paymentId); if (py) py.usedBy = d.id; }
      }
      break;
    }
    case 'sale.refunded': {
      s.refunds.set(d.id, { ...d, at: d.at || e.at, by: e.actor.id });
      s.refundSeq = Math.max(s.refundSeq, d.number);
      const x = s.sales.get(d.saleId);
      if (x) { x.refunded += d.amount; x.refundIds.push(d.id); }
      break;
    }

    case 'payment.created': s.payments.set(d.id, { ...d, status: 'pending', createdAt: e.at }); if (d.providerRef) s.paymentByRef.set(d.providerRef, d.id); break;
    case 'payment.succeeded': {
      const py = s.payments.get(d.id);
      if (!py) break;
      Object.assign(py, { status: 'paid', paidAt: e.at, pm: d.pm || null, customer: d.customer || null, chargeRef: d.chargeRef || py.chargeRef || null });
      if (py.apptId && py.kind === 'deposit') { const a = s.appts.get(py.apptId); if (a && a.deposit) a.deposit = { ...a.deposit, paid: py.amount, paymentId: py.id }; }
      if (py.apptId && py.kind === 'guarantee') { const a = s.appts.get(py.apptId); if (a) a.guarantee = { paymentId: py.id }; }
      break;
    }
    case 'payment.failed': case 'payment.expired': case 'payment.refunded': {
      const py = s.payments.get(d.id);
      if (py) Object.assign(py, { status: e.type.split('.')[1], endedAt: e.at, reason: d.reason || '' });
      break;
    }

    case 'drawer.opened':
      s.drawer = { id: d.id, openedAt: d.at || e.at, openedBy: e.actor.id, float: d.float, moves: [], day: d.day };
      s.drawers.set(d.id, s.drawer);
      break;
    case 'drawer.moved': if (s.drawer && s.drawer.id === d.drawerId) s.drawer.moves.push({ id: d.id, amount: d.amount, reason: d.reason, at: e.at, by: e.actor.id }); break;
    case 'drawer.closed': {
      const x = s.drawers.get(d.drawerId);
      if (x) Object.assign(x, { closedAt: d.at || e.at, closedBy: e.actor.id, counted: d.counted, counts: d.counts, expected: d.expected, diff: d.diff, note: d.note || '' });
      if (s.drawer && s.drawer.id === d.drawerId) s.drawer = null;
      break;
    }
    case 'day.closed':
      s.closures.set(d.day, { ...d, at: d.at || e.at, by: e.actor.id, seal: e.p });
      s.closureSeq = Math.max(s.closureSeq, d.number);
      s.grandTotal = d.grandTotal;
      break;

    case 'giftcard.issued':
      s.giftcards.set(d.id, { ...d, balance: d.amount, issuedAt: e.at, buyer: p.buyer || '', recipient: p.recipient || '', uses: [], status: 'active' });
      s.giftByHash.set(d.codeHash, d.id);
      break;
    case 'giftcard.redeemed': { const g = s.giftcards.get(d.id); if (g) { g.balance -= d.amount; g.uses.push({ saleId: d.saleId, amount: d.amount, at: e.at }); } break; }
    case 'giftcard.voided': { const g = s.giftcards.get(d.id); if (g) g.status = 'void'; break; }
    case 'pack.sold': s.packs.set(d.id, { ...d, used: 0, uses: [], soldAt: e.at }); break;
    case 'pack.used': { const k = s.packs.get(d.id); if (k) { k.used += 1; k.uses.push({ saleId: d.saleId, at: e.at }); } break; }
    case 'pack.returned': { const k = s.packs.get(d.id); if (k) k.used = Math.max(0, k.used - 1); break; }

    case 'demo.seeded': for (const k of d.days || []) s.demoDays.add(k); break;
    case 'message.queued':
      s.messages.set(d.id, { ...d, to: p.to || '', body: p.body || '', status: 'queued', at: e.at });
      break;
    case 'message.updated': { const m = s.messages.get(d.id); if (m) Object.assign(m, d.patch, { updatedAt: e.at }); break; }
    default:
      break;
  }
  s.eventIds.add(e.id);
  if (CFG.test(e.type)) s.cfgVersion = e.v;
  s.version = e.v;
  s.head = e.h;
  if (FEED.has(e.type) && !(e.actor.t === 'system' && (e.type !== 'appt.cancelled' || e.actor.id === 'seed' || e.actor.id === 'demo'))) {
    s.feed.push({ v: e.v, type: e.type, at: e.at, actor: e.actor, data: e.data });
    if (s.feed.length > 300) s.feed.splice(0, s.feed.length - 300);
  }
}
