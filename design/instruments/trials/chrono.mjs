// L’épreuve du chrono: what does a booking cost, for the person it was built for?
//
// Each persona books in their own way, with their own budget (taps, characters, seconds) read from the persona itself:
//   fastest      the earliest slot with anyone, at night, on a closed day (Le Pressé)
//   first-visit  a stranger who has to be able to read the price, the barber and the privacy before he trusts it (Le Nouveau)
//   rebook       the same cut again, on the same phone, three weeks later (Le Fidèle)
//   deposit      a long, dear service whose deposit must be understood before the button (L’Occasion)
// What is counted is the work a person does: taps, characters typed, and the time he is waiting. Then what he is told.
import { SEL, EURO } from '../lib/surface.mjs';
import { Booking } from '../lib/flow.mjs';
import { personaById } from '../../personas/index.mjs';

export const meta = {
  id: 'chrono', fr: 'L’épreuve du chrono', en: 'The stopwatch', driver: 'scenes',
  summary: 'Taps, characters and seconds to a booked cut, against each persona’s own budget; then what the confirmation tells him.'
};

const within = (n, budget, slack) => (n <= budget ? 'pass' : n <= budget + slack ? 'warn' : 'fail');
const clean = (t) => String(t || '').replace(/\s+/g, ' ').trim();
const innerText = async (page, sel) => clean(await page.locator(sel).first().innerText().catch(() => ''));

/** The work done, against the persona’s own budget. */
function cost(h, scene, p, b, label, ms) {
  const who = [p.id];
  h.check({
    id: `chrono.${p.id}.taps`, axis: 'usability', weight: 4, personas: who, scene: scene.id,
    title: `${p.archetype}: ${label} takes ${p.budget.taps} taps or fewer`,
    why: p.headline,
    status: within(b.taps, p.budget.taps, 2), value: b.taps, unit: 'taps', threshold: `≤ ${p.budget.taps}`, protect: true
  });
  h.check({
    id: `chrono.${p.id}.chars`, axis: 'usability', weight: 3, personas: who, scene: scene.id,
    title: `${p.archetype}: ${label} asks for ${p.budget.chars} characters or fewer`,
    why: 'Every character is a thumb on a glass keyboard; the fewer, the fewer people leave.',
    status: within(b.chars, p.budget.chars, 10), value: b.chars, unit: 'characters', threshold: `≤ ${p.budget.chars}`, protect: true
  });
  h.check({
    id: `chrono.${p.id}.time`, axis: 'usability', weight: 1, personas: who, scene: scene.id,
    title: `${p.archetype}: ${label} is done within ${p.budget.seconds} s of active time`,
    why: 'Time from the first tap to the confirmation, on a local server: it measures what the interface makes him wait for, not the network.',
    status: within(Math.round(ms / 1000), p.budget.seconds, p.budget.seconds), value: +(ms / 1000).toFixed(1), unit: 's', threshold: `≤ ${p.budget.seconds} s`
  });
}

/** What the confirmation hands back: the nine things a person wants after “Confirmer”. */
async function confirmation(h, s, scene, p, b, evidence) {
  const body = (await b.screen()).body;
  const links = await s.page.locator('.bk a, .bk button').evaluateAll((els) => els.filter((e) => e.getBoundingClientRect().width > 0).map((e) => `${(e.textContent || '').replace(/\s+/g, ' ').trim()}|${e.getAttribute('href') || ''}`));
  const probes = {
    'the day and hour, in words': /(lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche)\s+\d+\s+\S+\s*·\s*\d+\s?h/i.test(body),
    'the barber’s name': /avec\s+\S+/i.test(body),
    'the price': EURO.test(body),
    'the address': /p[ée]labon/i.test(body),
    'the SMS he will receive, word for word': /le sms que tu re[cç]ois/i.test(body),
    'add it to his calendar': links.some((l) => /agenda/i.test(l)),
    'directions': links.some((l) => /itin[ée]raire/i.test(l)),
    'a way to move it': links.some((l) => /^d[ée]placer/i.test(l)),
    'a way to cancel it': links.some((l) => /^annuler/i.test(l))
  };
  const have = Object.values(probes).filter(Boolean).length;
  h.check({
    id: 'chrono.confirmation', axis: 'usability', weight: 3, personas: ['presse', 'fidele', 'ancien', 'parent'], scene: scene.id, protect: true,
    title: 'The confirmation hands back everything he will need: when, who, where, the SMS, a calendar, directions, move, cancel',
    why: 'After “Confirmer” a person asks only one thing: is it really done, and where do I put it?',
    status: have >= 8 ? 'pass' : have >= 6 ? 'warn' : 'fail', value: `${have} of ${Object.keys(probes).length}`, threshold: 'at least 8 of 9',
    detail: Object.entries(probes).filter(([, ok]) => !ok).map(([k]) => 'missing: ' + k).join(' · ') || undefined, data: probes, evidence
  });
}

const FLOWS = {
  async fastest(h, s, scene, p) {
    const b = new Booking(s);
    await b.open();
    await b.service(0);
    await s.page.locator(SEL.who).first().waitFor({ state: 'visible' });
    const first = clean(await s.page.locator(SEL.who).first().innerText());
    const whoShot = await h.shot(s.page, 'Who: “Sans préférence” first', { scene: scene.id });
    await b.who(0);
    await s.page.locator(`${SEL.fast},${SEL.slot}`).first().waitFor({ state: 'visible', timeout: 12000 });
    const hasFast = await b.visible(SEL.fast);
    const whenShot = await h.shot(s.page, 'When: the earliest slot, one tap', { scene: scene.id });
    await b.earliest();
    await s.page.locator(SEL.first).waitFor({ state: 'visible' });
    const labels = await s.page.locator('.bk label').allInnerTexts();
    const required = labels.filter((l) => !/facultatif/i.test(l)).length;
    await b.details({ first: 'Julien', phone: '0612345678' });
    const infoShot = await h.shot(s.page, 'Details: two required fields', { scene: scene.id });
    await b.confirm();
    await b.done();
    const ms = b.elapsed();
    const doneShot = await h.shot(s.page, 'Confirmation', { scene: scene.id });
    cost(h, scene, p, b, 'the earliest cut with anyone', ms);
    h.check({ id: 'chrono.presse.default', axis: 'usability', weight: 3, personas: ['presse', 'nouveau'], scene: scene.id, protect: true,
      title: '“Sans préférence” is the first choice of the barber step, with the earliest time beside it',
      why: 'Anyone is a respectable answer; asking a person who has no opinion to choose is how a booking is lost.',
      status: /sans pr[ée]f[ée]rence/i.test(first) ? 'pass' : 'fail', value: first.slice(0, 60), evidence: [whoShot] });
    h.check({ id: 'chrono.presse.quick-pick', axis: 'usability', weight: 3, personas: ['presse'], scene: scene.id, protect: true,
      title: 'The calendar offers “Le plus tôt · Choisir” so the earliest slot is one tap',
      why: 'The hurried never scroll a calendar; they take the first thing that works.',
      status: hasFast ? 'pass' : 'fail', value: hasFast ? 'yes' : 'no', evidence: [whenShot] });
    h.check({ id: 'chrono.presse.required-fields', axis: 'usability', weight: 3, personas: ['presse', 'nouveau'], scene: scene.id, protect: true,
      title: 'Only two fields are required (first name, phone); the rest says “facultatif”',
      why: 'Every field that is not needed is a reason to close the tab.',
      status: required <= 2 ? 'pass' : required <= 3 ? 'warn' : 'fail', value: required, unit: 'required fields', threshold: '≤ 2', evidence: [infoShot],
      detail: `labels: ${labels.map(clean).join(' · ')}` });
    await confirmation(h, s, scene, p, b, [doneShot]);
  },

  async 'first-visit'(h, s, scene, p) {
    const b = new Booking(s);
    const feet = [];
    await b.open();
    const services = (await s.page.locator(SEL.service).allInnerTexts()).map(clean);
    const priced = services.filter((t) => EURO.test(t) && /\d+\s?(min|h)\b/i.test(t)).length;
    const svcShot = await h.shot(s.page, 'Services: price and duration on every line', { scene: scene.id });
    feet.push((await b.screen()).foot);
    await b.service('Coupe classique');
    await s.page.locator(SEL.who).first().waitFor({ state: 'visible' });
    const barbers = (await s.page.locator(SEL.who).allInnerTexts()).map(clean).slice(1);
    const withNext = barbers.filter((t) => /libre|prochain|aujourd|demain|\d\s?h|lun|mar|mer|jeu|ven|sam/i.test(t)).length;
    feet.push((await b.screen()).foot);
    await b.who(1);
    await s.page.locator(`${SEL.fast},${SEL.slot}`).first().waitFor({ state: 'visible', timeout: 12000 });
    feet.push((await b.screen()).foot);
    await b.earliest();
    await s.page.locator(SEL.first).waitFor({ state: 'visible' });
    const info = (await b.screen());
    feet.push(info.foot);
    const hasNote = /un mot pour ton barbier/i.test(info.body), hasPrivacy = /coordonn[ée]es servent|trait[ée]es/i.test(info.body);
    await b.details({ first: 'Yanis', phone: '0634567890' });
    await b.confirm();
    await b.done();
    cost(h, scene, p, b, 'a first booking as a stranger', b.elapsed());
    h.check({ id: 'chrono.nouveau.prices', axis: 'usability', weight: 4, personas: ['nouveau', 'occasion', 'ancien'], scene: scene.id, protect: true,
      title: 'Every service shows its price and its duration on the same line, before anything is chosen',
      why: p.headline, status: priced === services.length ? 'pass' : priced >= services.length * 0.8 ? 'warn' : 'fail',
      value: `${priced} of ${services.length}`, threshold: 'all', evidence: [svcShot], detail: priced < services.length ? services.filter((t) => !(EURO.test(t) && /\d+\s?(min|h)\b/i.test(t))).join(' | ') : undefined });
    h.check({ id: 'chrono.nouveau.barbers-next', axis: 'usability', weight: 2, personas: ['nouveau', 'fidele', 'passionne'], scene: scene.id, protect: true,
      title: 'Each barber is shown with their next free time beside the name',
      why: 'He chooses a person, and the first thing he asks of a person is when they are free.',
      status: withNext === barbers.length && barbers.length ? 'pass' : withNext ? 'warn' : 'fail', value: `${withNext} of ${barbers.length}` });
    h.check({ id: 'chrono.nouveau.price-always', axis: 'usability', weight: 3, personas: ['nouveau', 'occasion'], scene: scene.id, protect: true,
      title: 'The price is in the sheet’s footer at every step, so it is never a surprise',
      why: 'A price seen once and then hidden is a price he starts to doubt.',
      status: feet.every((f) => EURO.test(f)) ? 'pass' : 'fail', value: `${feet.filter((f) => EURO.test(f)).length} of ${feet.length} steps`, detail: feet.join(' | ') });
    h.check({ id: 'chrono.nouveau.words', axis: 'content', weight: 2, personas: ['nouveau', 'presse'], scene: scene.id, protect: true,
      title: 'He can say what he wants in his own words (“Un mot pour ton barbier”) and is told why his number is asked',
      why: 'He has a photo and no vocabulary; a free-text line is the cheapest way to not need any.',
      status: hasNote && hasPrivacy ? 'pass' : hasNote || hasPrivacy ? 'warn' : 'fail', value: `note ${hasNote ? 'yes' : 'no'} · privacy sentence ${hasPrivacy ? 'yes' : 'no'}` });
  },

  async rebook(h, s, scene, p) {
    const first = new Booking(s);
    await first.open();
    await first.service(0);
    await first.who(1);
    await first.earliest();
    await first.details({ first: 'Sofiane', phone: '0611223344' });
    await first.confirm();
    await first.done();
    await s.page.reload();
    await s.page.waitForTimeout(1500);
    const b = new Booking(s);
    await b.open();
    const card = await b.visible(SEL.rebook);
    const cardText = card ? await innerText(s.page, SEL.rebook) : '';
    const shot = await h.shot(s.page, 'The sheet greets a returning client', { scene: scene.id });
    h.check({ id: 'chrono.fidele.rebook-card', axis: 'usability', weight: 4, personas: ['fidele', 'presse'], scene: scene.id, protect: true,
      title: 'A returning client is greeted by name and offered “Comme la dernière fois ?” as the first thing he sees',
      why: p.headline, status: card ? 'pass' : 'fail', value: card ? cardText.slice(0, 70) : 'no card', evidence: [shot] });
    if (card) {
      await b.tap(s.page.locator(SEL.rebook).first());
      await b.finish({ first: 'Sofiane', phone: '0611223344' }); // remembered: nothing is typed
      cost(h, scene, p, b, 'repeating the last visit', b.elapsed());
    }
  },

  async deposit(h, s, scene, p) {
    const b = new Booking(s);
    await b.open();
    const services = (await s.page.locator(SEL.service).allInnerTexts()).map(clean);
    const t = services.find((x) => /Transformation/i.test(x)) || '';
    h.check({ id: 'chrono.occasion.service-clear', axis: 'content', weight: 3, personas: ['occasion', 'nouveau'], scene: scene.id, protect: true,
      title: 'The dear service says what it includes, its price and how long it takes, on one line',
      why: 'He is spending 50 € on something he cannot undo; “Diagnostic · Étude de faisabilité · Coupe” is a promise he can read.',
      status: EURO.test(t) && /\d+\s?(min|h)\b/i.test(t) && /·/.test(t) ? 'pass' : t ? 'warn' : 'fail', value: t.slice(0, 90) });
    await b.service('Transformation');
    await b.who(0);
    await b.earliest();
    await s.page.locator(SEL.first).waitFor({ state: 'visible' });
    const dep = await innerText(s.page, SEL.deposit);
    const info = await b.screen();
    const depShot = await h.shot(s.page, 'The deposit, explained before the button', { scene: scene.id });
    const terms = /annulation/i.test(info.foot) && /cgv/i.test(info.foot);
    h.check({ id: 'chrono.occasion.deposit', axis: 'content', weight: 4, personas: ['occasion', 'nouveau', 'presse'], scene: scene.id, protect: true,
      title: 'The deposit is said once, in words, before the button: how much, and what happens if he cancels',
      why: p.headline, status: EURO.test(dep) && /rembours|annul/i.test(dep) ? 'pass' : dep ? 'warn' : 'fail', value: dep.slice(0, 120) || 'no deposit line', evidence: [depShot] });
    const label = await innerText(s.page, SEL.confirm);
    h.check({ id: 'chrono.occasion.honest-button', axis: 'content', weight: 3, personas: ['occasion', 'nouveau'], scene: scene.id, protect: true,
      title: 'The button says what it will do (“Réserver et régler l’acompte”) and the cancellation terms sit under it',
      why: 'A button that says “Confirmer” and then asks for money is the one thing that makes people feel trapped.',
      status: /acompte|r[ée]gl/i.test(label) && terms ? 'pass' : /acompte|r[ée]gl/i.test(label) || terms ? 'warn' : 'fail', value: label, detail: info.foot.slice(0, 160) });
    await b.details({ first: 'Théo', phone: '0698765432' });
    await b.confirm();
    await b.done();
    const pay = (await b.screen()).body;
    const payShot = await h.shot(s.page, 'The payment step', { scene: scene.id });
    h.check({ id: 'chrono.occasion.pay-step', axis: 'content', weight: 3, personas: ['occasion', 'ancien'], scene: scene.id, protect: true,
      title: 'The payment step restates the amount, the time he has, and what happens if he lets it lapse',
      why: 'The last step before paying is where doubt peaks; it should say everything again, plainly.',
      status: EURO.test(pay) && /\d+\s?minutes?/i.test(pay) && /lib[ée]r|perd|annul/i.test(pay) ? 'pass' : 'warn', value: (pay.match(/Il reste[^.]*\./i) || [''])[0], evidence: [payShot] });
    cost(h, scene, p, b, 'a booking with a deposit', b.elapsed());
  }
};

export async function run(h) {
  const scenes = h.scenes('chrono');
  for (const scene of scenes) {
    const s = await h.open(scene);
    await s.goto('/');
    await s.page.waitForTimeout(1500);
    await FLOWS[scene.flow](h, s, scene, personaById(scene.persona));
    await s.close();
  }
  return { scenesRun: scenes.length, personas: ['presse', 'nouveau', 'fidele', 'occasion'] };
}
