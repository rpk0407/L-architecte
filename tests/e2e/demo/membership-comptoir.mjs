// The membership in the Comptoir (PAY-05) on the demo salon: a member's cut at 0 € in one tap, the next one past the plan
// priced with its note (PAY-07: the demo's formule is one cut a week, so the second of the week), the Abonnés board, cancelling at the end of the paid month and now, a formule added in Réglages and
// on sale on the site, and nothing wider than a phone.
export const name = 'membership in the Comptoir: till, board, file, cancel, plans';

export default async ({ h, page }) => {
  await h.loginOwner(page);
  const call = (path, body, method) => page.evaluate(async ([p, b, m]) => {
    const r = await fetch(p, b ? { method: m || 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) } : {});
    return { status: r.status, json: await r.json().catch(() => null) };
  }, [path, body, method]);
  const fail = (m) => { throw new Error(m); };

  const pulse = (await call('/api/v1/pulse')).json;
  const members = (await call('/api/v1/memberships')).json.members;
  const m = members.find((x) => x.plan === 'Hebdo' && x.status === 'active' && x.week && x.week.used === 0) || fail('no Hebdo member who has not come this week in the demo');
  const file = (await call('/api/v1/clients/' + m.clientId)).json.client;
  const plan = (await call('/api/public/memberships')).json.plans.find((p) => p.name === 'Hebdo');
  const cut = plan.services[0];
  const lane = (await call('/api/v1/agenda?day=' + pulse.today)).json.lanes[0];

  // 1. his appointment at the till: the cut is covered, 0 €, one tap
  const booked = await call('/api/v1/appointments', { clientId: m.clientId, serviceIds: [cut.id], staffId: lane.id, day: pulse.today, start: 1020, force: true, sms: false });
  if (booked.status !== 200) fail('booking refused: ' + JSON.stringify(booked.json));
  await page.goto(h.base + '/comptoir/caisse?rdv=' + booked.json.id);
  await page.locator('.ticket').waitFor({ timeout: 8000 });
  await page.getByText(/Abonnement · semaine du \d\d\/\d\d \(1\/1\)/).waitFor({ timeout: 8000 });
  await page.getByText(/Abonné · Hebdo/).waitFor({ timeout: 3000 });
  await page.getByRole('button', { name: /Valider l’encaissement · 0 €/ }).waitFor({ timeout: 3000 });
  await h.shot(page, 'membership-till-line');
  await page.getByRole('button', { name: /Valider l’encaissement/ }).click();
  await page.getByRole('button', { name: 'Ticket suivant' }).waitFor({ timeout: 8000 });
  const sale = (await call('/api/v1/sales?day=' + pulse.today)).json.items.find((x) => x.apptId === booked.json.id);
  if (!sale || sale.totals.due !== 0) fail('the member ticket is not at 0 €: ' + JSON.stringify(sale && sale.totals));
  if (!sale.lines[0].memberId) fail('the line does not say which membership paid it');

  // 2. a free sale for him: the week's cut is taken, the next one stays priced and says why
  await page.goto(h.base + '/comptoir/caisse');
  await page.getByRole('button', { name: 'Vente libre' }).click();
  await page.getByRole('button', { name: 'Associer un client' }).click();
  await page.getByPlaceholder('Prénom, nom ou numéro').fill(file.first + ' ' + file.last);
  await page.getByRole('dialog').getByRole('button', { name: new RegExp(file.first) }).first().click();
  await page.getByRole('button', { name: 'Ajouter', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: new RegExp(cut.name) }).first().click();
  await page.getByText(/Coupe de la semaine déjà prise \(1\/1\) · prochaine lundi \d\d\/\d\d — encaissée au prix normal/).waitFor({ timeout: 8000 });
  await page.getByRole('button', { name: 'L’offrir quand même' }).waitFor({ timeout: 3000 });
  await h.shot(page, 'membership-till-quota');
  await page.getByRole('button', { name: 'Carte Terminal de paiement' }).click();
  await page.getByRole('button', { name: /Valider l’encaissement/ }).click();
  // a free sale rung up by the owner, who has no chair: he says who did the cuts
  await page.getByRole('dialog', { name: 'Qui a fait la prestation ?' }).getByRole('button', { name: 'JKut' }).click();
  await page.getByRole('button', { name: 'Ticket suivant' }).waitFor({ timeout: 8000 });
  const sales = (await call('/api/v1/sales?day=' + pulse.today)).json.items.filter((x) => x.clientId === m.clientId);
  if (!sales.some((x) => x.totals.due > 0)) fail('the second cut of the week was not charged: ' + JSON.stringify(sales.map((x) => x.totals.due)));
  const after = (await call('/api/v1/memberships?clientId=' + m.clientId)).json.members[0];
  if (after.week.used !== 1) fail('the week shows ' + after.week.used + ' cuts, expected 1');

  // 3. Clients › Abonnés: the strip and the member. Opening the board reads the owner's rows, which also catches up a month whose renewal notice never came
  const reads = [];
  page.on('request', (rq) => { const u = new URL(rq.url()); if (u.pathname === '/api/v1/memberships' && !u.searchParams.has('clientId')) reads.push(u.href); });
  await page.goto(h.base + '/comptoir/clients?segment=abonnes');
  await page.getByRole('group', { name: 'Les abonnés en chiffres' }).waitFor({ timeout: 8000 });
  for (const t of ['Chaque mois', 'À régulariser', 'Coupes ce mois']) await page.getByText(t, { exact: true }).first().waitFor({ timeout: 3000 });
  await page.getByText('Carnets en cours').waitFor({ timeout: 3000 });
  await page.getByRole('button', { name: new RegExp(file.first + ' ' + file.last) }).first().waitFor({ timeout: 3000 });
  if (!reads.length) fail('the Abonnés board never read /api/v1/memberships (the catch-up of missed renewals)');
  await h.shot(page, 'membership-board');

  // 4. his file: the chip opens the block; cancel at the end of the paid month → « Fin le … »
  await page.getByRole('button', { name: new RegExp(file.first + ' ' + file.last) }).first().click();
  await page.getByRole('group', { name: 'En un coup d’œil' }).waitFor({ timeout: 8000 });
  await page.getByRole('button', { name: /^Abonnement Hebdo.*Ouvrir/ }).click();
  await page.getByText('Cette semaine', { exact: true }).waitFor({ timeout: 3000 });
  await h.shot(page, 'membership-file');
  await page.getByRole('button', { name: 'Résilier', exact: true }).click();
  const dlg = page.getByRole('dialog', { name: /Résilier l’abonnement/ });
  await dlg.getByRole('radio', { name: /À la fin du mois payé/ }).check();
  await h.shot(page, 'membership-cancel');
  await dlg.getByRole('button', { name: 'Résilier', exact: true }).click();
  await page.getByText(/Fin le \d\d\/\d\d/).first().waitFor({ timeout: 8000 });
  const ending = (await call('/api/v1/memberships?clientId=' + m.clientId)).json.members[0];
  if (ending.status !== 'ending' || !ending.cancelAt) fail('the membership is ' + ending.status + ', expected ending');

  // another member: stopped now, with the unused days given back
  const other = (await call('/api/v1/memberships')).json.members.find((x) => x.status === 'active' && x.id !== m.id && x.refund > 0) || fail('no other member to stop');
  await page.goto(h.base + '/comptoir/clients/' + other.clientId);
  await page.getByRole('button', { name: /^Abonnement .*Ouvrir/ }).click();
  await page.getByRole('button', { name: 'Résilier', exact: true }).click();
  const dlg2 = page.getByRole('dialog', { name: /Résilier l’abonnement/ });
  await dlg2.getByRole('radio', { name: /Tout de suite/ }).check();
  await dlg2.getByText(/Rembourser .* \(jours non utilisés\)/).waitFor({ timeout: 3000 });
  await dlg2.getByRole('button', { name: 'Résilier', exact: true }).click();
  await page.getByText('Terminé', { exact: false }).first().waitFor({ timeout: 8000 }).catch(() => {});
  const gone = (await call('/api/v1/memberships?clientId=' + other.clientId)).json.members.find((x) => x.id === other.id);
  if (gone.status !== 'ended') fail('stopped now, but the membership is ' + gone.status);

  // 5. Réglages › Abonnements: a new formule, on sale on the site
  await page.goto(h.base + '/comptoir/reglages/abonnements');
  await page.getByRole('switch', { name: /Vendre des abonnements/ }).waitFor({ timeout: 8000 });
  await page.getByRole('button', { name: 'Ajouter une formule' }).click();
  await page.getByRole('region', { name: 'Formule 2' }).getByLabel('Nom').fill('Duo barbe');
  // the card takes the name it was given; a new formule is weekly by default (PAY-07): this one counts by the month
  const card = page.getByRole('region', { name: 'Formule Duo barbe' });
  await card.getByLabel('Prix par mois').fill('25');
  await card.getByRole('group', { name: 'Rythme' }).getByRole('button', { name: 'Par mois' }).click();
  await card.getByRole('group', { name: 'Coupes par mois' }).getByRole('button', { name: '1', exact: true }).click();
  await card.getByRole('group', { name: 'Prestations couvertes' }).getByRole('button', { name: 'Taille de barbe', exact: true }).click();
  await page.getByText('Aperçu sur le site').last().waitFor();
  await h.shot(page, 'membership-reglages');
  await page.getByRole('button', { name: 'Enregistrer' }).click();
  await page.getByText('Abonnements enregistrés').waitFor({ timeout: 8000 });
  // asked from Node: the browser would answer from the 20 s the site keeps its plans
  const site = (await h.api('/api/public/memberships', { session: false })).json;
  const duo = site.plans.find((p) => p.name === 'Duo barbe');
  if (!duo || duo.price !== 2500 || duo.cuts !== 1 || !duo.services.some((s) => s.name === 'Taille de barbe')) fail('the new formule is not on the site: ' + JSON.stringify(site.plans.map((p) => p.name)));

  // 6. a phone: the board, a file and the settings never scroll sideways, and the cancel sheet's two buttons fit the screen
  const phone = await h.newPage({ viewport: { width: 390, height: 844 } });
  await h.loginOwner(phone);
  for (const path of ['/comptoir/clients?segment=abonnes', '/comptoir/clients/' + other.clientId, '/comptoir/reglages/abonnements', '/comptoir/caisse?rdv=' + booked.json.id]) {
    await phone.goto(h.base + path);
    await phone.waitForTimeout(900);
    if (await phone.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)) fail(path + ' scrolls sideways on a phone');
  }
  const live = (await call('/api/v1/memberships')).json.members.find((x) => ['active', 'ending'].includes(x.status) && !x.cancelAt && x.id !== m.id) || fail('no member left to open the cancel sheet on a phone');
  await phone.goto(h.base + '/comptoir/clients/' + live.clientId);
  await phone.getByRole('button', { name: /^Abonnement .*Ouvrir/ }).click();
  await phone.getByRole('button', { name: 'Résilier', exact: true }).click();
  await phone.getByRole('dialog', { name: /Résilier l’abonnement/ }).waitFor({ timeout: 5000 });
  const foot = await phone.evaluate(() => { const f = document.querySelector('.sheet-f'); return f ? { sw: f.scrollWidth, cw: f.clientWidth } : null; });
  if (!foot || foot.sw > foot.cw) fail('the cancel sheet footer is clipped on a phone: ' + JSON.stringify(foot));
  await phone.getByRole('button', { name: 'Garder' }).click();

  // 7. a file with no e-mail cannot be offered a membership: the sheet says what is missing and keeps both buttons off
  const bare = (await call('/api/v1/clients?limit=200')).json.items.find((c) => c.hasPhone && !c.hasEmail && !c.memberships.length) || fail('no client without an e-mail in the demo');
  await page.goto(h.base + '/comptoir/clients/' + bare.id);
  const fold = page.locator('#fold-abo .cl-fold-h button');
  await fold.waitFor({ timeout: 8000 });
  if ((await fold.getAttribute('aria-expanded')) !== 'true') await fold.click();
  await page.getByRole('button', { name: /^Abonner / }).click();
  const offer = page.getByRole('dialog', { name: /^Abonner / });
  await offer.getByText(/Ajoute son e-mail pour l’abonner/).waitFor({ timeout: 5000 });
  if (!(await offer.getByRole('button', { name: 'Afficher le QR' }).isDisabled())) fail('the QR button is on for a file with no e-mail');
};
