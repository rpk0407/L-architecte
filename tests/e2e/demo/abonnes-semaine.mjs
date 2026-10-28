// PAY-07 · The salon's real membership on the demo (a Tuesday afternoon): Clients › Abonnés shows « Pas venu cette semaine
// (3) » first, its filter keeps those three, « Écrire » opens the SMS composer with « On te garde ta place cette
// semaine ? »; the site's card says « 1 coupe par semaine »; the till refuses a second covered cut in the week of a
// member who came, in French; Réglages › Abonnements switches the rule to « Il la rattrape dans le mois », the preview
// line follows and it saves, while the members keep theirs; a member's page and /moi say his week. Desktop and phone:
// no sideways scroll, roles found by name.
export const name = 'membership weeks: board, « Pas venu cette semaine », Écrire, till refusal, the missed-week rule, site, /moi';

const PHONE = { width: 390, height: 844 };

export default async ({ h, page }) => {
  await h.setup();
  const fail = (m) => { throw new Error(m); };
  const narrow = async (p, where) => { if (await p.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)) fail(where + ': the page scrolls sideways'); };
  const rows = (await h.api('/api/v1/memberships')).json.members.filter((m) => ['active', 'grace', 'ending'].includes(m.status));
  const skipped = rows.filter((m) => m.week && !m.week.used);
  if (skipped.length !== 3) fail('the demo should have 3 members not come this week, not ' + skipped.length);
  const came = rows.find((m) => m.status === 'active' && m.week && m.week.used === 1) || fail('no member who came this week');

  /* ---------- 1 · the site's card: the offer in the salon's words ---------- */
  await page.goto(h.base + '/');
  const block = page.locator('#abonnement');
  await block.waitFor({ timeout: 15000 });
  await block.getByText(/1 coupe par semaine/).first().waitFor({ timeout: 8000 });
  await block.getByText(/semaine manquée : perdue/).first().waitFor();
  await block.getByText(/1 coupe par semaine/).first().scrollIntoViewIfNeeded();
  // the site reveals its sections as they come into view
  await page.waitForTimeout(1500);
  await h.shot(page, 'pay07-site-card');

  /* ---------- 2 · Clients › Abonnés: the chip first, its filter, « Écrire » ---------- */
  await h.loginOwner(page);
  await page.goto(h.base + '/comptoir/clients?segment=abonnes');
  await page.getByRole('group', { name: 'Les abonnés en chiffres' }).waitFor({ timeout: 10000 });
  for (const t of ['Présence', 'Semaines manquées']) await page.getByText(t, { exact: true }).first().waitFor({ timeout: 5000 });
  const chips = page.getByRole('group', { name: 'Filtrer les abonnés' }).getByRole('button');
  const firstChip = (await chips.first().textContent()).trim();
  if (firstChip !== 'Pas venu cette semaine (3)') fail('the first chip reads « ' + firstChip + ' »');
  await page.getByRole('img', { name: /^Semaines du mois : / }).first().waitFor();
  await h.shot(page, 'pay07-board-desktop');
  await chips.first().click();
  const list = page.locator('[data-guide="members-list"] .mbs-item');
  await page.waitForFunction(() => document.querySelectorAll('[data-guide="members-list"] .mbs-item').length === 3, null, { timeout: 5000 }).catch(() => fail('the filter does not keep the three'));
  if (await list.locator('.mbs-now.ok').count()) fail('a member who came is in « Pas venu cette semaine »');
  // the longest since his last visit first
  await page.getByRole('button', { name: /^Écrire à / }).first().click();
  const sheet = page.getByRole('dialog', { name: /^Écrire à / });
  await sheet.waitFor({ timeout: 5000 });
  const text = await sheet.getByLabel('Le message').inputValue();
  if (!text.includes('on te garde ta place cette semaine ?')) fail('the composer is not prefilled: ' + text);
  await sheet.getByText(/STOP/).first().waitFor();
  await h.shot(page, 'pay07-write');
  await sheet.getByRole('button', { name: 'Envoyer' }).click();
  await page.getByText(/^(Message envoyé à |Message non envoyé)/).first().waitFor({ timeout: 8000 });
  await page.keyboard.press('Escape');

  /* ---------- 3 · the till: a second covered cut in the week is refused, in French ---------- */
  const file = (await h.api('/api/v1/clients/' + came.clientId)).json.client;
  const cut = (await h.api('/api/public/memberships', { session: false })).json.plans[0].services[0];
  await page.goto(h.base + '/comptoir/caisse');
  await page.getByRole('button', { name: 'Vente libre' }).click();
  await page.getByRole('button', { name: 'Associer un client' }).click();
  await page.getByPlaceholder('Prénom, nom ou numéro').fill(file.first + ' ' + file.last);
  await page.getByRole('dialog').getByRole('button', { name: new RegExp(file.first) }).first().click();
  await page.getByRole('button', { name: 'Ajouter', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: new RegExp(cut.name) }).first().click();
  await page.getByText(/Coupe de la semaine déjà prise \(1\/1\) · prochaine lundi 02\/11 — encaissée au prix normal/).waitFor({ timeout: 8000 });
  await h.shot(page, 'pay07-till-refusal');

  /* ---------- 4 · his page: this week taken (the member page /moi opens too) ---------- */
  const sent = await h.api('/api/v1/memberships/' + came.id + '/card-link', { body: {}, headers: { 'x-request-id': 'e2e-pay07-card' } });
  if (!sent.ok) fail('card link: ' + sent.text);
  const msg = (await h.api('/api/v1/messages?limit=300')).json.items.find((m) => m.template === 'memberCard' && /\/abo\//.test(m.body || ''));
  const abo = /(\/abo\/[^\s"]+)/.exec(msg.body)[1];
  const pm = await h.newPage({ viewport: PHONE });
  await pm.goto(h.base + abo);
  await pm.getByText('1/1').first().waitFor({ timeout: 10000 });
  await pm.getByText('coupe cette semaine').waitFor();
  await pm.getByText(/Ta coupe de la semaine est prise : la prochaine est incluse dès le lundi 02\/11\./).waitFor();
  await pm.getByText('1 coupe par semaine · Semaine manquée : perdue').waitFor();
  await narrow(pm, 'member page');
  await h.shot(pm, 'pay07-member-page');

  /* ---------- 5 · /moi: the demo's client becomes a member, his row says his week ---------- */
  const me = await h.newPage({ viewport: PHONE });
  await me.goto(h.base + '/moi');
  await me.getByRole('button', { name: 'Essayer avec un client de démo' }).click();
  await me.getByRole('heading', { name: /^Salut / }).waitFor({ timeout: 10000 });
  const who = await me.evaluate(async () => (await (await fetch('/api/me')).json()));
  const found = (await h.api('/api/v1/clients?limit=20&q=' + encodeURIComponent(who.first + ' ' + who.last))).json.items[0] || fail('the demo client is not found');
  const full = (await h.api('/api/v1/clients/' + found.id)).json.client;
  // the demo's client may be one of the members already (the most regular file with a booking to come)
  if (!full.memberships.length) {
    const sub = await h.api('/api/public/memberships', { session: false, body: { planId: 'hebdo', first: full.first, phone: full.phone, email: 'e2e-pay07@exemple.fr', startNow: true, cgv: (await h.api('/api/public/memberships', { session: false })).json.cgv } });
    if (sub.status !== 201) fail('subscribe: ' + sub.text);
    const pid = sub.json.url.split('/paiement/')[1];
    if ((await h.api('/api/public/payments/' + pid + '/simulate', { session: false, body: { outcome: 'ok' } })).json.status !== 'paid') fail('the first month is not paid');
  }
  await me.goto(h.base + '/moi');
  await me.getByRole('button', { name: /^Abonnement Hebdo · Cette semaine : (prise|à prendre)/ }).waitFor({ timeout: 10000 });
  await narrow(me, '/moi');
  await me.getByRole('button', { name: /^Abonnement Hebdo/ }).scrollIntoViewIfNeeded();
  await h.shot(me, 'pay07-moi-row');

  /* ---------- 6 · Réglages › Abonnements: the rule, its preview, saved for the new members only ---------- */
  await page.goto(h.base + '/comptoir/reglages/abonnements');
  const card = page.getByRole('region', { name: 'Formule Hebdo' });
  await card.waitFor({ timeout: 10000 });
  const line = card.locator('[data-guide="abo-offer-line"]');
  if (!/80\s€\/mois · 1 coupe par semaine · semaine manquée perdue/.test(await line.textContent())) fail('preview: ' + (await line.textContent()));
  await h.shot(page, 'pay07-settings-desktop');
  await card.getByRole('radio', { name: /Il la rattrape dans le mois/ }).check();
  await line.scrollIntoViewIfNeeded();
  await page.waitForFunction(() => /4 coupes par mois · semaine manquée rattrapable dans le mois/.test(document.querySelector('[data-guide="abo-offer-line"]')?.textContent || ''), null, { timeout: 3000 }).catch(() => fail('the preview line did not follow the rule'));
  await card.getByText(/abonnés gardent l’ancienne règle/).waitFor();
  await h.shot(page, 'pay07-settings-rule');
  await page.getByRole('button', { name: 'Enregistrer' }).click();
  await page.getByText('Abonnements enregistrés').waitFor({ timeout: 8000 });
  const plan = (await h.api('/api/v1/settings')).json;
  const hebdo = ((plan.settings || plan).membership.plans || []).find((p) => p.id === 'hebdo');
  if (!hebdo || hebdo.missed !== 'month' || hebdo.cuts !== 4) fail('the rule is not saved: ' + JSON.stringify(hebdo));
  const after = (await h.api('/api/v1/memberships')).json.members.filter((m) => m.status === 'active');
  if (!after.every((m) => m.missed === 'lost')) fail('a member lost the rule he signed for');

  /* ---------- 7 · a phone: the board and the settings ---------- */
  const ph = await h.newPage({ viewport: PHONE });
  await h.loginOwner(ph);
  await ph.goto(h.base + '/comptoir/clients?segment=abonnes');
  await ph.getByRole('group', { name: 'Les abonnés en chiffres' }).waitFor({ timeout: 10000 });
  await ph.getByRole('img', { name: /^Semaines du mois : / }).first().waitFor();
  await narrow(ph, 'Abonnés');
  // the strip wraps: no tile sticks out of the screen
  const out = await ph.evaluate(() => [...document.querySelectorAll('.mbs-kpis .kpi')].filter((k) => k.getBoundingClientRect().right > window.innerWidth + 1).length);
  if (out) fail(out + ' tile(s) of the strip stick out on a phone');
  await h.shot(ph, 'pay07-board-phone');
  await ph.goto(h.base + '/comptoir/reglages/abonnements');
  await ph.getByRole('region', { name: 'Formule Hebdo' }).waitFor({ timeout: 10000 });
  await narrow(ph, 'Réglages › Abonnements');
  await ph.getByRole('group', { name: 'Rythme' }).scrollIntoViewIfNeeded();
  await h.shot(ph, 'pay07-settings-phone');
};
