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
import trainings from '../../server/settings/trainings.js';
import { DEFAULT_ACCOUNTS } from '../../shared/accounts.js';
import { EXTENSIONS } from '../../server/core/extensions.js';
import { settingsSchema as fromShop, updateSettings } from '../../server/commands/shop.js';

const comptaDefaults = () => ({
  regime: 'a-confirmer', servicesVat: 'encaissements', giftcards: 'multiple', depositVat: true, feesReverseCharge: true, legalForm: 'a-confirmer',
  accounts: { ...DEFAULT_ACCOUNTS }, journals: { sales: 'VE', cash: 'CA', bank: 'BQ', misc: 'OD' },
  accountant: { name: '', firm: '', email: '' }, autoSend: true, ereporting: { from: '2027-09-01', cadence: 'mensuel' }
});

// The settings as they were written in state.js before the split, key order included.
const BEFORE = () => {
  const day = [[540, 1110]];
  return {
    shop: {
      name: 'Barber L’Architecte', address: '16, place Pélabon', zip: '13013', city: 'Marseille',
      phone: '', email: 'larchitectebarber@gmail.com', siret: '', vatNumber: '', legalName: '',
      mapsUrl: 'https://www.google.com/maps/search/?api=1&query=L%27Architecte%20coiffeur&query_place_id=ChIJJSWkBLy_yRIRbgAQcMwb-JY',
      reviewUrl: 'https://search.google.com/local/writereview?placeid=ChIJJSWkBLy_yRIRbgAQcMwb-JY',
      instagram: 'https://www.instagram.com/barbershoplarchitecte/',
      // added since the split: the legal pages' fields
      legalForm: 'Entrepreneur individuel', registration: '', ape: '', publicationDirector: '', mediator: { name: '', url: '' },
      host: { name: 'Vercel Inc.', address: '440 N Barranca Ave #4133, Covina, CA 91723, USA', phone: '+1 559 288 7060' }, dataHost: 'Neon (Union européenne)', cgvVersion: '2026-10-28'
    },
    hours: { 0: [], 1: [], 2: day, 3: day, 4: day, 5: day, 6: day },
    closures: [],
    // WP-06: the days the shop opens when it usually doesn't
    openings: [],
    booking: { enabled: true, stepMin: 30, minNoticeMin: 30, maxDaysAhead: 90, holdMin: 5, pendingPayMin: 15, cancelUntilHours: 12, waitlist: true, walkinWait: true },
    deposits: { mode: 'threshold', thresholdCents: 5000, percent: 30, noShowFeeCents: 1000, riskBased: false },
    payments: { card: true, cash: true, qr: true, giftcard: true, tips: true, tipPresets: [200, 500, 1000], vat: 2000, receiptFooter: 'Merci et à bientôt !' },
    messages: {
      confirmation: true, reminder: true, reminderHour: 18, reminder2h: false, review: true, reviewDelayMin: 120, rebook: true, waitlist: true,
      templates: {
        confirmation: "L'Architecte : c'est noté {prenom} ! {date} à {heure} avec {barbier}. Gérer : {lien}",
        reminder: "L'Architecte : rappel, demain {heure} avec {barbier}. Un imprévu ? Déplace ou annule ici : {lien}",
        reminder2h: "L'Architecte : on t'attend à {heure} avec {barbier}, à tout à l'heure !",
        // REV-02: shorter, so the tracked /avis/ link still fits in one SMS
        review: "Merci {prenom} ! Ton avis Google nous aide énormément : {avis}",
        rebook: "Salut {prenom}, déjà {jours} jours depuis ta dernière coupe. On s'y remet ? Réserve ici : {lien}",
        waitlist: "L'Architecte : place libérée {date} à {heure} avec {barbier}, à toi pendant 30 min : {lien}",
        queue: "L'Architecte : c'est presque ton tour, {prenom}. Reviens au salon, on t'installe dans 5 minutes.",
        cancelled: "L'Architecte : ton rendez-vous du {date} à {heure} est annulé. Pour en reprendre un : {lien}",
        // FID-02: the loyalty card after the ticket
        receipt: "L'Architecte : merci {prenom} ! Ton ticket {ticket} de {montant} : {lien}{fidelite}",
        // WP-04: the link asked from /mon-rendez-vous, and DO-03's gift card code
        lookup: "L'Architecte : ton rendez-vous {date} à {heure} : {lien}{suite}{espace}",
        giftcardCode: "L'Architecte : {acheteur} t'offre une carte cadeau de {montant} ! Code {code}, valable jusqu'au {date}. Réserve : {lien}",
        // DO-05: the handover of an absent barber's clients, and IN-01's gift card bought online
        reassign: "{absent} est absent {date}, {barbier} te prend à {heure}, prix inchangé. Pas d'accord ? {lien}",
        reassignAt: "{absent} est absent {date}, {barbier} te prend à {heure} au lieu de {avant}. Pas d'accord ? {lien}",
        reschedule: "{prenom}, on doit décaler ton rendez-vous du {date}. Choisis un nouveau créneau : {lien}",
        giftcard: "{acheteur} t'offre {montant} chez L'Architecte ! Ton code : {code}. Réserve ici : {lien}",
        // PAY-02: the monthly membership's texts
        memberWelcome: "L'Architecte : bienvenue {prenom} ! Abonnement {formule} ({prix}/mois) actif. Réserve : {lien}",
        memberFailed: "L'Architecte : {prenom}, paiement de l'abonnement ({prix}) refusé. Mets ta carte à jour : {lien}",
        memberAction: "L'Architecte : ta banque demande de valider le paiement de ton abonnement ({prix}). Valide ici : {lien}",
        memberCancelled: "L'Architecte : résiliation enregistrée le {date}. Tes coupes restent incluses jusqu'au {fin}. {lien}",
        memberStopped: "L'Architecte : résiliation enregistrée le {date}. Ton abonnement prend fin aujourd'hui. {lien}",
        memberWithdrawn: "L'Architecte : rétractation enregistrée le {date}. Remboursement de {montant} sous 14 jours. {lien}",
        memberWithdrawnNone: "L'Architecte : rétractation enregistrée le {date}. Tes coupes valent le mois : rien à rembourser. {lien}",
        memberEnded: "L'Architecte : ton abonnement a pris fin faute de paiement. Pour le reprendre : {lien}",
        memberOffer: "L'Architecte : ton abonnement {formule} ({prix}/mois) : {lien}",
        memberLink: "L'Architecte : pour gérer ou résilier ton abonnement (lien valable 1 h) : {lien}",
        memberCard: "L'Architecte : pour mettre à jour la carte de ton abonnement {formule} : {lien}",
        // AC-01: the salon's invite to the client space
        accesInvite: "L'Architecte : ouvre ton espace (tes rendez-vous, tes tickets) : {lien}"
      },
      // GL-08: quiet hours, the STOP mention, the countries texted
      quiet: { from: 1200, to: 480, sunday: true, holidays: true }, stopSuffix: ' STOP au 36173', countries: ['+33', '+32', '+41', '+352', '+262', '+590', '+594', '+596', '+508', '+681', '+687', '+689'],
      // WP-02: confirmations and cancellations by e-mail too
      email: true,
      // MSG-02: WhatsApp off until the owner maps an approved template
      whatsapp: { enabled: false, templates: {} }
    },
    // DO-05: a barber's own absence waits for the owner
    // TEAM-01: what barbers see of colleagues, the nudge of their own regulars, their phones and calendars
    team: { barberCheckout: true, barberAllAgenda: true, barberMaxDiscountPct: 10, barberSeeRevenue: false, timeoffApproval: true, teamView: 'salon', barberRebook: false, personalPhones: true, staffCalendar: true,
      // TEAM-03: the commission rules (Équipe › Rémunération)
      commissionBase: 'ttc', cutCredit: 'performer', memberCredit: 'split', rewardCredit: 'list' },
    // TEAM-03: each barber's goal (null = automatic) and whether barbers see theirs
    goals: { monthCents: 2400000, staff: {}, showBarbers: true },
    // WP-02: what the owner is told without opening the Comptoir
    notify: { to: '', phone: '', newBooking: true, cancel: true, evening: '20:00', weekly: true },
    // the /formations page (WP-05): its modules and certificates
    trainings: trainings.defaults(),
    // PAY-02: the monthly membership, off until the owner switches it on
    membership: { enabled: false, plans: [], graceDays: 7 },
    // CPT-01a: the month the fiscal year ends
    fiscal: { yearEndMonth: 12 },
    // FID-02: the stamp card, off until the owner launches it
    loyalty: { enabled: false, goal: 9, minNet: 1000, reward: { kind: 'service', refs: [], cap: 2500 }, rewardDays: 180, resetDays: 365, headStart: 'half', referral: { enabled: false, referrer: { kind: 'amount', amount: 500 }, referee: { kind: 'amount', amount: 500 }, perYear: 5 } },
    // AC-01: the client space, off until the SMS route is tested (on in the demo, by the seed)
    accounts: { enabled: false, sessionDays: 180, fenceDays: 180 },
    // CPT-03: the books, every choice to confirm once with the accountant
    compta: comptaDefaults()
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
  [{ team: { teamView: 'named', barberSeeRevenue: true, barberRebook: true } }, { team: { teamView: 'named', barberSeeRevenue: false, barberRebook: true } }],
  [{ goals: { monthCents: 3000000 } }, { goals: { monthCents: 3000000 } }],
  [{ fiscal: { yearEndMonth: '6' } }, { fiscal: { yearEndMonth: 6 } }],
  [{ accounts: { enabled: true, sessionDays: 30, fenceDays: 1095 } }, { accounts: { enabled: true, sessionDays: 30, fenceDays: 1095 } }],
  // CPT-03: a role's number, a journal code; an unknown role is dropped
  [{ compta: { regime: 'reel-mensuel', accounts: { 'method.card': '5115', mystery: '1' }, journals: { sales: 'VT' } } }, { compta: { regime: 'reel-mensuel', accounts: { 'method.card': '5115' }, journals: { sales: 'VT' } } }],
  // closures have their own commands, and unknown sections are dropped
  [{ closures: [{ id: 'x', from: '2026-12-24', to: '2026-12-26', label: 'Noël' }], mystery: 1 }, {}],
  // PAY-02: a plan's fair use and flags filled in (a week between two cuts for illimité)
  [{ membership: { enabled: true, graceDays: 5, plans: [{ id: 'illimite', name: ' Illimité ', price: 4900, cuts: 0, serviceIds: ['sv_1'] }, { id: 'essentiel', name: 'Essentiel', price: 3400, cuts: 2, serviceIds: ['sv_1'], online: false }] } },
    { membership: { enabled: true, graceDays: 5, plans: [{ id: 'illimite', name: 'Illimité', price: 4900, cuts: 0, serviceIds: ['sv_1'], minDays: 7, online: true, blurb: '', active: true }, { id: 'essentiel', name: 'Essentiel', price: 3400, cuts: 2, serviceIds: ['sv_1'], online: false, minDays: 0, blurb: '', active: true }] } }]
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
  [{ team: { teamView: 'all' } }, 'team.teamView : valeur non permise'],
  [{ goals: { monthCents: -1 } }, 'goals.monthCents : entre 0 et 100000000'],
  [{ goals: { monthCents: 1.5 } }, 'goals.monthCents : nombre entier attendu'],
  // PAY-02: plans checked one by one, and as a set
  [{ membership: { plans: [{ id: 'e', name: 'Essentiel', price: 3400, cuts: 2, serviceIds: ['sv_1'] }] } }, 'membership.plans[0].id : au moins 2 caractères'],
  [{ membership: { plans: [{ id: 'essentiel', name: 'Essentiel', price: 3400, cuts: 9, serviceIds: ['sv_1'] }] } }, 'membership.plans[0].cuts : entre 0 et 8'],
  [{ membership: { plans: [{ id: 'essentiel', name: 'Essentiel', price: 3400, cuts: 2, serviceIds: [] }] } }, 'membership.plans[0].serviceIds : de 1 à 20 éléments'],
  [{ membership: { plans: [{ id: 'essentiel', name: 'Essentiel', price: 400, cuts: 2, serviceIds: ['sv_1'] }] } }, 'membership.plans[0].price : entre 500 et 50000'],
  [{ membership: { plans: ['a', 'b', 'c', 'd', 'e'].map((k) => ({ id: 'plan-' + k, name: 'Formule', price: 3400, cuts: 2, serviceIds: ['sv_1'] })) } }, 'membership.plans : de 0 à 4 éléments'],
  [{ membership: { plans: [1, 2].map(() => ({ id: 'essentiel', name: 'Essentiel', price: 3400, cuts: 2, serviceIds: ['sv_1'] })) } }, 'membership.plans[1].id : deux formules ont le même code'],
  [{ fiscal: { yearEndMonth: 13 } }, 'fiscal.yearEndMonth : entre 1 et 12'],
  [{ accounts: { sessionDays: 29 } }, 'accounts.sessionDays : entre 30 et 400'],
  [{ accounts: { fenceDays: 60 } }, 'accounts.fenceDays : entre 90 et 1095'],
  [{ accounts: { enabled: 'oui' } }, 'accounts.enabled : vrai/faux attendu'],
  [{ compta: { accounts: { 'revenue.service': '70A' } } }, 'compta.accounts.revenue.service : format invalide'],
  [{ compta: { giftcards: 'unique' } }, 'compta.giftcards : valeur non permise'],
  [{ compta: { regime: 'micro' } }, 'compta.regime : valeur non permise'],
  [{ compta: { journals: { sales: 'VE', bank: 'VE' } } }, 'compta.journals : deux journaux ont le même code (VE)'],
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
  assert.equal(t.engine.state.settings.booking.maxDaysAhead, 90, 'the rest of the section is kept');
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
