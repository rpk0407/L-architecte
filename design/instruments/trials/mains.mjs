// L’épreuve des mains mouillées: the Comptoir, used by the people who run the shop with their hands full.
//
// The same personas the shop is built for, on the screens they actually use, with the thresholds their hands set:
//   barber   a shared phone at the station: a PIN keypad, the next client, two big status buttons, no money in sight
//   desk     a tablet in landscape at the till, a client waiting: every control on the agenda and the checkout, sized for a hurried thumb
//   owner    a laptop at 23:00 in the dark theme: the month’s verdict in one screen, privacy one tap away
// Demo chrome (the banner that says it is a demo) is never judged.
import { helpers } from '../../../tests/e2e/harness.mjs';
import { STAFF, DEMO_CHROME, EURO } from '../lib/surface.mjs';
import { sizeStatus, listTargets } from '../lib/targets.mjs';
import { viewportContrast } from '../lib/contrast.mjs';
import { personaById } from '../../personas/index.mjs';

export const meta = {
  id: 'mains', fr: 'L’épreuve des mains mouillées', en: 'The wet-hands test', driver: 'scenes',
  summary: 'The Comptoir for the barber, the desk and the owner: PIN, next client, till and agenda targets, privacy, the month’s verdict.'
};

const byName = (page, re) => page.getByRole('button', { name: re }).first();
async function box(page, re) { const b = await byName(page, re).boundingBox().catch(() => null); return b ? { w: Math.round(b.width), h: Math.round(b.height) } : null; }

async function barber(h, s, scene, p) {
  await s.goto('/comptoir');
  await s.page.waitForTimeout(1200);
  await s.page.getByRole('button', { name: /poste du salon/ }).click();
  await s.page.locator('.team button', { hasText: STAFF.barber.team }).click();
  await s.page.locator('.keypad').waitFor();
  const keys = await s.ux('targets', { within: '.keypad', min: 56, floor: 24 });
  const pad = await h.shot(s.page, 'The PIN keypad', { scene: scene.id });
  const t0 = Date.now();
  await s.page.keyboard.type(STAFF.barber.pin);
  await s.page.keyboard.press('Enter');
  await s.page.locator('#page-title h1').waitFor({ timeout: 10000 });
  const ms = Date.now() - t0;
  await s.page.waitForTimeout(1800);
  const home = await h.shot(s.page, 'The barber’s first screen', { scene: scene.id });
  const minKey = Math.min(...keys.under.map((k) => Math.min(k.w, k.h)).concat(56));
  h.check({ id: 'mains.pin.keys', axis: 'usability', weight: 4, personas: ['barbier'], scene: scene.id, protect: keys.under.length === 0,
    title: 'Every key of the PIN keypad is 56 px or more',
    why: 'A wet thumb on a shared phone: the keypad is the first thing he touches every morning, and it is the one place the product has already been sized for him.',
    status: keys.counted === 0 ? 'fail' : sizeStatus(keys.under, keys.small, keys.below), value: keys.counted ? `${keys.counted} keys, smallest ${keys.under.length ? minKey : '≥ 56'} px` : 'no keypad found', threshold: '≥ 56 px', detail: keys.under.length ? listTargets(keys.under) : undefined, evidence: [pad] });
  h.check({ id: 'mains.pin.login', axis: 'usability', weight: 1, personas: ['barbier'], scene: scene.id,
    title: 'Signing in on a shared phone takes a name, four digits and one more tap',
    why: 'He signs in several times a day; every second here is a second not spent on the client.',
    status: ms <= p.budget.seconds * 1000 ? 'pass' : 'warn', value: +(ms / 1000).toFixed(1), unit: 's from the first digit to the first screen', threshold: `≤ ${p.budget.seconds} s` });

  const names = [/Il est là/i, /Au fauteuil/i];
  const status = await Promise.all(names.map((re) => box(s.page, re)));
  const smallest = Math.min(...status.filter(Boolean).flatMap((b) => [b.w, b.h]));
  h.check({ id: 'mains.barber.status-buttons', axis: 'usability', weight: 3, personas: ['barbier'], scene: scene.id, protect: status.every((b) => b && Math.min(b.w, b.h) >= 48),
    title: '“Il est là” and “Au fauteuil” are 48 px or more, the biggest things on his first screen',
    why: p.headline, status: status.some((b) => !b) ? 'fail' : smallest >= 48 ? 'pass' : smallest >= 40 ? 'warn' : 'fail',
    value: status.every(Boolean) ? status.map((b) => `${b.w}×${b.h}`).join(' · ') : 'not found', threshold: '≥ 48 px', evidence: [home] });
  const t = await s.ux('targets', { min: 44, floor: 24, ignore: DEMO_CHROME });
  h.check({ id: 'mains.barber.targets', axis: 'usability', weight: 3, personas: ['barbier'], scene: scene.id,
    title: 'Everything else on the barber’s first screen is 44 px or more as well (the header’s round buttons included)',
    why: 'The help, the amounts, the feed and the tour are all tapped with the same wet thumb as the status buttons.',
    status: sizeStatus(t.under, t.small, t.below), value: t.under.length, unit: `of ${t.counted} under 44 px`, detail: listTargets(t.under) || undefined, data: t.under.slice(0, 8), evidence: [home],
    fix: 'The round header buttons are 40 px: 44 is a one-line change in the shared button style.' });
  const seen = await s.ux('seen', 'viewport');
  h.check({ id: 'mains.barber.privacy', axis: 'usability', weight: 3, personas: ['barbier', 'gerant'], scene: scene.id, protect: !EURO.test(seen.text),
    title: 'On a shared device the first screen shows no money, whoever is looking over his shoulder',
    why: 'A client in the chair can read the screen; the day’s takings and the commission are nobody’s business but the owner’s.',
    status: EURO.test(seen.text) ? 'fail' : 'pass', value: EURO.test(seen.text) ? (seen.text.match(EURO) || [''])[0] : 'no amount shown', evidence: [home] });
  h.check({ id: 'mains.barber.next-client', axis: 'usability', weight: 4, personas: ['barbier'], scene: scene.id, protect: /prochain client/i.test(seen.text) && /derni[èe]re fois/i.test(seen.text),
    title: 'The first screen is the next client, with what he had last time',
    why: 'Sixty seconds between two clients: who is next, and what to remember about him.',
    status: /prochain client/i.test(seen.text) && /derni[èe]re fois/i.test(seen.text) ? 'pass' : /prochain client/i.test(seen.text) ? 'warn' : 'fail', value: (seen.text.match(/Prochain client[^·]*/i) || ['not found'])[0].slice(0, 50), evidence: [home] });
  const c = await viewportContrast(h, s);
  h.check({ id: 'mains.barber.contrast', axis: 'usability', weight: 3, personas: ['barbier'], scene: scene.id,
    title: 'The barber’s first screen is readable at a glance (WCAG AA contrast, dark theme)',
    why: 'He reads it at arm’s length, in the salon’s light, in a second.',
    status: c.status, value: `${c.judged.length - c.below.length} of ${c.judged.length} lines pass`, detail: c.detail || undefined, evidence: [home] });
}

async function desk(h, s, scene, p) {
  const login = helpers({ base: s.base, mode: 'demo', owner: { name: 'Gérant', ...STAFF.owner } });
  await login.loginOwner(s.page);
  const out = [];
  for (const [path, label, open] of [['/comptoir/agenda', 'agenda', null], ['/comptoir/caisse', 'till', async () => { await s.page.locator('.cs-list .li').first().click(); await s.page.waitForTimeout(900); }]]) {
    await s.page.goto(s.base + path);
    await s.page.waitForTimeout(1800);
    if (open) await open();
    const shot = await h.shot(s.page, `The ${label} on a tablet`, { scene: scene.id });
    const t = await s.ux('targets', { min: 44, floor: 24, ignore: DEMO_CHROME });
    out.push({ label, t, shot });
    h.check({ id: `mains.${label}.targets`, axis: 'usability', weight: label === 'till' ? 4 : 3, personas: ['accueil', 'barbier'], scene: scene.id,
      title: `The ${label}: every control is 44 px or more on a tablet`,
      why: label === 'till' ? 'A mis-tap on the till is a mis-tap on money; every control here is hit in a hurry with a client waiting.' : p.headline,
      status: sizeStatus(t.under, t.small, t.below), value: t.under.length, unit: `of ${t.counted} under 44 px`, threshold: '0 under 44 px', detail: listTargets(t.under) || undefined, data: t.under.slice(0, 10), evidence: [shot] });
  }
  const till = out.find((o) => o.label === 'till');
  const secondary = await Promise.all([/Ajouter/i, /Remise/i, /Pourboire/i].map((re) => box(s.page, re)));
  const heights = secondary.filter(Boolean).map((b) => b.h);
  h.check({ id: 'mains.till.secondary', axis: 'usability', weight: 4, personas: ['accueil'], scene: scene.id,
    title: 'The till’s secondary actions (Ajouter, Remise, Pourboire) are 44 px tall or more',
    why: 'They sit beside the amount and are tapped last, fastest, with the client watching: the place a mis-tap costs real money.',
    status: !heights.length ? 'fail' : Math.min(...heights) >= 44 ? 'pass' : Math.min(...heights) >= 32 ? 'warn' : 'fail', value: heights.length ? `${Math.min(...heights)} px tall` : 'not found', threshold: '≥ 44 px',
    detail: secondary.map((b, i) => `${['Ajouter', 'Remise', 'Pourboire'][i]} ${b ? b.w + '×' + b.h : 'n/a'}`).join(' · '), evidence: till ? [till.shot] : [],
    fix: 'Raise the checkout’s chip buttons from 34 px to 44 px; they already have the room.' });
  const c = await viewportContrast(h, s);
  h.check({ id: 'mains.till.contrast', axis: 'usability', weight: 3, personas: ['accueil'], scene: scene.id,
    title: 'The till is readable at a glance (WCAG AA contrast, dark theme)',
    why: 'Glanced at, never read: the amounts and the method must hold up in the salon’s light.',
    status: c.status, value: `${c.judged.length - c.below.length} of ${c.judged.length} lines pass`, detail: c.detail || undefined, evidence: till ? [till.shot] : [] });
}

async function owner(h, s, scene, p) {
  const login = helpers({ base: s.base, mode: 'demo', owner: { name: 'Gérant', ...STAFF.owner } });
  await login.loginOwner(s.page);
  await s.page.waitForTimeout(2200);
  const shot = await h.shot(s.page, 'Pilotage, the first screen', { scene: scene.id });
  const seen = await s.ux('seen', 'viewport');
  const verdict = /objectif/i.test(seen.text) && /\d\s?%/.test(seen.text) && EURO.test(seen.text);
  h.check({ id: 'mains.owner.verdict', axis: 'usability', weight: 4, personas: ['gerant'], scene: scene.id, protect: verdict,
    title: 'The first screen answers “is the month on track?”: a goal, a percentage and an amount',
    why: p.headline, status: verdict ? 'pass' : 'fail', value: (seen.text.match(/Objectif[^·]*/i) || ['no goal on the first screen'])[0].slice(0, 70), evidence: [shot] });
  const hasToggle = await byName(s.page, /montants/i).isVisible().catch(() => false);
  h.check({ id: 'mains.owner.privacy-toggle', axis: 'usability', weight: 2, personas: ['gerant', 'barbier'], scene: scene.id, protect: hasToggle,
    title: 'Hiding the amounts is one visible tap away, on every screen',
    why: 'He sometimes opens the numbers with someone beside him; one tap should make them disappear.',
    status: hasToggle ? 'pass' : 'fail', value: hasToggle ? '“Masquer les montants” in the header' : 'no such control' });
  const c = await viewportContrast(h, s);
  h.check({ id: 'mains.owner.contrast', axis: 'usability', weight: 3, personas: ['gerant'], scene: scene.id,
    title: 'Pilotage is readable in the dark theme (WCAG AA contrast), including the grey secondary lines',
    why: 'The secondary lines (“Encore 8 088 € · 1 618 € par jour ouvré”) are exactly the ones he needs and exactly the ones set in dim grey.',
    status: c.status, value: `${c.judged.length - c.below.length} of ${c.judged.length} lines pass`, detail: c.detail || undefined, data: c.below.slice(0, 6).map((i) => ({ text: i.text, ratio: i.ratio, required: i.required })), evidence: [shot] });
}

export async function run(h) {
  const scenes = h.scenes('mains');
  for (const scene of scenes) {
    const s = await h.open(scene);
    const p = personaById(scene.persona);
    await ({ barber, desk, owner }[scene.flow])(h, s, scene, p);
    await s.close();
  }
  return { scenesRun: scenes.length, personas: ['barbier', 'accueil', 'gerant'] };
}
