// The old WordPress addresses and where each must land (vercel.json `redirects`), as [request, status, Location, the rule
// it exercises]. One list for three readers: the end-to-end test (tests/e2e/prod/root-and-redirects.mjs) checks it against
// the app before a deploy, scripts/check-redirects.mjs against the live domain, and the Comptoir's Jour J card
// (server/http/routes-bascule.js) against the address the salon is served on. The 4th column ties a case to its rule
// (the e2e test fails when a rule has no case).

export const PAY = 'sln_step_page=summary&submit_summary=next&sln_booking_id=4410-0cc175b9c0f1b6a831c399e269772661&pay_remaining_amount=0';

/** @type {[string, number, string, string][]} */
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
    .map((p) => /** @type {[string, number, string, string]} */ (['/' + p, 308, '/', 'posts'])),
  ['/sln_service/coupe-classique', 308, '/#carte', '/sln_service/:slug*'], ['/go_pricing_tables/coupes-barbes', 308, '/#carte', '/go_pricing_tables/:slug*'],
  ['/sln_attendant/jkut', 308, '/?reserver&barbier=jkut', '/sln_attendant/:slug'], ['/sln_attendant/larchi', 308, '/?reserver&barbier=larchi', '/sln_attendant/:slug'],
  ['/category/actualites', 308, '/', '/category/:slug*'], ['/2020/10', 308, '/', '/(2019|2020)/:path*'], ['/2019/11/28', 308, '/', '/(2019|2020)/:path*'],
  ['/feed', 308, '/', '/(feed|comments/feed)'], ['/comments/feed', 308, '/', '/(feed|comments/feed)'],
  ['/wp-sitemap.xml', 308, '/sitemap.xml', '/(wp-sitemap.xml|sitemap_index.xml)'], ['/sitemap_index.xml', 308, '/sitemap.xml', '/(wp-sitemap.xml|sitemap_index.xml)'],
  // the sub-sitemaps and the stylesheet the live index lists, then the archives WordPress generates
  ['/wp-sitemap-posts-page-1.xml', 308, '/sitemap.xml', '/wp-sitemap-:rest*'], ['/wp-sitemap-index.xsl', 308, '/sitemap.xml', '/wp-sitemap-:rest*'],
  ['/author/admin', 308, '/', '/author/:slug*'], ['/tag/redken', 308, '/', '/tag/:slug*'], ['/page/2', 308, '/', '/page/:n'], ['/brews-redken/feed', 308, '/', '/:slug/feed'],
  ['/wp-login.php', 307, '/comptoir', '/wp-login.php'], ['/wp-admin', 307, '/comptoir', '/wp-admin/:path*'], ['/wp-admin/edit.php?post_type=sln_booking', 307, '/comptoir?post_type=sln_booking', '/wp-admin/:path*'],
  ['/wp-content/uploads/2020/11/INFO-COVID.pdf', 308, '/', '/wp-content/uploads/:path*'],
  // WordPress addresses end with a slash: trailingSlash:false strips it first, keeping the query
  ['/rdv-en-ligne/', 308, '/rdv-en-ligne', 'trailing'], ['/nos-services/?utm_source=gbp', 308, '/nos-services?utm_source=gbp', 'trailing']
];
