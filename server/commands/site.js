// @ts-check
// Le site (Comptoir): the owner and the managers, like the catalogue (a manager has no `settings`, and the site is shop
// content). One command, a patch of the `site` settings section (server/settings/site.js holds its shape and defaults).
import { parse } from '../lib/validate.js';
import { siteSchema } from '../settings/site.js';

export const updateSite = {
  run(/** @type {any} */ s, /** @type {any} */ input, /** @type {any} */ ctx) {
    ctx.need('catalog');
    const patch = parse(siteSchema, input || {});
    if (!Object.keys(patch).length) return { ok: true };
    // the salon's Instagram is Réglages › Salon's too: one value for the site, the messages and the legal pages
    const ig = patch.links && patch.links.instagram;
    ctx.emit('settings.updated', { patch: { site: patch, ...(ig ? { shop: { instagram: ig } } : {}) } });
    return { ok: true };
  }
};
