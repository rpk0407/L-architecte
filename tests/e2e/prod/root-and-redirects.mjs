// The domain switch on a production salon: / is the site (never the demo page), every old WordPress
// address and every link from the old booking e-mails lands somewhere useful, unknown pages get the styled 404.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from '../harness.mjs';

export const name = 'the site at /, WordPress redirects, old e-mail links, 404';

const PAY = 'sln_step_page=summary&submit_summary=next&sln_booking_id=4410-0cc175b9c0f1b6a831c399e269772661&pay_remaining_amount=0';
// [request, status, Location, the vercel.json rule it exercises]; scripts/check-redirects.mjs runs the same list on the live domain
export const CASES = [
  ['/Main.dc', 307, '/', '/Main.dc'], ['/Cockpit.dc', 307, '/comptoir', '/Cockpit.dc'], ['/Parcours.dc', 307, '/demo', '/Parcours.dc'],
  ['/?sln-api=cancel_booking&booking_id=12-abc', 307, '/ancien-lien?sln-api=cancel_booking&booking_id=12-abc', '/?sln-api'],
  ['/?sln_customer_login=9f2c41&feedback_id=4410', 307, '/ancien-lien?sln_customer_login=9f2c41&feedback_id=4410', '/?sln_customer_login'],
  ['/?booking_id=4410&sln_reschedule_booking=1', 307, '/ancien-lien?booking_id=4410&sln_reschedule_booking=1', '/?sln_reschedule_booking'],
  ['/?' + PAY, 307, '/ancien-lien?' + PAY, '/?sln_booking_id'],
  ['/?sln_step_page=summary', 307, '/ancien-lien?sln_step_page=summary', '/?sln_step_page'],
  ['/?page_id=2', 308, '/?reserver&page_id=2', '/?page_id'],
  ['/rdv-en-ligne', 308, '/?reserver', '/rdv-en-ligne'], ['/booking', 308, '/?reserver', '/booking'],
  ['/thank-you-for-booking', 308, '/', '/thank-you-for-booking'], ['/salon-de-coiffure', 308, '/', '/salon-de-coiffure'], ['/news', 308, '/', '/news'],
  ['/mon-compte', 308, '/mon-rendez-vous', '/mon-compte'], ['/booking-my-account', 308, '/mon-rendez-vous', '/booking-my-account'],
  ['/nos-services', 308, '/#carte', '/nos-services'], ['/creations', 308, '/#coupes', '/creations'],
  ['/taille-et-entretien-de-la-coupe-et-de-la-barbe', 308, '/formations#barbe', '/taille-et-entretien-de-la-coupe-et-de-la-barbe'],
  ['/la-coupe-classique-et-ses-subtilites', 308, '/formations#classique', '/la-coupe-classique-et-ses-subtilites'],
  ['/la-coupe-homme-complexe-et-ses-techniques', 308, '/formations#complexe', '/la-coupe-homme-complexe-et-ses-techniques'],
  ['/a-toutes-occasions-offrez-un-moment-privilegie-a-vos-proches-en-leur-offrant-une-carte-cadeau', 308, '/carte-cadeau', '/a-toutes-occasions-offrez-un-moment-privilegie-a-vos-proches-en-leur-offrant-une-carte-cadeau'],
  ...['message-exceptionnel', 'welcome-back-jkut-congrats', 'jblades-welcome-in-da-team', 'brews-redken', 'retrouvez-la-gamme-redken-brews', 'paiements-par-cb-desormais-acceptes', 'nous-serons-exceptionnellement-ouverts-les-lundi-21-28-decembre']
    .map((p) => ['/' + p, 308, '/', 'posts']),
  ['/sln_service/coupe-classique', 308, '/#carte', '/sln_service/:slug*'], ['/go_pricing_tables/coupes-barbes', 308, '/#carte', '/go_pricing_tables/:slug*'],
  ['/sln_attendant/jkut', 308, '/?reserver&barbier=jkut', '/sln_attendant/:slug'], ['/sln_attendant/larchi', 308, '/?reserver&barbier=larchi', '/sln_attendant/:slug'],
  ['/category/actualites', 308, '/', '/category/:slug*'], ['/2020/10', 308, '/', '/(2019|2020)/:path*'], ['/2019/11/28', 308, '/', '/(2019|2020)/:path*'],
  ['/feed', 308, '/', '/(feed|comments/feed)'], ['/comments/feed', 308, '/', '/(feed|comments/feed)'],
  ['/wp-sitemap.xml', 308, '/sitemap.xml', '/(wp-sitemap.xml|sitemap_index.xml)'], ['/sitemap_index.xml', 308, '/sitemap.xml', '/(wp-sitemap.xml|sitemap_index.xml)'],
  ['/wp-login.php', 307, '/comptoir', '/wp-login.php'], ['/wp-admin', 307, '/comptoir', '/wp-admin/:path*'], ['/wp-admin/edit.php?post_type=sln_booking', 307, '/comptoir?post_type=sln_booking', '/wp-admin/:path*'],
  ['/wp-content/uploads/2020/11/INFO-COVID.pdf', 308, '/', '/wp-content/uploads/:path*'],
  // WordPress addresses end with a slash: trailingSlash:false strips it first, keeping the query
  ['/rdv-en-ligne/', 308, '/rdv-en-ligne', 'trailing'], ['/nos-services/?utm_source=gbp', 308, '/nos-services?utm_source=gbp', 'trailing']
];
const POSTS = '/(message-exceptionnel|welcome-back-jkut-congrats|jblades-welcome-in-da-team|brews-redken|retrouvez-la-gamme-redken-brews|paiements-par-cb-desormais-acceptes|nous-serons-exceptionnellement-ouverts-les-lundi-21-28-decembre)';

const ruleId = (r) => (r.source === POSTS ? 'posts' : r.source + (r.has ? '?' + r.has[0].key : ''));

export default async ({ h, page }) => {
  const cfg = JSON.parse(readFileSync(join(ROOT, 'vercel.json'), 'utf8'));
  const covered = new Set(CASES.map((c) => c[3]));
  const missing = cfg.redirects.map(ruleId).filter((id) => !covered.has(id));
  if (missing.length) throw new Error('redirects without a case here: ' + missing.join(', '));

  // a fresh production salon, before and after the owner sets it up: / is the site, never the demo page
  for (const when of ['before setup', 'after setup']) {
    if (when === 'after setup') await h.setup();
    const root = await h.api('/', { session: false });
    if (root.status !== 200 || !root.text.includes('On te fait quoi')) throw new Error('/ ' + when + ': not the site (' + root.status + ')');
    if (root.text.includes('Architecte13') || root.text.includes('DÉMO PRIVÉE')) throw new Error('/ ' + when + ': shows the demo page');
    if (root.headers.get('x-robots-tag')) throw new Error('/ carries X-Robots-Tag: ' + root.headers.get('x-robots-tag'));
  }
  const alias = await h.api('/site', { session: false });
  if (alias.status !== 200 || !alias.text.includes('On te fait quoi')) throw new Error('/site is no longer the site (' + alias.status + ')');
  for (const p of ['/comptoir', '/demo', '/ancien-lien', '/r/abc.def']) {
    const r = await h.api(p, { session: false });
    if (!/noindex/.test(r.headers.get('x-robots-tag') || '')) throw new Error(p + ' is indexable');
  }
  // the rewrites reach the apps (on Vercel a '.html' destination would 404 with cleanUrls; dev.mjs refuses it too)
  for (const [p, title] of [['/comptoir/caisse', 'Le Comptoir'], ['/r/abc.def', 'Ton rendez-vous'], ['/recu/abc.def', 'Ton rendez-vous'], ['/paiement/abc', 'Ton rendez-vous']]) {
    const r = await h.api(p, { session: false });
    if (r.status !== 200 || !r.text.includes('<title>' + title)) throw new Error(p + ': not the app (' + r.status + ')');
  }
  const robots = await h.api('/robots.txt', { session: false });
  if (robots.status !== 200 || !robots.text.startsWith('User-agent: *')) throw new Error('robots.txt: ' + robots.status);
  // noindex covers whole first segments only: /robots.txt starts with /r but is not a client link
  for (const [p, r] of [['/robots.txt', robots], ['/sitemap.xml', null]]) {
    const tag = (r || await h.api(p, { session: false })).headers.get('x-robots-tag');
    if (tag) throw new Error(p + ' carries X-Robots-Tag: ' + tag);
  }
  const sitemap = await h.api('/sitemap.xml', { session: false });
  if (sitemap.status !== 200 || !sitemap.text.includes('<loc>https://barberlarchitecte.com/</loc>')) throw new Error('sitemap.xml: ' + sitemap.status);

  // the demo landing page sends production visitors to the site, and stays hidden while it asks (a slow cold start)
  await page.route('**/api/public/salon', async (route) => { await new Promise((r) => setTimeout(r, 1000)); await route.continue().catch(() => {}); });
  await page.goto(h.base + '/demo', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(400);
  if (page.url().endsWith('/demo') && await page.getByText('Architecte13').locator('visible=true').count()) throw new Error('/demo shows the demo credentials before leaving');
  await page.waitForURL(h.base + '/', { timeout: 8000 });
  await page.unroute('**/api/public/salon', { behavior: 'ignoreErrors' });
  await page.locator('.lp').first().waitFor({ timeout: 8000 });

  // every old address: the right status and destination, query kept
  const wrong = [];
  for (const [from, status, to] of CASES) {
    const r = await h.api(from, { session: false });
    const loc = (r.location || '').replace(h.base, '');
    if (r.status !== status || loc !== to) wrong.push(from + ' → ' + r.status + ' ' + loc + ' (expected ' + status + ' ' + to + ')');
  }
  if (wrong.length) throw new Error(wrong.join('\n'));

  // chains end on a real page, never in a loop
  async function follow(from) {
    let url = from;
    for (let i = 0; i < 5; i++) {
      const r = await h.api(url, { session: false });
      if (r.status < 300 || r.status >= 400) return { url, status: r.status, text: r.text };
      url = r.location.replace(h.base, '');
    }
    throw new Error(from + ': more than 5 redirects');
  }
  for (const [from, end] of [['/rdv-en-ligne/', '/?reserver'], ['/?page_id=2', '/?reserver&page_id=2'], ['/wp-admin/', '/comptoir'],
    ['/rdv-en-ligne/?' + PAY, '/ancien-lien?reserver&' + PAY]]) {
    const r = await follow(from);
    if (r.url !== end || r.status !== 200) throw new Error(from + ' ends at ' + r.status + ' ' + r.url + ', expected 200 ' + end);
  }

  // unknown page: status 404 with the site's page, not a bare text
  const lost = await h.api('/nimporte', { session: false });
  if (lost.status !== 404 || !/text\/html/.test(lost.headers.get('content-type') || '') || !lost.text.includes('Réserver')) throw new Error('/nimporte: ' + lost.status + ' ' + lost.text.slice(0, 80));
  await page.goto(h.base + '/nimporte');
  await page.getByRole('link', { name: 'Réserver' }).waitFor();
  if ((await page.getByRole('link', { name: 'Revenir à l’accueil' }).getAttribute('href')) !== '/') throw new Error('404: no way home');

  // an old cancel link: nothing is cancelled, no match → the client asks for the link by SMS
  const writes = [];
  page.on('request', (rq) => { if (rq.method() !== 'GET' && rq.url().includes('/api/')) writes.push(rq.method() + ' ' + rq.url()); });
  const lookups = [];
  page.on('request', (rq) => { if (rq.url().includes('/api/public/legacy/')) lookups.push(rq.url().replace(h.base, '')); });
  await page.goto(h.base + '/?sln-api=cancel_booking&booking_id=12-abc');
  await page.waitForURL(/\/ancien-lien/);
  await page.getByText('Ce lien vient de notre ancien site. Donne ton numéro, on t’envoie le lien de ton rendez-vous par SMS.').waitFor({ timeout: 8000 });
  if ((await page.getByRole('link', { name: 'Retrouver mon rendez-vous' }).getAttribute('href')) !== '/mon-rendez-vous') throw new Error('no link to /mon-rendez-vous');
  if (lookups.join() !== '/api/public/legacy/12?u=abc') throw new Error('lookup: ' + lookups.join());
  if (page.url().includes('booking_id')) throw new Error('the booking secret stays in the address bar');

  // an id alone (reschedule links carry no secret) is never looked up: ids are sequential
  lookups.length = 0;
  await page.goto(h.base + '/?booking_id=4410&sln_reschedule_booking=1');
  await page.getByText('Ce lien vient de notre ancien site.').waitFor({ timeout: 8000 });
  if (lookups.length) throw new Error('looked up an id without its secret: ' + lookups.join());

  // a match (the lookup itself comes with the WordPress import) opens the appointment's own page
  await page.route('**/api/public/legacy/**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ url: '/r/K7Q2.c2lnbmF0dXJl' }) }));
  await page.route(h.base + '/r/**', (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<p>Mon rendez-vous</p>' }));
  await page.goto(h.base + '/?' + PAY);
  await page.waitForURL(h.base + '/r/K7Q2.c2lnbmF0dXJl', { timeout: 8000 });
  // anything but a /r/ link is ignored
  await page.route('**/api/public/legacy/**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ url: 'https://example.com/r/x' }) }));
  await page.goto(h.base + '/ancien-lien?booking_id=12-abc');
  await page.getByText('Ce lien vient de notre ancien site.').waitFor({ timeout: 8000 });
  if (!page.url().startsWith(h.base + '/ancien-lien')) throw new Error('followed a foreign link: ' + page.url());
  if (writes.length) throw new Error('an old link changed something: ' + writes.join(', '));
  await page.unrouteAll();

  // the harness itself: the owner's session from setup works from Node and in the Comptoir, which links to /
  const settings = await h.api('/api/v1/settings');
  if (settings.status !== 200) throw new Error('owner API session: ' + settings.status);
  await h.loginOwner(page);
  if (await page.locator('.demo-band').count()) throw new Error('the production Comptoir shows the demo band');
  if ((await page.locator('a.nav-site').getAttribute('href')) !== '/') throw new Error('“Voir le site client” does not point at /');
};
