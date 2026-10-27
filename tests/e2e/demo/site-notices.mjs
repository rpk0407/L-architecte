// The site's notices on the salon's clock (15 December): the December Mondays, then the Christmas closure next to
// them, an early close on a usual day read as other hours, and the status line on a closure day.
export const name = 'site: exceptional openings, closures and special hours in the hero';
export const viewport = { width: 390, height: 844 };
export const env = { LX_FAKE_NOW: '2026-12-15T10:00:00+01:00' };

const sp = (s) => String(s || '').replace(/\s+/g, ' ').trim();
const DEC = [{ day: '2026-12-21', intervals: [[540, 1110]], label: 'Lundis de décembre' }, { day: '2026-12-28', intervals: [[540, 1110]], label: 'Lundis de décembre' }];

export default async ({ h, page }) => {
  await h.setup();
  const patch = async (body) => { const r = await h.api('/api/v1/settings', { method: 'PATCH', body }); if (!r.ok) throw new Error('settings: ' + r.text); };
  const banners = async () => { await page.goto(h.base + '/'); await page.locator('.hero .ann-h').first().waitFor({ timeout: 10000 }); return (await page.locator('.hero .ann-h').allTextContents()).map(sp); };
  const expect = (got, want) => { if (JSON.stringify(got) !== JSON.stringify(want)) throw new Error('the hero says ' + JSON.stringify(got) + ', expected ' + JSON.stringify(want)); };

  await patch({ openings: DEC });
  expect(await banners(), ['Ouvert exceptionnellement les lundis 21 et 28 décembre, 9 h – 18 h 30']);

  // the Christmas closure shows next to them, in date order
  const cl = await h.api('/api/v1/settings/closures', { body: { from: '2026-12-24', to: '2026-12-26', label: 'Congés' } });
  if (!cl.ok) throw new Error('closure: ' + cl.text);
  expect(await banners(), ['Ouvert exceptionnellement les lundis 21 et 28 décembre, 9 h – 18 h 30', 'Fermé du 24 au 26 décembre · Congés']);
  await h.shot(page, 'site-notices');

  // an early close on a day the salon opens anyway is other hours, not an exceptional opening
  await patch({ openings: [{ day: '2026-12-17', intervals: [[540, 840]], label: 'Fêtes' }, ...DEC] });
  expect(await banners(), ['Horaires spéciaux jeudi 17 décembre : 9 h – 14 h', 'Fermé du 24 au 26 décembre · Congés']);

  // today, other hours: the status line says so
  await patch({ openings: [{ day: '2026-12-15', intervals: [[540, 840]], label: 'Fêtes' }] });
  expect(await banners(), ['Horaires spéciaux aujourd’hui : 9 h – 14 h', 'Fermé du 24 au 26 décembre · Congés']);
  const status = async () => sp(await page.locator('.ft-st span').first().textContent());
  if (!(await status()).startsWith('Ouvert · horaires spéciaux · jusqu’à 14 h')) throw new Error('the status line says « ' + (await status()) + ' »');

  // today closed: the status line says why and when it reopens
  await patch({ openings: [] });
  const today = await h.api('/api/v1/settings/closures', { body: { from: '2026-12-15', to: '2026-12-15', label: 'Inventaire' } });
  if (!today.ok) throw new Error('closure: ' + today.text);
  expect(await banners(), ['Fermé aujourd’hui · Inventaire']);
  if ((await status()) !== 'Fermé · Inventaire · rouvre demain à 9 h') throw new Error('the status line says « ' + (await status()) + ' »');
};
