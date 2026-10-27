// @ts-check
// The demo salon. Ten weeks of history are produced by running the real commands through a throwaway
// engine with a simulated clock: every booking, ticket, cash count and Z closure obeys the same rules
// as live use, so the demo can never show something the product could not do.
import { createEngine } from '../core/engine.js';
import { memoryStore } from '../store/memory.js';
import { CAPS } from './permissions.js';
import { hashSecretSync } from '../auth/password.js';
import { localParts, instantOf, addDays, diffDays, weekday } from '../../shared/dates.js';
import { rng, hashStr } from '../lib/util.js';
import { DENOMS } from '../../shared/money.js';
import { staffIntervals, isFree, freeSlots } from './availability.js';
import { drawerExpected } from './cash.js';
import { clientStats } from './insights.js';
import { initialize } from '../commands/setup.js';
import { addStaff, setCredentials } from '../commands/team.js';
import { addService, updateService, addProduct, adjustStock } from '../commands/catalog.js';
import { addClient } from '../commands/clients.js';
import { createAppointment, setStatus, cancelAppointment, bookOnline, addWait } from '../commands/agenda.js';
import { checkout, openDrawer, closeDrawer, closeDay } from '../commands/sales.js';
import { updateSettings } from '../commands/shop.js';
import { sendRebook } from '../commands/messages.js';
import { seedReviews } from '../commands/reviews.js';
import { startMembership, memberPaid, requestCancel } from '../commands/memberships.js';
import simBilling from '../commands/steps/sim-billing.js';
import { memberOf, cover, addMonths } from './membership.js';
import { fiscalSteps } from '../commands/steps/fiscal.js';
import { demoSigner } from '../core/signer.js';
import { SOFTWARE } from '../version.js';
import { launchLoyalty, importLoyalty, claimReferral } from '../commands/loyalty.js';
import { rewardsOf } from './loyalty.js';
import { rewardValue } from '../../shared/loyalty.js';

export const DEMO = {
  email: 'gerant@larchitecte.fr',
  password: 'Architecte13',
  ownerPin: '1313',
  giftcard: 'CADO-DEMO-2026',
  pins: { JKut: '2468', Frank: '1357', 'Le Soldat': '8642', Esteban: '9753', 'Inès': '1470' }
};

const BARBERS = [
  { name: 'JKut', color: '#EB4639', initials: 'JK', bio: 'Dégradés à la précision chirurgicale. Le fondateur de la méthode « construction au millimètre ».', instagram: 'https://www.instagram.com/jkut.nw', week: { 2: [[540, 750], [780, 1110]], 3: [[540, 750], [780, 1110]], 4: [[540, 750], [780, 1110]], 5: [[540, 750], [780, 1110]], 6: [[540, 750], [780, 1110]] } },
  { name: 'Frank', color: '#F5B544', initials: 'F', bio: 'Coupes classiques et barbes taillées à l’ancienne.', week: { 2: [[540, 780], [810, 1110]], 3: [[540, 780], [810, 1110]], 4: [[540, 780], [810, 1110]], 5: [[540, 780], [810, 1110]], 6: [[540, 780], [810, 1110]] } },
  { name: 'Le Soldat', color: '#60A5FA', initials: 'LS', bio: 'Skin fade, contours nets, couleur et silver.', week: { 2: [[570, 720], [750, 1110]], 3: [[570, 720], [750, 1110]], 4: [[570, 720], [750, 1110]], 5: [[570, 720], [750, 1110]], 6: [[540, 1050]] } },
  { name: 'Esteban', color: '#4ADE80', initials: 'E', bio: 'Textures, boucles et transformations.', week: { 2: [[540, 810], [840, 1110]], 4: [[540, 810], [840, 1110]], 5: [[540, 810], [840, 1110]], 6: [[540, 810], [840, 1110]] } }
];

const SERVICES = [
  { slug: 'cl', name: 'Coupe classique', short: 'Coupe', category: 'Coupes', price: 2000, dur: 30, includes: ['Coupe', 'Shampooing', 'Coiffage'], w: 30 },
  { slug: 'cc', name: 'Coupe + contour de barbe', short: 'Coupe + contour', category: 'Coupes', price: 2500, dur: 30, includes: ['Coupe', 'Contour de la barbe'], w: 20 },
  { slug: 'ct', name: 'Coupe + taille de barbe', short: 'Coupe + taille', category: 'Coupes', price: 3000, dur: 30, includes: ['Coupe', 'Taille de barbe', 'Shampooing', 'Coiffage', 'Soin cheveux', 'Soin barbe'], tag: 'La plus complète', w: 24 },
  { slug: 'tr', name: 'Transformation', category: 'Changer de tête', price: 5000, dur: 60, includes: ['Diagnostic', 'Étude de faisabilité', 'Coupe', 'Coiffage et soin'], tag: 'Changement de look', w: 6 },
  { slug: 'cd', name: 'Coupe + décoloration', short: 'Coupe + déco', category: 'Changer de tête', price: 8000, from: true, dur: 90, includes: ['Coupe', 'Décoloration'], w: 2 },
  { slug: 'de', name: 'Décoloration', category: 'Changer de tête', price: 6000, from: true, dur: 60, includes: ['Décoloration', 'Sans coupe'], description: 'Sous condition de faisabilité.', w: 2 },
  { slug: 'co', name: 'Coloration', category: 'Changer de tête', price: 3000, from: true, dur: 60, includes: ['Coloration', 'Sans coupe'], w: 2 },
  { slug: 'si', name: 'Silver', category: 'Changer de tête', price: 10000, dur: 60, includes: ['Décoloration jusqu’au blanc', 'Coloration grise', 'Soin', 'Produit d’entretien offert'], description: 'Ne pas laver la tête pendant 4 jours minimum.', tag: 'Blanc ou gris', w: 1 },
  { slug: 'eb', name: 'Entretien barbe', category: 'Barbe', price: 1500, dur: 30, includes: ['Contour de la barbe', 'Huile'], w: 5 },
  { slug: 'tb', name: 'Taille de barbe', category: 'Barbe', price: 1800, dur: 30, includes: ['Taille', 'Mise en forme', 'Huile'], w: 5 },
  { slug: 'cb', name: 'Cover barbe', category: 'Barbe', price: 1500, dur: 30, includes: ['Couleur de la barbe', 'Soin'], w: 2 },
  // the prepaid pack is a « carnet », sold at the till (« abonnement » is the monthly membership below)
  { slug: 'ab', name: 'Carnet 5 coupes', short: 'Carnet', category: 'Carnet', price: 8000, dur: 30, online: false, includes: ['5 coupes sur 5 semaines', 'Sans barbe'], description: '16 € la coupe. Il se prend au salon : on fixe tes coupes avec toi.', tag: '16 € la coupe', w: 0, pack: { credits: 5, days: 70 } }
];

/* the monthly membership (PAY-02): two formules, sixteen members over the history, the demo's billing renews them */
const PLANS = [
  { id: 'essentiel', name: 'Essentiel', price: 3400, cuts: 2, minDays: 0, slugs: ['cl'], blurb: '2 coupes classiques par mois, sans engagement.' },
  { id: 'illimite', name: 'Illimité', price: 4900, cuts: 0, minDays: 7, slugs: ['cl', 'cc'], blurb: 'Une coupe chaque semaine, contour de barbe compris.' }
];
/**
 * What happens to each of the sixteen members, counted back from today: 12 run, 1 has its renewal refused (in grace), 1
 * ends at its period's end, 2 were cancelled. ago: days before today it starts (kept inside the history); a start or a
 * cancellation on a closed day happens on the next open one. graceAt: started so that the renewal is due yesterday;
 * endAt: so that the period ends in four days. The members are regulars whose usual service a formule covers, picked
 * from the clientele as it is drawn, so the rest of the demo (bookings, the random draws) stays what it was.
 */
const MEMBERS = [
  { ago: 66 }, { ago: 60 }, { ago: 55, salon: true }, { ago: 49 }, { ago: 43 }, { ago: 38 }, { ago: 31, salon: true }, { ago: 26 },
  { ago: 19 }, { ago: 12 }, { ago: 7 }, { ago: 3 }, { graceAt: true }, { endAt: true, cancelAgo: 6 },
  { ago: 67, cancelAfter: 10, by: 'salon' }, { ago: 62, cancelAfter: 20 }
];
/** A demo run of the simulated provider's billing, as the tick does it (steps/sim-billing.js). */
const SIM_BILLING = { run(s, input, ctx) { simBilling.run(s, ctx); return {}; } };

/** The membership that pays one of this appointment's services today, as the till would offer it, or null. */
export function memberCut(s, a, day) {
  const m = a.clientId ? memberOf(s, a.clientId) : null;
  if (!m || !m.activatedAt) return null;
  const sv = a.services.find((x) => cover(s, m, x.id, { day }).ok);
  return sv ? { memberId: m.id, serviceId: sv.id } : null;
}

const PRODUCTS = [
  { name: 'Huile à barbe', price: 1500, cost: 600, stock: 14, low: 4, category: 'Barbe', w: 5 },
  { name: 'Cire mate', price: 1400, cost: 500, stock: 9, low: 4, category: 'Coiffage', w: 4 },
  { name: 'Pommade brillante', price: 1400, cost: 500, stock: 3, low: 4, category: 'Coiffage', w: 2 },
  { name: 'Baume après-rasage', price: 1200, cost: 400, stock: 11, low: 3, category: 'Barbe', w: 2 },
  { name: 'Shampooing fortifiant', price: 1600, cost: 600, stock: 7, low: 3, category: 'Soin', w: 2 },
  { name: 'Peigne en bois', price: 600, cost: 200, stock: 20, low: 5, category: 'Accessoires', w: 1 }
];

const FIRST = ['Yanis', 'Mehdi', 'Lucas', 'Karim', 'Nolan', 'Enzo', 'Sofiane', 'Hugo', 'Adam', 'Ilyes', 'Matteo', 'Bilal', 'Théo', 'Nassim', 'Kylian', 'Jules', 'Samir', 'Walid', 'Ethan', 'Amine', 'Louis', 'Ryad', 'Malik', 'Gabriel', 'Anis', 'Noah', 'Sami', 'Yassine', 'Tom', 'Axel', 'Nathan', 'Ismaël', 'Raphaël', 'Hamza', 'Marius', 'Zakaria', 'Jordan', 'Kenzo', 'Sacha', 'Dylan', 'Younes', 'Lenny', 'Mathis', 'Wassim', 'Imran', 'Léo', 'Djibril', 'Timéo', 'Nabil', 'Kaïs', 'Lounis', 'Bastien', 'Moussa', 'Florian', 'Chris', 'Idriss', 'Kevin', 'Maxime', 'Yann', 'Aymen'];
const LAST = ['Martin', 'Benali', 'Rossi', 'Fabre', 'Haddad', 'Garcia', 'Moreau', 'Mansouri', 'Romano', 'Durand', 'Belkacem', 'Lopez', 'Bernard', 'Chabane', 'Ferrari', 'Girard', 'Amrani', 'Blanc', 'Mercier', 'Ziani', 'Santini', 'Bouzid', 'Faure', 'Ricci', 'Kaci', 'Roux', 'Medjahed', 'Pons', 'Esposito', 'Brahimi'];
const TECH = ['Dégradé bas, sabot 0,5 sur les côtés', 'Garde la longueur sur le dessus', 'Barbe : ne pas trop raccourcir', 'Raie à gauche, bien marquée', 'Skin fade, dessus texturé', 'Ciseaux uniquement sur le dessus', 'Taper, nuque arrondie', 'Contour au rasoir, pas à la tondeuse', 'Cuir chevelu sensible : pas de lotion alcoolisée', '', '', '', ''];
const NOTES = ['Vient avec son fils le samedi', 'Préfère les créneaux du matin', 'Toujours à l’heure', 'Aime parler foot', '', '', '', '', ''];

const SYS = { actor: /** @type {const} */ ({ t: 'system', id: 'seed', n: 'Démo' }), caps: new Set(Object.keys(CAPS)) };

function weighted(r, items) {
  const total = items.reduce((t, x) => t + x.w, 0);
  let x = r() * total;
  for (const it of items) { x -= it.w; if (x <= 0) return it; }
  return items[0];
}
/** Split an amount into notes and coins, the way the drawer is counted. */
export function denominations(cents) {
  const out = {};
  let left = cents;
  for (const d of DENOMS) { const n = Math.floor(left / d); if (n) { out[d] = n; left -= n * d; } }
  return out;
}
function fillFor(day, today) {
  const ahead = diffDays(today, day);
  const wd = weekday(day);
  const base = wd === 6 ? 0.9 : wd === 5 ? 0.8 : wd === 2 ? 0.62 : 0.7;
  if (ahead <= 0) return base;
  return Math.max(0.12, base - ahead * 0.055);
}

/**
 * Plan of appointments to add on a day (inputs for createAppointment).
 * @param {any} s state
 * @param {string} day
 * @param {number} fill target share of free time booked
 * @param {() => number} r
 * @param {(staffId: string) => any} pickClient
 * @param {number} now
 */
export function planDay(s, day, fill, r, pickClient, now) {
  const services = [...s.services.values()].filter((x) => x.active && !x.pack);
  /** @type {any[]} */
  const plans = [];
  const taken = new Map();
  for (const st of [...s.staff.values()].filter((x) => x.active && x.chair)) {
    const busy = [];
    for (const [a, b] of staffIntervals(s, st.id, day)) {
      let t = a;
      while (t + 30 <= b) {
        if (r() > fill) { t += 30; continue; }
        const c = pickClient(st.id) || (r() < 0.6 ? { id: null, name: FIRST[Math.floor(r() * FIRST.length)], fav: null } : null);
        if (!c) { t += 30; continue; }
        let sv = c.fav && r() < 0.7 ? s.services.get(c.fav) : weighted(r, services.map((x) => ({ ...x, w: (SERVICES.find((y) => y.slug === x.slug) || { w: 1 }).w })));
        if (!sv || sv.pack) sv = services[0];
        if (t + sv.dur > b) sv = services[0];
        if (t + sv.dur > b) break;
        if (!isFree(s, st.id, day, t, sv.dur, { now }) || busy.some(([x, y]) => x < t + sv.dur && t < y)) { t += 30; continue; }
        if (c.id && (taken.get(c.id) || 0) > 0) { t += 30; continue; }
        if (c.id) taken.set(c.id, 1);
        busy.push([t, t + sv.dur]);
        const src = r();
        plans.push({ ...(c.id ? { clientId: c.id } : { name: c.name }), serviceIds: [sv.id], staffId: st.id, day, start: t, source: !c.id ? 'walkin' : src < 0.58 ? 'site' : src < 0.9 ? 'phone' : 'walkin', sms: false, demo: true });
        t += sv.dur;
      }
    }
  }
  return plans.sort((a, b) => a.start - b.start);
}

/**
 * The reward a demo client uses on this appointment, 7 times out of 10 when one waits (FID-02): on the first line it
 * applies to. Drawn from the appointment's day, time and number, not from r, so the demo's other draws stay what they were
 * (and the same demo comes out every time: ids are random).
 * @returns {{ i: number, id: string, off: number } | null}
 */
function demoReward(s, a, lines) {
  const c = a.clientId ? s.clients.get(a.clientId) : null;
  if (!c || hashStr('fid|' + a.day + '|' + a.start + '|' + c.phone) % 10 >= 7) return null;
  const rw = rewardsOf(s, a.clientId, a.day)[0];
  if (!rw) return null;
  for (const [i, l] of lines.entries()) {
    if ((l.kind !== 'service' && l.kind !== 'product') || l.packId || l.memberId) continue;
    const unit = l.kind === 'service' ? l.unit : (s.products.get(l.ref) || {}).price || 0;
    const off = rewardValue(rw.reward, { kind: l.kind, ref: l.ref, unit, qty: 1 });
    if (off > 0) return { i, id: rw.id, off };
  }
  return null;
}

/** What a demo client pays: the menu price, sometimes a product, a tip, a loyalty discount or a reward of his card. */
export function demoCheckoutInput(s, a, r, { cash = true, packId = null, member = /** @type {{ memberId: string, serviceId: string } | null} */ (null) } = {}) {
  let covered = false;
  const lines = a.services.map((sv) => {
    const base = s.services.get(sv.id);
    const unit = base && base.from ? sv.price + Math.floor(r() * 3) * 1000 : sv.price;
    // the month already paid covers one cut (before any carnet)
    if (member && !covered && sv.id === member.serviceId) { covered = true; return { kind: 'service', ref: sv.id, unit: sv.price, memberId: member.memberId }; }
    return { kind: 'service', ref: sv.id, unit, ...(packId && base && base.slug === 'cl' ? { packId } : {}) };
  });
  const products = [...s.products.values()].filter((p) => p.active);
  if (r() < 0.12 && products.length) {
    const p = weighted(r, products.map((x) => ({ ...x, w: (PRODUCTS.find((y) => y.name === x.name) || { w: 1 }).w })));
    lines.push({ kind: 'product', ref: p.id });
  }
  const gross = lines.reduce((t, l) => t + (l.kind === 'service' ? (l.packId || l.memberId ? 0 : l.unit) : (s.products.get(l.ref)?.price || 0)), 0);
  // a cut the membership pays draws as a paid one did (the demo's other draws stay in step), and may still get a tip
  const drawn = gross > 0 || covered;
  const typed = drawn && r() < 0.03 && gross > 0 ? { amount: Math.round(gross * 0.1 / 100) * 100, reason: 'Fidélité' } : undefined;
  const tip = drawn && r() < 0.22 ? { amount: r() < 0.7 ? 200 : 500, staffId: a.staffId } : undefined;
  // a reward of the card takes the place of a typed loyalty discount
  const reward = demoReward(s, a, lines);
  if (reward) lines[reward.i] = { ...lines[reward.i], rewardId: reward.id };
  const discount = reward ? undefined : typed;
  const due = gross - (reward ? reward.off : 0) - (discount ? discount.amount : 0) + (tip ? tip.amount : 0);
  const payCash = cash && r() < 0.34;
  const given = payCash ? Math.ceil(due / 1000) * 1000 + (r() < 0.3 ? 1000 : 0) : undefined;
  const payments = due > 0 ? [payCash ? { method: 'cash', amount: due, given } : { method: 'card', amount: due }] : [{ method: 'card', amount: 0 }];
  return { apptId: a.id, lines, ...(discount ? { discount } : {}), ...(tip ? { tip } : {}), payments };
}

/**
 * Build the whole demo journal.
 * @param {number} nowReal
 * @param {{ weeks?: number, ahead?: number, siteUrl?: string }} [opt]
 */
export async function buildDemoJournal(nowReal, opt = {}) {
  const weeks = opt.weeks ?? 10, ahead = opt.ahead ?? 14;
  let clock = nowReal;
  const eng = createEngine(memoryStore(), { clock: () => clock, syncEveryMs: 60000 });
  const today = localParts(nowReal).day;
  const start = addDays(today, -weeks * 7);
  const r = rng(hashStr('larchitecte|' + start));
  const at = (day, min) => { clock = Math.min(nowReal, instantOf(day, min)); };

  at(start, 7 * 60);
  const init = await eng.run(initialize, { mode: 'demo', owner: { name: 'Le gérant', email: DEMO.email }, pwdHash: hashSecretSync(DEMO.password), pinHash: hashSecretSync(DEMO.ownerPin) }, SYS);
  const base = { ...SYS, staff: eng.state.staff.get(init.ownerId), meta: { siteUrl: opt.siteUrl || 'https://larchitecte.fr/site' } };
  await eng.run(updateSettings, { shop: { phone: '04 91 00 00 00', legalName: 'L’Architecte SAS', legalForm: 'SAS', siret: '000 000 000 00000' } }, base);
  for (const [i, b] of BARBERS.entries()) {
    const res = await eng.run(addStaff, { name: b.name, role: 'barber', color: b.color, initials: b.initials, bookable: true, chair: true, schedule: b.week, commission: { service: 4000, product: 1000 }, bio: b.bio, instagram: b.instagram, order: i + 1 }, base);
    await eng.run(setCredentials, { id: res.id, pinHash: hashSecretSync(DEMO.pins[b.name]) }, base);
  }
  // the desk persona (TEAM-01): Inès on the tablet sees the salon's counts and fill, never its money
  const desk = await eng.run(addStaff, { name: 'Inès', role: 'desk', order: BARBERS.length + 1 }, base);
  await eng.run(setCredentials, { id: desk.id, pinHash: hashSecretSync(DEMO.pins['Inès']) }, base);
  // barbers may text their own regulars in the demo (off in production)
  await eng.run(updateSettings, { team: { barberRebook: true } }, base);
  const slugId = {};
  for (const [i, sv] of SERVICES.entries()) {
    const { w, ...rest } = sv;
    const res = await eng.run(addService, { ...rest, order: i }, base);
    slugId[sv.slug] = res.id;
  }
  // the carnet covers the classic cut only
  await eng.run(updateService, { id: slugId.ab, patch: { pack: { credits: 5, days: 70, serviceIds: [slugId.cl] } } }, base);
  await eng.run(updateSettings, { membership: { enabled: true, plans: PLANS.map(({ slugs, ...p }) => ({ ...p, serviceIds: slugs.map((k) => slugId[k]), online: true, active: true })) } }, base);
  // FID-02: the stamp card, launched before the history so its tickets earn for real: 9 paid visits, the 10th cut
  // offered up to 25 €, referral on (off in production)
  await eng.run(updateSettings, { loyalty: { enabled: true, goal: 9, reward: { kind: 'service', refs: [], cap: 2500 }, referral: { enabled: true } } }, base);
  await eng.run(launchLoyalty, { headStart: 'half' }, base);
  for (const p of PRODUCTS) { const { w, stock, ...rest } = p; const res = await eng.run(addProduct, rest, base); await eng.run(adjustStock, { id: res.id, delta: stock + 6, reason: 'Stock initial' }, base); }

  /* the clientele */
  const barberIds = [...eng.state.staff.values()].filter((x) => x.chair).map((x) => x.id);
  const pool = [];
  for (let i = 0; i < 520; i++) {
    const first = FIRST[i % FIRST.length], last = LAST[(i + Math.floor(i / FIRST.length) * 11) % LAST.length];
    const phone = '+3363998' + String(i * 17 % 10000).padStart(4, '0');
    const res = await eng.run(addClient, {
      first, last, phone, email: r() < 0.25 ? first.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '') + '.' + last.toLowerCase() + '@exemple.fr' : '',
      tech: TECH[Math.floor(r() * TECH.length)], notes: NOTES[Math.floor(r() * NOTES.length)], sms: r() > 0.05, marketing: r() < 0.6,
      tags: r() < 0.08 ? ['VIP'] : []
    }, base);
    const favSlug = weighted(r, SERVICES.filter((x) => x.w > 0)).slug;
    const cadence = [14, 21, 21, 28, 28, 35, 42][Math.floor(r() * 7)];
    // one regular in nine drifts away: they are the ones Relances should bring back
    const stop = i % 9 === 4 ? addDays(today, -(cadence + 8 + Math.floor(r() * 21))) : null;
    // the last 200 discover the salon along the way: new clients every week
    const join = i >= 320 ? addDays(start, Math.floor(((i - 320) / 200) * weeks * 7)) : null;
    pool.push({ id: res.id, pref: barberIds[Math.floor(r() * barberIds.length)], cadence, fav: slugId[favSlug], last: null, packId: null, abo: i % 19 === 3, booked: null, stop, join });
  }
  // the clientele came before these ten weeks: its paper cards are taken over (1 to 8 stamps, from its place in the
  // list, not from r), so full cards and rewards show from the first weeks
  await eng.run(importLoyalty, { rows: pool.slice(0, 320).map((c, i) => ({ clientId: c.id, units: 1 + (hashStr('card|' + i) % 8) })) }, base);
  // regulars who come every four weeks at most for a cut a formule covers: Illimité for the contour or the frequent ones
  // (from the end of the list: the first files stay plain clients, as the tests and the demo script know them)
  const regulars = pool.filter((c) => !c.abo && !c.stop && !c.join && c.cadence <= 28 && (c.fav === slugId.cl || c.fav === slugId.cc)).reverse();
  const plans = MEMBERS.slice(0, regulars.length).map((x, i) => {
    const c = regulars[i];
    const plan = /** @type {any} */ (PLANS[c.fav === slugId.cc || c.cadence <= 14 ? 1 : 0]);
    const startDay = x.graceAt ? addMonths(addDays(today, -1), -1) : x.endAt ? addMonths(addDays(today, 4), -1) : addDays(today, -(x.ago || 0));
    const from = startDay < start ? start : startDay;
    const cancelDay = x.cancelAgo != null ? addDays(today, -x.cancelAgo) : x.cancelAfter != null ? addDays(from, x.cancelAfter) : null;
    return { ...x, c, plan, from, cancelDay: cancelDay && cancelDay < from ? from : cancelDay, id: '', started: false, cancelled: false };
  });
  const pickClient = (day) => (staffId) => {
    const due = pool.filter((c) => (!c.booked || c.booked < day) && (!c.stop || day < c.stop) && (!c.join || day >= c.join)).filter((c) => !c.last || diffDays(c.last, day) >= c.cadence * 0.75);
    const mine = due.filter((c) => c.pref === staffId);
    const list = mine.length && r() < 0.8 ? mine : due;
    if (!list.length) return null;
    const c = list[Math.floor(r() * list.length)];
    return c;
  };
  const byId = new Map(pool.map((c) => [c.id, c]));
  const giftDays = new Set([addDays(start, 9), addDays(start, 23), addDays(today, -3)]);
  const seeded = [];

  /* the memberships of the day, before the salon opens: the simulated provider's renewals and ends, new members, cancellations */
  const memberOps = async (day) => {
    at(day, 7 * 60 + 45);
    for (let i = 0; i < 40; i++) { const v = eng.state.version; await eng.run(SIM_BILLING, {}, base); if (eng.state.version === v) break; }
    for (const p of plans) {
      if (!p.started && p.from <= day) {
        p.started = true;
        const cl = eng.state.clients.get(p.c.id);
        const res = await eng.run(startMembership, { planId: p.plan.id, first: cl.first, phone: cl.phone, ...(cl.email ? { email: cl.email } : {}), provider: 'simulated', providerRef: 'sim_co_' + p.c.id, channel: p.salon ? 'salon' : 'online', ...(p.graceAt ? { demoFail: true } : {}) }, base);
        p.id = res.id;
        await eng.run(memberPaid, { id: res.id, invoice: 'sim_' + res.id + '_0', amount: p.plan.price, periodStart: day, periodEnd: addMonths(day, 1), chargeRef: 'sim_ch_' + res.id + '_0', customer: 'cus_sim_' + p.c.id, subscription: 'sub_sim_' + p.c.id, card: p.from.endsWith('5') ? 'Mastercard •• 5100' : 'Visa •• 4242' }, base);
      }
      if (p.started && !p.cancelled && p.cancelDay && p.cancelDay <= day) {
        p.cancelled = true;
        await eng.run(requestCancel, { id: p.id, by: p.by || 'client', channel: p.by === 'salon' ? 'comptoir' : 'site' }, base);
      }
    }
  };

  /* six newcomers say at the till who sent them (FID-02), the first open day of theirs: a regular who already came */
  const referees = new Set([360, 390, 420, 450, 480, 505].map((i) => pool[i]).filter(Boolean));
  const referrals = async (day) => {
    for (const c of referees) {
      if (!c.join || c.join > day) continue;
      referees.delete(c);
      at(day, 7 * 60 + 50);
      const start = pool.indexOf(c) % 300;
      for (let k = 0; k < 12; k++) {
        const by = pool[(start + k * 23) % 320];
        if (!by.last) continue;
        const res = await eng.run(claimReferral, { refereeId: c.id, referrerId: by.id, via: 'till' }, base);
        if (res.ok) break;
      }
    }
  };

  /* one day of the salon */
  const runDay = async (day, isToday) => {
    await memberOps(day);
    await referrals(day);
    if (weekday(day) === 2 || weekday(day) === 5) {
      at(day, 8 * 60 + 30);
      for (const p of eng.state.products.values()) {
        if (p.name === 'Pommade brillante' && diffDays(day, today) < 26) continue; // keeps one low-stock alert in the demo
        if (p.stock < p.low + 6) await eng.run(adjustStock, { id: p.id, delta: 12 - Math.min(0, p.stock), reason: 'Livraison fournisseur' }, base);
      }
    }
    at(day, 8 * 60);
    // the review requests of the last evening's visits leave as the quiet hours end, as the tick sends them (REV-02)
    await eng.run(seedReviews, {}, base);
    const plans = planDay(eng.state, day, fillFor(day, today), r, pickClient(day), clock);
    for (const p of plans) { const c = byId.get(p.clientId); if (c) c.booked = day; await eng.run(createAppointment, p, base).catch(() => null); }
    seeded.push(day);
    const appts = [...(eng.state.apptsByDay.get(day) || [])].map((id) => eng.state.appts.get(id)).filter((a) => a && a.status === 'booked');
    // a few cancel in the morning
    for (const a of appts) if (r() < 0.03) await eng.run(cancelAppointment, { id: a.id, reason: 'Empêchement' }, base);
    const nowMin = isToday ? localParts(nowReal).min : 1440;
    if (nowMin > 8 * 60 + 50) { at(day, 8 * 60 + 50); await eng.run(openDrawer, { float: 15000 }, base); }
    const live = appts.filter((a) => eng.state.appts.get(a.id).status === 'booked').sort((a, b) => a.start + a.dur - (b.start + b.dur));
    for (const a of live) {
      const end = a.start + a.dur;
      if (end + 20 > nowMin) {
        if (isToday && a.start <= nowMin) { at(day, Math.min(nowMin, a.start + 2)); await eng.run(setStatus, { id: a.id, status: 'in_chair' }, base).catch(() => null); }
        continue;
      }
      if (r() < 0.03) { at(day, a.start + 12); await eng.run(setStatus, { id: a.id, status: 'no_show' }, base).catch(() => null); continue; }
      at(day, end + 2);
      const c = a.clientId ? byId.get(a.clientId) : null;
      const cur = eng.state.appts.get(a.id);
      let packId = null;
      const isCut = cur.services.length === 1 && eng.state.services.get(cur.services[0].id)?.slug === 'cl';
      if (c && c.abo && isCut) {
        const pk = c.packId ? eng.state.packs.get(c.packId) : null;
        if (pk && pk.used < pk.total) packId = pk.id;
      }
      let input = demoCheckoutInput(eng.state, cur, r, { packId, member: memberCut(eng.state, cur, day) });
      if (c && c.abo && isCut && !packId) {
        // first visit of a subscriber: buys the pack, today's cut is the first of five
        input = { apptId: cur.id, lines: [{ kind: 'pack', ref: slugId.ab }, { kind: 'service', ref: slugId.cl, packId: 'new' }], payments: [{ method: 'card', amount: 8000 }] };
      }
      const res = await eng.run(checkout, input, base).catch((e) => { if (process.env.LX_DEBUG) console.error('seed checkout', e.message); return null; });
      if (res && c && c.abo && !packId && input.lines[0].kind === 'pack') c.packId = [...eng.state.packs.values()].find((k) => k.saleId === res.id)?.id || null;
      if (c) { c.last = day; c.booked = null; }
      // a third of clients book their next cut before leaving
      if (res && c && r() < 0.33 && (!c.stop || addDays(day, c.cadence) < c.stop)) {
        const next = addDays(day, c.cadence);
        if (diffDays(today, next) <= ahead && diffDays(today, next) >= -60) {
          const free = [600, 660, 720, 840, 900, 960, 1020].find((m) => isFree(eng.state, cur.staffId, next, m, cur.dur, { now: clock }));
          if (free != null) { await eng.run(createAppointment, { clientId: c.id, serviceIds: cur.services.map((x) => x.id), staffId: cur.staffId, day: next, start: free, source: 'salon', sms: false, demo: true }, base).catch(() => null); c.booked = next; }
        }
      }
    }
    if (giftDays.has(day)) {
      at(day, 17 * 60);
      const known = day === addDays(today, -3);
      const amount = known ? 5000 : 3000 + Math.floor(r() * 3) * 1000;
      await eng.run(checkout, { lines: [{ kind: 'giftcard', unit: amount, recipient: known ? 'Pour Karim' : 'Anniversaire', ...(known ? { code: DEMO.giftcard } : {}) }], payments: [{ method: 'card', amount }] }, base);
    }
    if (!isToday && eng.state.drawer) {
      at(day, 18 * 60 + 40);
      const exp = drawerExpected(eng.state, eng.state.drawer);
      const off = r() < 0.12 ? (r() < 0.5 ? -200 : 100) : 0;
      await eng.run(closeDrawer, { counts: denominations(Math.max(0, exp + off)), note: off ? (off < 0 ? 'Monnaie rendue en trop sur un ticket' : 'Pourboire laissé dans la caisse') : undefined }, base);
      at(day, 18 * 60 + 45);
      await eng.run(closeDay, {}, base);
    }
    if (!isToday) { at(day, 19 * 60 + 55); await eng.run(seedReviews, {}, base); }
  };

  // three weeks ago the owner sent a round of relances; a good share of them came back
  let relanced = false;
  const sendRelances = async (day) => {
    at(day, 10 * 60);
    const stats = clientStats(eng.state, day, clock);
    const late = pool.filter((c) => stats.get(c.id)?.overdue && eng.state.clients.get(c.id)?.sms).slice(0, 16);
    if (!late.length) return;
    await eng.run(sendRebook, { clientIds: late.map((c) => c.id) }, base).catch(() => null);
    for (const c of late) {
      if (r() > 0.45) continue;
      c.stop = null;
      for (let k = 2; k <= 6; k++) {
        const next = addDays(day, k);
        if (next >= today || !eng.state.settings.hours[weekday(next)]?.length) continue;
        const svc = eng.state.services.get(c.fav);
        const free = svc && [600, 690, 780, 870, 960, 1020].find((m) => isFree(eng.state, c.pref, next, m, svc.dur + (svc.buffer || 0), { now: clock }));
        if (free == null) continue;
        at(day, 10 * 60 + 30 + Math.floor(r() * 400));
        const res = await eng.run(createAppointment, { clientId: c.id, serviceIds: [c.fav], staffId: c.pref, day: next, start: free, source: 'site', sms: false, demo: true }, base).catch(() => null);
        if (res) { c.booked = next; break; }
      }
    }
  };
  // CPT-01a: the tick's month closures and signatures, each morning at 05:10 (the first day, once the salon exists)
  const fiscalDay = (d) => { at(d, d === start ? 7 * 60 + 1 : 5 * 60 + 10); return eng.run(fiscalSteps, {}, { ...SYS, meta: { signer: demoSigner(), software: SOFTWARE } }); };
  for (let d = start; d < today; d = addDays(d, 1)) {
    await fiscalDay(d);
    if (!eng.state.settings.hours[weekday(d)]?.length) continue;
    if (!relanced && diffDays(d, today) <= 20) { relanced = true; await sendRelances(d); }
    await runDay(d, false);
  }
  await fiscalDay(today);
  if (eng.state.settings.hours[weekday(today)]?.length) await runDay(today, true);
  at(today, localParts(nowReal).min);
  clock = nowReal;
  for (let i = 1; i <= ahead; i++) {
    const d = addDays(today, i);
    if (!eng.state.settings.hours[weekday(d)]?.length) continue;
    const plans = planDay(eng.state, d, fillFor(d, today), r, pickClient(d), clock);
    for (const p of plans) { const c = byId.get(p.clientId); if (c) c.booked = d; await eng.run(createAppointment, p, base).catch(() => null); }
    seeded.push(d);
  }
  // Saturday is full: a few people wait for a cancellation
  const sat = [1, 2, 3, 4, 5, 6, 7].map((i) => addDays(today, i)).find((d) => weekday(d) === 6);
  const asSite = { actor: /** @type {const} */ ({ t: 'client', id: 'web' }), caps: new Set(), meta: base.meta };
  if (sat) {
    const waiting = [['Rayan', '0639981201', 'any', 'cl', 540, 780], ['Idriss', '0639981202', barberIds[0], 'cb', 840, 1110], ['Théo', '0639981203', 'any', 'tb', 0, 1440]];
    for (const [i, [first, phone, staffId, slug, from, to]] of waiting.entries()) {
      at(addDays(today, -1), 19 * 60 + i * 47);
      await eng.run(addWait, { day: sat, staffId, serviceId: slugId[slug], from, to, first, phone }, asSite).catch(() => null);
    }
    clock = nowReal;
  }
  await eng.run({ run(s, input, ctx) { ctx.emit('demo.seeded', { days: seeded }); return {}; } }, {}, SYS);
  return eng.journal;
}

/**
 * Keep the demo alive: finish past demo appointments, fill new days as they enter the window,
 * and now and then a client books online. One atomic append per call.
 * @param {import('../core/engine.js').Engine} engine
 */
export async function demoTick(engine, meta = {}) {
  if (engine.state.mode !== 'demo') return 0;
  return engine.batch((step) => {
    const s = engine.state;
    const now = engine.clock();
    const L = localParts(now);
    const owner = [...s.staff.values()].find((x) => x.role === 'owner' && x.active);
    const base = { ...SYS, actor: /** @type {const} */ ({ t: 'system', id: 'demo', n: 'Démo' }), staff: owner, meta };
    const r = rng(Math.floor(now / 60000));
    /** @param {any} h @param {any} input @param {any} [ctx] */
    const tryStep = (h, input, ctx = base) => { try { return step(h, input, ctx); } catch { return null; } };
    // 1. finish what is over, seat who is in the chair
    const due = [];
    for (const a of s.appts.values()) {
      if (!a.demo || !['booked', 'arrived', 'in_chair'].includes(a.status)) continue;
      if (a.day < L.day || (a.day === L.day && a.start + a.dur + 25 <= L.min)) due.push(a);
      else if (a.day === L.day && a.start <= L.min && a.status === 'booked') tryStep(setStatus, { id: a.id, status: 'in_chair' });
    }
    for (const a of due.slice(0, 60)) {
      const input = demoCheckoutInput(s, a, r, { cash: false, member: memberCut(s, a, a.day) });
      tryStep(checkout, { ...input, day: a.day, at: instantOf(a.day, a.start + a.dur + 2) });
    }
    // 2. close the books of past days nobody closed
    for (const d of [...s.salesByDay.keys()].filter((k) => k < L.day && !s.closures.has(k)).sort()) {
      tryStep(closeDay, { day: d, at: instantOf(d, 18 * 60 + 45) });
    }
    // 3. new days entering the two-week window
    for (let i = 0; i <= 14; i++) {
      const d = addDays(L.day, i);
      if (s.demoDays.has(d) || !s.settings.hours[weekday(d)]?.length) continue;
      const stats = clientStats(s, L.day, now);
      const clients = [...s.clients.values()].filter((c) => !c.erased && !c.mergedInto);
      const pick = () => { const c = clients[Math.floor(r() * clients.length)]; if (!c) return null; const st = stats.get(c.id); return { id: c.id, fav: st && st.favService }; };
      for (const p of planDay(s, d, fillFor(d, L.day), r, pick, now)) tryStep(createAppointment, p);
      tryStep({ run(st, input, ctx) { ctx.emit('demo.seeded', { days: [d] }); return {}; } }, {});
    }
    // 4. a client books online every few minutes during opening hours
    const open = (s.settings.hours[L.wd] || []).some(([a, b]) => L.min >= a && L.min < b - 60);
    const siteToday = [...s.appts.values()].filter((a) => a.demo && a.source === 'site' && a.createdAt > instantOf(L.day, 0));
    const last = siteToday.reduce((m, a) => Math.max(m, a.createdAt), 0);
    if (open && siteToday.length < 14 && now - last > 7 * 60000) {
      const sv = [...s.services.values()].filter((x) => x.active && x.online && !x.pack && x.dur === 30)[Math.floor(r() * 3)];
      const day = r() < 0.6 ? L.day : addDays(L.day, 1 + Math.floor(r() * 4));
      const slots = sv ? freeSlots(s, { day, dur: sv.dur, serviceIds: [sv.id], staffId: 'any', now, local: L, online: true }) : [];
      const pickSlot = slots[Math.floor(r() * Math.min(slots.length, 6))];
      const clients = [...s.clients.values()].filter((c) => c.phone && !c.erased && !c.mergedInto);
      const c = clients[Math.floor(r() * clients.length)];
      if (pickSlot && c) {
        // looks exactly like a real client on the site, so the Comptoir reacts the same way
        const client = { actor: /** @type {const} */ ({ t: 'client', id: 'web', n: c.first }), meta: { ...meta, demoSim: true } };
        tryStep(bookOnline, { serviceIds: [sv.id], staffId: r() < 0.5 ? 'any' : pickSlot.staffId, day, start: pickSlot.m, first: c.first, last: c.last, phone: c.phone, sms: true, demo: true }, client);
      }
    }
  });
}
