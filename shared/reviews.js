// @ts-check
// The Google review link, as the server checks it (Mise en route, the /avis redirect) and the Comptoir shows it:
// one copy for both sides, so « le lien ouvre bien une page d'avis » means the same thing everywhere.

/**
 * Which kind of Google review page a link opens, or '' when it is not one: the writereview page of a place
 * (search.google.com/local/writereview?placeid=…), the short link of Google Business Profile › Demander des avis
 * (g.page/r/…/review), or a Maps short link (maps.app.goo.gl/…).
 * @param {string} url
 * @returns {'placeid'|'gpage'|'maps'|''}
 */
export function reviewLinkKind(url) {
  const u = String(url || '').trim();
  if (/^https:\/\/search\.google\.com\/local\/writereview\?(?:[^#\s]*&)?placeid=[\w-]{10,}(?:[&#]\S*)?$/.test(u)) return 'placeid';
  if (/^https:\/\/g\.page\/r\/[\w-]{6,}\/review\/?(?:[?#]\S*)?$/.test(u)) return 'gpage';
  if (/^https:\/\/maps\.app\.goo\.gl\/[\w-]{6,}\/?(?:[?#]\S*)?$/.test(u)) return 'maps';
  return '';
}

/** Where /avis/:token may send a visitor: an https address only (the owner typed it; never a javascript: or a relative one). */
export function safeRedirect(url) {
  const u = String(url || '').trim();
  return /^https:\/\/[^\s/]+(\/\S*)?$/.test(u) ? u : '';
}
