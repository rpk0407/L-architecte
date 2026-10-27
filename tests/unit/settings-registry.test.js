import { test } from 'node:test';
import assert from 'node:assert/strict';
import { salon, rejects, at, DAY } from '../helpers.js';
import { testRuntime, browser } from '../api/client.js';
import { DEMO } from '../../server/domain/seed.js';
import { capsOf } from '../../server/domain/permissions.js';
import { createEngine } from '../../server/core/engine.js';
import { defaultSettings, emptyState, TEMPLATES } from '../../server/core/state.js';
import { TEMPLATES as REGISTRY } from '../../server/core/templates.js';
import { SECTIONS, settingsSchema } from '../../server/settings/index.js';
import { EXTENSIONS } from '../../server/core/extensions.js';
import { settingsSchema as fromShop, updateSettings } from '../../server/commands/shop.js';

// The settings as they were written in state.js before the split, key order included.
const BEFORE = () => {
  const day = [[540, 1110]];
  return {
    shop: {
      name: 'Barber L’Architecte', address: '16, place Pélabon', zip: '13013', city: 'Marseille',
      phone: '', email: 'larchitectebarber@gmail.com', siret: '', vatNumber: '', legalName: '',
      mapsUrl: 'https://www.google.com/maps/search/?api=1&query=L%27Architecte%20coiffeur&query_place_id=ChIJJSWkBLy_yRIRbgAQcMwb-JY',
      reviewUrl: 'https://search.google.com/local/writereview?placeid=ChIJJSWkBLy_yRIRbgAQcMwb-JY',
      instagram: 'https://www.instagram.com/barbershoplarchitecte/'
    },
    hours: { 0: [], 1: [], 2: day, 3: day, 4: day, 5: day, 6: day },
    closures: [],
    booking: { enabled: true, stepMin: 30, minNoticeMin: 30, maxDaysAhead: 30, holdMin: 5, pendingPayMin: 15, cancelUntilHours: 12, waitlist: true, walkinWait: true },
    deposits: { mode: 'threshold', thresholdCents: 5000, percent: 30, noShowFeeCents: 1000 },
    payments: { card: true, cash: true, qr: true, giftcard: true, tips: true, tipPresets: [200, 500, 1000], vat: 2000, receiptFooter: 'Merci et à bientôt !' },
    messages: {
      confirmation: true, reminder: true, reminderHour: 18, reminder2h: false, review: true, reviewDelayMin: 120, rebook: true, waitlist: true,
      templates: {
        confirmation: "L'Architecte : c'est noté {prenom} ! {date} à {heure} avec {barbier}. Gérer : {lien}",
        reminder: "L'Architecte : rappel, demain {heure} avec {barbier}. Un imprévu ? Déplace ou annule ici : {lien}",
        reminder2h: "L'Architecte : on t'attend à {heure} avec {barbier}, à tout à l'heure !",
        review: "Merci {prenom} ! 30 secondes pour un avis ? Ça nous aide énormément : {avis}",
        rebook: "Salut {prenom}, déjà {jours} jours depuis ta dernière coupe. On s'y remet ? Réserve ici : {lien}",
        waitlist: "L'Architecte : place libérée {date} à {heure} avec {barbier}, à toi pendant 30 min : {lien}",
        queue: "L'Architecte : c'est presque ton tour, {prenom}. Reviens au salon, on t'installe dans 5 minutes.",
        cancelled: "L'Architecte : ton rendez-vous du {date} à {heure} est annulé. Pour en reprendre un : {lien}",
        receipt: "L'Architecte : merci {prenom} ! Ton ticket {ticket} de {montant} : {lien}"
      }
    },
    team: { barberCheckout: true, barberAllAgenda: true, barberMaxDiscountPct: 10, barberSeeRevenue: false },
    goals: { monthCents: 2400000 }
  };
};

test('the section files add up to exactly the settings of before', () => {
  assert.deepEqual(defaultSettings(), BEFORE());
  assert.equal(JSON.stringify(defaultSettings()), JSON.stringify(BEFORE()), 'same key order');
  assert.deepEqual(emptyState().settings, BEFORE());
  assert.deepEqual(SECTIONS.map((x) => x.key), Object.keys(BEFORE()));
  // the old imports still reach the single definitions
  assert.equal(TEMPLATES, REGISTRY);
  assert.equal(fromShop, settingsSchema);
  // a fresh object each call: changing one never leaks into the next state
  const a = defaultSettings();
  a.booking.stepMin = 15; a.closures.push({ id: 'x', from: '2026-01-01', to: '2026-01-01', label: 'x' }); a.messages.templates.rebook = 'changé';
  assert.deepEqual(defaultSettings(), BEFORE());
});

const ACCEPTED = [
  [{}, {}],
  [{ shop: { name: '  Le Salon  ', zip: '13013', unknown: 'x' } }, { shop: { name: 'Le Salon', zip: '13013' } }],
  [{ shop: null, hours: { 0: [], 2: [[540, 780], [810, 1110]] } }, { hours: { 0: [], 2: [[540, 780], [810, 1110]] } }],
  [{ booking: { stepMin: 15, minNoticeMin: '60', waitlist: false } }, { booking: { stepMin: 15, minNoticeMin: 60, waitlist: false } }],
  [{ deposits: { mode: 'all', percent: 50, noShowFeeCents: 20000 } }, { deposits: { mode: 'all', percent: 50, noShowFeeCents: 20000 } }],
  [{ payments: { tipPresets: [100, 300], vat: 550, receiptFooter: ' À bientôt ' } }, { payments: { tipPresets: [100, 300], vat: 550, receiptFooter: 'À bientôt' } }],
  [{ messages: { reminderHour: 9, templates: { rebook: 'Salut {prenom}, on se revoit ? {lien}' } } }, { messages: { reminderHour: 9, templates: { rebook: 'Salut {prenom}, on se revoit ? {lien}' } } }],
  [{ team: { barberMaxDiscountPct: 0, barberSeeRevenue: true } }, { team: { barberMaxDiscountPct: 0, barberSeeRevenue: true } }],
  [{ goals: { monthCents: 3000000 } }, { goals: { monthCents: 3000000 } }],
  // closures have their own commands, and unknown sections are dropped
  [{ closures: [{ id: 'x', from: '2026-12-24', to: '2026-12-26', label: 'Noël' }], mystery: 1 }, {}]
];
const REJECTED = [
  [{ shop: { name: 'A' } }, 'shop.name : au moins 2 caractères'],
  [{ shop: { reviewUrl: 'http://x.fr' } }, 'shop.reviewUrl : format invalide'],
  [{ shop: { siret: '12a' } }, 'shop.siret : format invalide'],
  [{ shop: 'Le salon' }, 'shop : objet attendu'],
  [{ hours: { 7: [] } }, 'hours.7 : clé invalide'],
  [{ hours: { 1: [[540]] } }, 'hours.1[0] : de 2 à 2 éléments'],
  [{ hours: { 1: [[540, 1500]] } }, 'hours.1[0][1] : entre 0 et 1440'],
  [{ booking: { stepMin: 25 } }, 'booking.stepMin : valeur non permise'],
  [{ booking: { maxDaysAhead: 0 } }, 'booking.maxDaysAhead : entre 1 et 180'],
  [{ booking: { enabled: 'oui' } }, 'booking.enabled : vrai/faux attendu'],
  [{ deposits: { mode: 'sometimes' } }, 'deposits.mode : valeur non permise'],
  [{ deposits: { noShowFeeCents: 20001 } }, 'deposits.noShowFeeCents : entre 0 et 20000'],
  [{ deposits: { percent: 4 } }, 'deposits.percent : entre 5 et 100'],
  [{ payments: { tipPresets: [100, 200, 300, 400, 500] } }, 'payments.tipPresets : de 0 à 4 éléments'],
  [{ payments: { card: 'yes' } }, 'payments.card : vrai/faux attendu'],
  [{ payments: { vat: 3001 } }, 'payments.vat : entre 0 et 3000'],
  [{ messages: { templates: { nope: 'abcdefghijkl' } } }, 'messages.templates.nope : clé invalide'],
  [{ messages: { templates: { review: 'court' } } }, 'messages.templates.review : au moins 10 caractères'],
  [{ messages: { reminderHour: 22 } }, 'messages.reminderHour : entre 8 et 21'],
  [{ messages: { reviewDelayMin: 10 } }, 'messages.reviewDelayMin : entre 30 et 1440'],
  [{ team: { barberMaxDiscountPct: 51 } }, 'team.barberMaxDiscountPct : entre 0 et 50'],
  [{ goals: { monthCents: -1 } }, 'goals.monthCents : entre 0 et 100000000'],
  [{ goals: { monthCents: 1.5 } }, 'goals.monthCents : nombre entier attendu'],
  ['x', 'objet attendu'],
  [[], 'objet attendu']
];

test('the composed schema accepts and rejects the same patches as before', () => {
  for (const [input, out] of ACCEPTED) assert.deepEqual(settingsSchema.parse(input, ''), out, JSON.stringify(input));
  for (const [input, msg] of REJECTED) assert.throws(() => settingsSchema.parse(input, ''), { message: msg, status: 400 }, JSON.stringify(input));
  // every default passes its own section's schema unchanged
  const { closures, ...rest } = defaultSettings();
  assert.deepEqual(settingsSchema.parse(rest, ''), rest);
  // every registered text can be edited, and only those
  for (const k of Object.keys(TEMPLATES)) assert.ok(settingsSchema.parse({ messages: { templates: { [k]: 'Un texte assez long' } } }, '').messages.templates[k]);
});

test('updating the settings still goes through the composed schema', async () => {
  const t = await salon();
  await t.engine.run(updateSettings, { booking: { stepMin: 15 }, goals: { monthCents: 3000000 } }, t.asOwner());
  assert.equal(t.engine.state.settings.booking.stepMin, 15);
  assert.equal(t.engine.state.settings.booking.maxDaysAhead, 30, 'the rest of the section is kept');
  assert.equal(t.engine.state.settings.goals.monthCents, 3000000);
  await rejects(t.engine.run(updateSettings, { booking: { stepMin: 25 } }, t.asOwner()), 'invalid');
  await rejects(t.engine.run(updateSettings, { hours: { 2: [[540, 780], [700, 1110]] } }, t.asOwner()), 'invalid');
});

// A notes extension, as a later package would add one: its own projection, a feed line, and a quiet type next to it.
const notesExt = (seen = []) => ({
  init(s) { s.notes = new Map(); },
  on: {
    'note.added': (s, e, d, p) => { s.notes.set(d.id, { id: d.id, text: p.text, at: e.at, by: e.actor.id }); },
    'note.hidden': (s, e, d) => { s.notes.delete(d.id); },
    // built-in types keep their own branch: an extension never sees them
    'settings.updated': () => { seen.push('settings.updated'); }
  },
  feed: ['note.added'],
  item: (r, f) => (r.caps.has('settings') ? { v: f.v, at: f.at, by: f.actor.t, kind: 'note', title: 'Note ajoutée', sub: f.data.id } : null)
});
// listed in `feed` but with nothing to show it: kept out of the feed
const quietExt = { on: { 'memo.added': (s) => { s.memos = (s.memos || 0) + 1; } }, feed: ['memo.added'] };
const addNote = { run(s, input, ctx) { const id = ctx.id('nt'); ctx.emit('note.added', { id }, { text: input.text }); return { id }; } };
const hideNote = { run(s, input, ctx) { ctx.emit('note.hidden', { id: input.id }); return { ok: true }; } };
const emitRaw = { run(s, input, ctx) { ctx.emit(input.type, {}); return { ok: true }; } };

/** Runs fn with these extensions registered, and always removes them. */
async function withExtensions(list, fn) {
  EXTENSIONS.push(...list);
  try { await fn(); } finally { for (const x of list) EXTENSIONS.splice(EXTENSIONS.indexOf(x), 1); }
}

test('an extension folds its own events, keeps its feed types and survives a replay', async () => {
  const seen = [];
  await withExtensions([notesExt(seen), quietExt], async () => {
    assert.ok(emptyState().notes instanceof Map, 'init runs for every empty state');
    const t = await salon();
    const a = await t.engine.run(addNote, { text: 'Rappeler le fournisseur' }, t.asOwner());
    const b = await t.engine.run(addNote, { text: 'Commander des serviettes' }, t.asOwner());
    await t.engine.run(hideNote, { id: a.id }, t.asOwner());
    await t.engine.run(emitRaw, { type: 'memo.added' }, t.asOwner());
    await t.engine.run(updateSettings, { goals: { monthCents: 2500000 } }, t.asOwner());
    // a type named like an Object method finds no handler instead of calling the inherited one
    for (const type of ['constructor', 'toString', '__proto__']) await t.engine.run(emitRaw, { type }, t.asOwner());
    const S = t.engine.state;
    assert.deepEqual([...S.notes.keys()], [b.id]);
    assert.equal(S.notes.get(b.id).text, 'Commander des serviettes');
    assert.equal(S.notes.get(b.id).by, t.ownerId);
    assert.equal(S.memos, 1);
    assert.deepEqual(seen, []);
    const feed = S.feed.filter((x) => x.type.startsWith('note.') || x.type === 'memo.added');
    assert.deepEqual(feed.map((x) => x.data.id), [a.id, b.id], 'note.added is in the feed; note.hidden and memo.added are not');
    assert.ok(!JSON.stringify(feed).includes('fournisseur'), 'the feed carries the chained data, never the pii');
    // a second server rebuilds the same state from the journal
    const other = createEngine(t.store, { clock: () => t.clock.now, syncEveryMs: 0 });
    await other.sync(true);
    assert.deepEqual([...other.state.notes.values()], [...S.notes.values()]);
    assert.equal(other.state.feed.filter((x) => x.type === 'note.added').length, 2);
  });
  // without it, the same event types are ignored as before
  assert.equal(emptyState().notes, undefined);
});

test('the Comptoir shows an extension feed type through its item, in the feed and the pulse', async () => {
  await withExtensions([notesExt(), quietExt], async () => {
    const clock = { now: at(DAY, 10) };
    const rt = await testRuntime({ clock: () => clock.now });
    const b = browser(rt);
    assert.equal((await b.post('/api/auth/login', { email: DEMO.email, password: DEMO.password })).status, 200);
    const S = rt.engine.state;
    const owner = [...S.staff.values()].find((x) => x.role === 'owner');
    const ctx = { actor: { t: 'staff', id: owner.id }, staff: owner, caps: capsOf(owner, S.settings) };
    const since = S.version;
    const n = await rt.engine.run(addNote, { text: 'Rappeler le fournisseur' }, ctx);
    await rt.engine.run(emitRaw, { type: 'memo.added' }, ctx);
    const feed = await b.get('/api/v1/feed');
    assert.equal(feed.status, 200);
    const line = { v: since + 1, at: clock.now, by: 'staff', kind: 'note', title: 'Note ajoutée', sub: n.id };
    assert.deepEqual(feed.json.items[0], line, 'the newest line of the feed');
    const pulse = await b.get('/api/v1/pulse?since=' + since);
    assert.deepEqual(pulse.json.feed, [line], 'the pulse carries it once, and nothing for memo.added');
  });
});
