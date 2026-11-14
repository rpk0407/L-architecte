// Losing the connection is said within seconds, calmly, on every page: « Hors ligne : ce que tu vois date de … », the
// buttons that write (till validation, booking) are off with their reason, and everything clears as soon as it is back.
export const name = 'offline: a calm banner within seconds, the writing buttons off with a reason, cleared when back';

const pending = (a, min) => !a.saleId && (a.status === 'in_chair' || a.status === 'done' || (['booked', 'arrived'].includes(a.status) && a.start + a.dur <= min));

export default async ({ h, page, ctx }) => {
  await h.loginOwner(page);
  // requests that fail while offline are the point of this scenario
  page.expect.push(/ERR_INTERNET_DISCONNECTED|Failed to load resource|net::/);
  const pulse = await page.evaluate(async () => (await fetch('/api/v1/pulse')).json());
  const ag = await page.evaluate(async (d) => (await fetch('/api/v1/agenda?day=' + d)).json(), pulse.today);
  const a = ag.appts.filter((x) => pending(x, pulse.min)).sort((x, y) => x.start - y.start)[0];
  if (!a) throw new Error('no appointment waiting to pay in the demo');
  const band = page.locator('.offline-band');

  // the till, a ticket ready to validate
  await page.goto(h.base + '/comptoir/caisse?rdv=' + a.id);
  await page.locator('.ticket').waitFor({ timeout: 8000 });
  await page.getByRole('button', { name: 'Carte Terminal de paiement' }).click();
  const validate = page.getByRole('button', { name: /Valider l’encaissement/ });
  await validate.waitFor({ timeout: 5000 });
  if (await validate.isDisabled()) throw new Error('« Valider » is off while online');
  if (await band.count()) throw new Error('the offline banner shows while online');

  const t0 = Date.now();
  await ctx.setOffline(true);
  await band.waitFor({ timeout: 8000 });
  const took = Date.now() - t0;
  if (took > 8000) throw new Error('the banner took ' + took + ' ms');
  const words = (await band.innerText()).replace(/\s+/g, ' ');
  if (!/^Hors ligne : ce que tu vois date de \d{1,2} h( \d{2})?\. Les encaissements ne sont pas enregistrés tant que la connexion n’est pas revenue\.$/.test(words)) throw new Error('the banner reads: ' + words);
  if ((await band.getAttribute('role')) !== 'status') throw new Error('the banner is not a calm status');
  // the till's validation is off, and says why
  if (!(await validate.isDisabled())) throw new Error('« Valider » stays on while offline');
  await page.getByText('Hors ligne : l’encaissement attend le retour de la connexion.').waitFor({ timeout: 3000 });
  await h.shot(page, 'offline-till');

  // back: gone at once, the button is on again
  await ctx.setOffline(false);
  await band.waitFor({ state: 'detached', timeout: 8000 });
  await page.waitForFunction(() => { const b = [...document.querySelectorAll('button')].find((x) => /Valider l’encaissement/.test(x.textContent || '')); return !!b && !b.disabled; }, null, { timeout: 8000 });
  if (await page.getByText('l’encaissement attend le retour').count()) throw new Error('the reason stays once back online');

  // a new booking: « Réserver » is off with its reason too, on the agenda (where the 4 s pulse runs)
  await page.goto(h.base + '/comptoir/agenda?new=1');
  const sheet = page.getByRole('dialog');
  await sheet.getByRole('button', { name: 'Réserver', exact: true }).waitFor({ timeout: 8000 });
  await ctx.setOffline(true);
  await band.waitFor({ timeout: 8000 });
  await sheet.getByText('Hors ligne : la réservation attend le retour de la connexion.').waitFor({ timeout: 3000 });
  if (!(await sheet.getByRole('button', { name: 'Réserver', exact: true }).isDisabled())) throw new Error('« Réserver » stays on while offline');
  await ctx.setOffline(false);
  await band.waitFor({ state: 'detached', timeout: 8000 });
  if (await sheet.getByText('la réservation attend le retour').count()) throw new Error('the booking reason stays once back online');
};
