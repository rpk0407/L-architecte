// @ts-check
// MSG-02 · Réglages › Messages › Canal d'envoi: which way the texts leave (Brevo SMS, the salon's own phone, WhatsApp with
// SMS as the fallback), whether each route is configured (read from the environment: never a key, a password or a
// username in the answer), a test text to the owner's own phone per route, and the WhatsApp templates to map.
// The test changes nothing in the journal, like the test SMS of Mise en route.
import { HttpError, guard } from './kit.js';
import { TEMPLATES, classOf } from '../core/templates.js';
import { waVarNames } from '../settings/messages.js';
import { phoneAllowed, renderTemplate, whenWords, waMapping } from '../domain/messages.js';
import { normPhone, maskPhone, fmtPhone } from '../lib/util.js';

const HOUR = 3600000;
export const TEST_PER_HOUR = 3;
export const ROUTES = /** @type {const} */ (['brevo', 'gateway', 'twilio', 'whatsapp']);
/** The owner's words for each route, in the test text too. */
const NAMES = { brevo: 'Brevo', gateway: 'le téléphone du salon', twilio: 'Twilio', whatsapp: 'WhatsApp' };

/** The variables of a text, in the order its default words use them: the order a WhatsApp template is likely to follow. */
const varsOf = (t) => [...new Set([...String(t).matchAll(/\{(\w+)\}/g)].map((m) => m[1]))];

/** The last text that failed, or left by SMS because WhatsApp refused it: what the owner checks first. */
export function lastSmsTrouble(msgs) {
  let failed = null, fallback = null;
  for (const m of msgs) {
    if (m.channel === 'email') continue;
    const at = m.updatedAt || m.at;
    if (m.status === 'failed' && (!failed || at > failed.at)) failed = { at, error: m.error || '', via: m.via || 'sms' };
    if (m.fallback && (!fallback || at > fallback.at)) fallback = { at, error: m.fallback };
  }
  return { lastFailure: failed, lastFallback: fallback };
}

/** @param {any} app */
export function channelRoutes(app) {
  app.get('/api/v1/messages/channels', (r) => {
    const rt = r.rt, s = r.s, cfg = rt.cfg;
    const demo = s.mode === 'demo';
    const routes = cfg.smsRoutes || {};
    const w = s.settings.messages.whatsapp || { enabled: false, templates: {} };
    let host = '';
    try { host = routes.gateway ? new URL(routes.gateway.url).host : ''; } catch { /* not a URL */ }
    const trouble = lastSmsTrouble([...s.messages.values()]);
    return {
      mode: s.mode,
      // the SMS route in use: SMS_PROVIDER, once its credentials are there
      active: rt.sms ? rt.sms.name : null,
      routes: [
        { key: 'brevo', configured: !!routes.brevo, active: !!rt.sms && rt.sms.name === 'brevo', sender: routes.brevo ? String(routes.brevo.sender).slice(0, 11) : '' },
        // the address only, for a private server: the username and the password stay in Vercel
        { key: 'gateway', configured: !!routes.gateway, active: !!rt.sms && rt.sms.name === 'gateway', host },
        ...(routes.twilio || (rt.sms && rt.sms.name === 'twilio') ? [{ key: 'twilio', configured: !!routes.twilio, active: !!rt.sms && rt.sms.name === 'twilio' }] : [])
      ],
      // the sender is the salon's public WhatsApp Business number: shown, it is no secret
      whatsapp: { configured: !!cfg.whatsapp, live: !!rt.whatsapp, enabled: !!w.enabled, sender: cfg.whatsapp ? fmtPhone(cfg.whatsapp.senderNumber) : '', senderInvalid: !!cfg.whatsappSenderInvalid },
      // utility: a service text, which may go by WhatsApp; sms: a review request or an offer, SMS only (FID-01)
      templates: Object.keys(TEMPLATES).map((k) => ({ key: k, category: classOf(k) === 'service' ? 'utility' : 'sms', vars: varsOf(TEMPLATES[k]), mapped: !!waMapping({ whatsapp: { enabled: true, templates: w.templates || {} } }, k) })),
      vars: waVarNames(),
      ...trouble,
      demo
    };
  }, { cap: 'settings' });

  /** One text through one route to the owner's own phone: the route checked before the salon depends on it. */
  app.post('/api/v1/messages/channels/test', async (r) => {
    const s = r.s, rt = r.rt;
    const b = r.body && typeof r.body === 'object' ? r.body : {};
    const route = ROUTES.find((x) => x === b.route);
    if (!route) throw new HttpError(400, 'invalid', 'Canal inconnu.');
    // the number typed, else the owner's alert phone, else the salon's when it is a mobile: a French mobile only, it is
    // the owner's own phone, and the route is no way to text anyone, anywhere (as Mise en route's test SMS)
    const typed = String(b.phone || '').trim();
    const mobile = (p) => /^\+33[67]\d{8}$/.test(p);
    const saved = [s.settings.notify && s.settings.notify.phone, s.settings.shop.phone].map(normPhone).find(mobile) || '';
    const to = typed ? normPhone(typed) : saved;
    if (!to) throw new HttpError(400, 'no_phone', typed ? 'Ce numéro n’est pas valable.' : 'Indique ton numéro de portable.');
    if (!phoneAllowed(to, s.settings.messages.countries)) throw new HttpError(400, 'country', 'Les SMS ne partent pas vers ce pays (Réglages › Messages).');
    if (!mobile(to)) throw new HttpError(400, 'not_mobile', 'Le test part vers un portable français (06 ou 07).');
    const demo = s.mode === 'demo';
    const provider = demo ? null : route === 'whatsapp' ? rt.whatsapp : rt.smsRoute ? rt.smsRoute(route) : null;
    if (!demo && !provider) throw new HttpError(409, 'not_configured', route === 'whatsapp' ? 'WhatsApp n’est pas branché : il faut BREVO_API_KEY et WHATSAPP_SENDER.' : 'Ce canal n’est pas branché : ses identifiants manquent dans Vercel.');
    // WhatsApp: a message the salon starts needs an approved template, the one asked or the first one mapped
    const w = s.settings.messages.whatsapp || { templates: {} };
    const all = { whatsapp: { enabled: true, templates: w.templates || {} } };
    const tplKey = route !== 'whatsapp' ? '' : waMapping(all, String(b.template || '')) ? String(b.template) : Object.keys(TEMPLATES).find((k) => waMapping(all, k)) || '';
    if (route === 'whatsapp' && !tplKey) throw new HttpError(409, 'no_template', 'Associe d’abord un modèle WhatsApp approuvé (son numéro dans Brevo) à un message.');
    guard('test-route|' + route + '|' + r.me.id, TEST_PER_HOUR, HOUR, 'Trois tests par heure au plus sur ce canal. Réessaie plus tard.');
    const body = renderTemplate('Test du Comptoir : les SMS de {salon} partent bien par {route}. Les liens envoyés aux clients ouvrent {site}', { salon: s.settings.shop.name, route: NAMES[route], site: r.meta.siteUrl });
    const out = { ok: true, route, to: maskPhone(to), ...(tplKey ? { template: tplKey } : { body }) };
    if (demo) return { ...out, simulated: true };
    try {
      if (route === 'whatsapp') {
        const t = /** @type {{ id: number, params: string[] }} */ (waMapping(all, tplKey));
        const sample = sampleVars(r);
        const res = await provider.send(to, { templateId: t.id, params: t.params.map((k) => [k, String(sample[k] ?? k)]) });
        return { ...out, simulated: false, ref: res.ref };
      }
      const res = await provider.send(to, body, {});
      return { ...out, simulated: false, ref: res.ref };
    } catch (err) { throw new HttpError(502, 'send_failed', 'Refusé : ' + String(err && err.message || err)); }
  }, { cap: 'settings' });
}

/** Believable values for a test template: the owner's first name, today 10 h, the first barber, the site's links. */
function sampleVars(r) {
  const s = r.s;
  const barber = [...s.staff.values()].find((x) => x.active && x.chair);
  const site = r.meta.siteUrl || '';
  return {
    prenom: String((r.me && r.me.name) || 'Karim').split(' ')[0], ...whenWords(r.local.day, 600), barbier: barber ? barber.name : 'ton barbier',
    prestation: 'Coupe', prix: '30,00 €', salon: s.settings.shop.name, lien: site, avis: s.settings.shop.reviewUrl || site, jours: '34',
    ticket: 'T000001', montant: '30,00 €', suite: '.', acheteur: 'Karim', code: 'TEST-0000', absent: 'JKut', avant: '10 h'
  };
}
